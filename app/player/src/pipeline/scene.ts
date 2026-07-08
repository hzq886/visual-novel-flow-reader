/**
 * scene — シーン脚本イベント列（scene-events/<locale>.json ＝ extract-scenes.py がシーン脚本
 * bytecode を写したもの）を状態機械でパースし Scene を生成する純関数（HU-74）。
 *
 * 入力はタグ付きタプル列（SceneEvent。→ types.ts / ADR 0010）。従来の txt パース（parseScene）は
 * 文字列表ダンプ＝同一文字列デデュープで再表示・反復が欠落していたため、bytecode 一次のイベント列へ
 * 完全置換した（HU-71）。出力 Scene・再生側は不変。
 *
 * イベント → 状態:
 *  text     … 本文 1 行。「」のバランスで複数行を 1 セリフ beat に集約、無ければ地の文（narration）。
 *  speaker  … 話者名（0x0d。主人公含む全発話に明示）。次のセリフ beat に適用（使い切り）。
 *  voice    … ボイス ID。次のセリフ beat へ。
 *  se       … 効果音（ワンショット・0x15）。現 beat があればそこへ、無ければ次 beat へ持ち越す。
 *  lpse     … ループ se（0x16・VOL_LPSE）。BGV 同型の単一ループチャンネルで sticky 持続（HU-76）。
 *  bg       … 背景/EV/黒。label で下レイヤ背景（#背景）と被せ CG（#EV/黒）を分類（HU-63）。
 *  sprite   … 立ち絵スロット列（"-"=空き / null=変更なし）。列の長さ＝0x12 の cnt＝構図幅で、cnt を
 *             超える既存スロットは暗黙クリア（HU-79）。null のスロットは前値を保持し多体を同時表示
 *             （HU-77）。第3要素 reset=true は適用前に全スロットをクリア＝シーン転換の establishing shot。
 *  item     … アイテム CG 窓を開く（座標込み・独立オーバーレイ・HU-70）。itemclose で閉じる。
 *  off/bgv  … 立ち絵オフ / 背景ボイス（ループ）。
 *  flash    … 画面フラッシュ（次 beat のインパクト行で点灯）。
 *  page     … 改ページ（0x04）。地の文をページ単位（1〜2 行）へ集約する境界（HU-78）。セリフは
 *             1 発話まるごと表示するため無視。narration beat は複数ページを持ち、再生側は 1 ページ = 1 送り段。
 *
 * 話者は speaker イベント（0x0d）を一次ソースとする（HU-74）。無い発話のみ、ボイス ID 接頭辞→
 * 話者の学習辞書（HU-67）／未収録主人公（KAZU）フォールバックで補う。
 *
 * レイヤモデル（HU-63）: 通常背景＋立ち絵の下レイヤに、EV／黒一色の被せ CG が覆い被さる。被せ CG 中は
 * 立ち絵を描かず、#背景 note か立ち絵変更で下レイヤへ復帰。アイテム CG（HU-70）は独立オーバーレイで
 * 下レイヤを隠さない。beat 出力は bg = 被せ CG ?? 通常背景、sprites = 被せ CG 中は空、item は独立。
 * #背景 の表示（0x10）は舞台リセット＝立ち絵レイヤもクリアする（HU-80。原エンジン準拠）。立ち絵
 * 変更（0x12）での被せ CG 復帰のみ保持スロットを増分更新の基準に使う。
 */
import {
  Scene,
  type Beat,
  type BgRef,
  type ItemRef,
  type Locale,
  type SceneEvent,
  type SeRef,
  type SpriteRef,
} from './types'

type Draft = {
  kind: 'narration' | 'line'
  who?: string
  voice?: { id: string; file: null }
  lines?: string[] // セリフ（line）の発話行。narration は使わず pages を持つ
  pages?: string[][] // 地の文（narration）のページ列（0x04 区切り・HU-78）。line は使わない
  bg?: BgRef
  sprites?: SpriteRef[]
  item?: ItemRef
  se?: SeRef[]
  bgv?: { id: string; file: null }
  flash?: number
}

// 黒一色（暗転）に割り当てる背景ラベル。backgrounds.json / _BGSET.txt で #背景・黒一色 → BG_BLACK に
// 解決される。bytecode の bg イベントは "BG_BLACK"（0x10 が id 文字列を指す場合）でも来るため正規化する。
const BLACK_BG_LABEL = '#背景・黒一色'

// 無声・無記名の発話に付与する話者名。主人公（KAZU）はボイス未収録のため、speaker イベントも
// ボイス ID も無い「…」行は主人公と確定できる（HU-67。speaker 一次化後は稀にしか発火しない）。
const PROTAGONIST_BY_LOCALE: Record<Locale, string> = { jp: '古橋　和樹', cn: '古桥和树' }

export function buildScene(
  sceneEvents: { title?: string; events: SceneEvent[] },
  opts: { code: string; locale: Locale },
): Scene {
  const { code, locale } = opts
  const route = code.split('_')[0] ?? code

  const beats: Beat[] = []
  const title = sceneEvents.title
  let cur: Draft | null = null
  let pendingSpeaker: string | null = null
  let pendingVoice: string | null = null
  let pendingSe: SeRef[] = [] // beat 生成前に現れた se は次 beat へ持ち越す
  let pendingFlash: number | undefined // flash は直後の beat（インパクト行）で光らせる
  let stickyBg: BgRef | undefined // 通常背景（下レイヤ）
  let stickyOverlay: BgRef | undefined // 被せ CG（EV/黒一色。表示中は立ち絵を隠す・HU-63）
  // 立ち絵スロット（下レイヤ。被せ CG 中も保持し、立ち絵変更での復帰時に増分更新の基準にする。
  // #背景 復帰は舞台リセット＝クリア・HU-80）。index=スロット番号、空きは undefined。0x12 は左右
  // 複数スロットを同時表示する（多体・HU-77。単一投影を廃し per-slot sticky）。
  let stickySlots: (SpriteRef | undefined)[] = []
  let stickyItem: ItemRef | undefined // アイテム CG 窓（bg/sprite と独立のオーバーレイ・HU-70）
  let stickyBgv: { id: string; file: null } | undefined
  let stickyLpse: SeRef | undefined // ループ se（VOL_LPSE。単一ループチャンネルで sticky・HU-76）
  let quoteDepth = 0
  let lastWho: string | null = null
  const voiceMap = new Map<string, string>() // ボイス ID 接頭辞 → 話者名（HU-67 フォールバック）

  const flush = () => {
    if (cur) {
      // narration の末尾に空ページが残る場合（page イベントの後にテキストが来ずに flush）は詰める。
      if (cur.kind === 'narration' && cur.pages) {
        while (cur.pages.length > 1 && cur.pages[cur.pages.length - 1].length === 0) cur.pages.pop()
      }
      beats.push(cur as Beat)
    }
    cur = null
  }
  // 占有スロットをスロット順（左→右）で列挙（空き＝undefined を除外）。
  const occupiedSlots = (slots = stickySlots): SpriteRef[] =>
    slots.filter((s): s is SpriteRef => s !== undefined)
  // 「見た目」の署名。被せ CG 中は立ち絵を隠し bg=被せ CG（→ OV:）、非表示中は立ち絵構成（→ SP:）。
  // narration の分割は、この署名が変化する立ち絵/被せ CG 操作でのみ行う（発話の原子性は別途維持）。
  const visSig = (overlay: BgRef | undefined, slots: (SpriteRef | undefined)[]): string =>
    overlay
      ? `OV:${overlay.label}`
      : `SP:${occupiedSlots(slots)
          .map((s) => s.label)
          .join('|')}`
  // beat 生成時のスナップショット: bg/sprites/item/bgv/lpse の sticky 値＋持ち越し中の se/flash を取り込む。
  type Snap = {
    bg?: BgRef
    sprites?: SpriteRef[]
    item?: ItemRef
    se?: SeRef[]
    lpse?: SeRef
    bgv?: { id: string; file: null }
    flash?: number
  }
  const snapshot = (): Snap => {
    // 表示状態 = 被せ CG があればそれが bg・立ち絵は隠す。無ければ通常背景＋立ち絵（HU-63）。
    // 立ち絵は占有スロットをスロット順（左→右）で列挙。アイテム窓は独立フィールド（HU-70）。
    const bg = stickyOverlay ?? stickyBg
    const sprites = stickyOverlay ? [] : occupiedSlots()
    const snap: Snap = {
      ...(bg ? { bg } : {}),
      ...(sprites.length ? { sprites } : {}),
      ...(stickyItem ? { item: stickyItem } : {}),
      ...(stickyLpse ? { lpse: stickyLpse } : {}),
      ...(stickyBgv ? { bgv: stickyBgv } : {}),
    }
    if (pendingSe.length) {
      snap.se = pendingSe
      pendingSe = []
    }
    if (pendingFlash !== undefined) {
      snap.flash = pendingFlash
      pendingFlash = undefined
    }
    return snap
  }

  // 表示状態が実際に変化する場合のみ、開いているナレーション beat を flush して新しい状態を次 beat
  // からスナップショットさせる（HU-34。セリフ beat・引用継続中には触れない＝発話の原子性を維持）。
  // 通常背景（#背景）。被せ CG が出ていれば閉じて下レイヤへ復帰する（HU-63）。
  // 下レイヤ背景の表示は舞台リセット＝立ち絵レイヤもクリアする（HU-80。原エンジン準拠）。原データは
  // bg 転換後にキャラを見せる場合、必ず 0x12 を本文前に再発行し（カット転換 42/42 件）、その再宣言が
  // 旧スロットの持ち越しに依存する例は 0 件。同一ラベルの再表示（時間経過のフェード演出。
  // 006_TUBA002F L93 は直後に転換前と同一ラベルの立ち絵を再宣言＝クリアされる証拠）でも消えるため、
  // no-op の早期 return は「同一ラベル・被せ CG 無し・立ち絵無し」に限る。
  const setBg = (label: string) => {
    if (stickyOverlay === undefined && label === stickyBg?.label && !occupiedSlots().length) return
    if (cur?.kind === 'narration') flush()
    stickyOverlay = undefined
    stickyItem = undefined // 防御的クローズ（原データでは 0x3c で閉じ済＝通常 no-op）
    stickyBg = { label, file: null }
    stickySlots = []
  }
  // 被せ CG（#EV / 黒一色）。下レイヤ（通常背景・立ち絵）はそのまま保持する（HU-63）。
  const setOverlay = (label: string) => {
    if (label === stickyOverlay?.label) return
    if (cur?.kind === 'narration') flush()
    stickyOverlay = { label, file: null }
    stickyItem = undefined // 防御的クローズ
  }
  // 立ち絵スロット列を適用する（多体同時表示・HU-77）。null=変更なし・"-"=空き・それ以外=配置。
  // slots の長さ ＝ 0x12 の cnt ＝ 構図幅（同時に並ぶ立ち絵の数）なので、cnt を超える既存スロットは
  // 暗黙クリアする（reset 無しでも slice で切り落とす。HU-79）。cnt=1 の単体宣言が直前の上位スロットを
  // 残し同一キャラが 2 体並ぶ回帰を防ぐ。両者を残す場面は原データが必ず cnt≥2 を使う。
  // reset=true（0x12 mode ~0x80）は適用前に全スロットをクリアする（シーン転換の establishing shot）。
  // 実ラベルを 1 つでも置いたら被せ CG を閉じ下レイヤへ復帰する（HU-63。全消しのみなら被せ CG は保持）。
  // narration は「見た目」が変わるときだけ flush（HU-34）。
  const applySprite = (slots: (string | null)[], reset: boolean) => {
    const before = visSig(stickyOverlay, stickySlots)
    const next: (SpriteRef | undefined)[] = reset ? [] : stickySlots.slice(0, slots.length)
    let setsReal = false
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      if (s === null) continue // 変更なし
      if (s === '-') {
        next[i] = undefined // 空き＝そのスロットをクリア
        continue
      }
      next[i] = { label: s, body: null, face: null }
      setsReal = true
    }
    while (next.length && next[next.length - 1] === undefined) next.pop() // 末尾の空きを詰める
    const nextOverlay = setsReal ? undefined : stickyOverlay
    if (cur?.kind === 'narration' && visSig(nextOverlay, next) !== before) flush()
    stickyOverlay = nextOverlay
    stickySlots = next
  }
  // 立ち絵オフ（off イベント）。全スロットを消すと以降の beat は sprite 無し＝エンジンが立ち絵を隠す。
  // bg・被せ CG には触れない（HU-36）。被せ CG 中は見た目不変のため flush しない。
  const clearAllSprites = () => {
    if (
      cur?.kind === 'narration' &&
      visSig(stickyOverlay, []) !== visSig(stickyOverlay, stickySlots)
    )
      flush()
    stickySlots = []
  }
  // 効果音（se イベント・ワンショット）。現 beat があればそこへ、無ければ次 beat へ持ち越す。
  const addSe = (sceneCode: string) => {
    if (cur) (cur.se ??= []).push({ code: sceneCode, file: null })
    else pendingSe.push({ code: sceneCode, file: null })
  }
  // 背景ボイス（bgv イベント）。単一ループチャンネルで次 BGV まで持続（HU-37）。
  const setBgv = (id: string) => {
    if (id === stickyBgv?.id) return
    if (cur?.kind === 'narration') flush()
    stickyBgv = { id, file: null }
  }
  // ループ se（lpse イベント・0x16）。BGV 同型の単一ループチャンネルで、次の lpse まで／シーン離脱まで
  // 持続する（停止マーカーは原データに無い・HU-76）。変化時に narration を flush して正しい行から鳴らす。
  const setLpse = (code: string) => {
    if (code === stickyLpse?.code) return
    if (cur?.kind === 'narration') flush()
    stickyLpse = { code, file: null }
  }
  // アイテム CG 窓（HU-70）。座標は item イベント（bytecode 0x3b）由来。itemclose（0x3c）で閉じる。
  const openItem = (code: string, x: number, y: number) => {
    if (cur?.kind === 'narration') flush()
    stickyItem = { code, file: null, x, y }
  }
  const closeItem = () => {
    if (stickyItem === undefined) return
    if (cur?.kind === 'narration') flush()
    stickyItem = undefined
  }

  // bg イベントの label を下レイヤ背景 / 被せ CG（EV・黒）へ振り分ける（HU-63）。
  const applyBg = (label: string) => {
    if (label === 'BG_BLACK' || label === BLACK_BG_LABEL) setOverlay(BLACK_BG_LABEL)
    else if (/^#EV/.test(label)) setOverlay(label)
    else setBg(label) // #背景 ほか背景ラベル
  }
  const pushText = (val: string) => {
    const opens = (val.match(/「/g) ?? []).length
    const closes = (val.match(/」/g) ?? []).length

    if (quoteDepth > 0) {
      // セリフ継続行（line beat の lines に追記）
      cur?.lines?.push(val)
      quoteDepth = Math.max(0, quoteDepth + opens - closes)
      return
    }

    if (opens > 0) {
      // セリフ開始 → 新規 line beat
      flush()
      const prefix = pendingVoice ? pendingVoice.slice(0, pendingVoice.indexOf('_')) : null
      let who: string
      if (pendingSpeaker) who = pendingSpeaker
      // 有声で speaker 欠落: 接頭辞→話者の学習済み対応、無ければ直前話者→接頭辞そのもの（HU-67）。
      else if (prefix) who = voiceMap.get(prefix) ?? lastWho ?? prefix
      // 無声・無記名 = 未収録の主人公（PROTAGONIST_BY_LOCALE のコメント参照）。
      else who = PROTAGONIST_BY_LOCALE[locale]
      if (pendingSpeaker && prefix) voiceMap.set(prefix, pendingSpeaker)

      cur = { kind: 'line', who, lines: [val], ...snapshot() }
      if (pendingVoice) cur.voice = { id: pendingVoice, file: null }
      lastWho = who
      pendingSpeaker = null
      pendingVoice = null
      quoteDepth = Math.max(0, opens - closes)
      return
    }

    // 地の文 → 現在ページ（末尾）に行を追加。空ページが無ければ作る。
    if (cur && cur.kind !== 'narration') flush()
    if (!cur) cur = { kind: 'narration', pages: [[]], ...snapshot() }
    const pages = cur.pages!
    // セクションカード（`\N`）は独立ページにする（描画側 isSectionCard が題字として扱う・HU-78）。
    const isCard = /\\[Nn]/.test(val)
    if (isCard) {
      if (pages[pages.length - 1].length > 0) pages.push([])
      pages[pages.length - 1].push(val)
      pages.push([]) // 後続の地の文は新ページから
    } else {
      pages[pages.length - 1].push(val)
    }
  }

  // 改ページ（page イベント / 0x04）。地の文の現在ページを閉じ、次ページを開く。セリフ（line）は
  // 1 発話まるごと表示するため無視。現在 narration beat が無ければ no-op（先頭の 0x04 等）。
  const pageBreak = () => {
    if (cur?.kind !== 'narration') return
    const pages = cur.pages!
    if (pages[pages.length - 1].length > 0) pages.push([])
  }

  for (const ev of sceneEvents.events) {
    const tag = ev[0]
    if (tag === 'text') pushText(ev[1])
    else if (tag === 'speaker') {
      // 新発話の確定的境界。未クローズ「」でも quoteDepth を 0 に戻す（HU-42）。
      flush()
      quoteDepth = 0
      pendingSpeaker = ev[1]
    } else if (tag === 'voice') {
      pendingVoice = ev[1]
      quoteDepth = 0
    } else if (tag === 'se') addSe(ev[1])
    else if (tag === 'lpse') setLpse(ev[1])
    else if (tag === 'bg') applyBg(ev[1])
    else if (tag === 'sprite') applySprite(ev[1], ev[2] === true)
    else if (tag === 'item') openItem(ev[1], ev[2], ev[3])
    else if (tag === 'itemclose') closeItem()
    else if (tag === 'off') clearAllSprites()
    else if (tag === 'page') pageBreak()
    else if (tag === 'bgv') setBgv(ev[1])
    else if (tag === 'flash') pendingFlash = ev[1]
  }
  flush()

  const scene: Scene = { code, route, locale, beats }
  if (title !== undefined) scene.title = title
  return Scene.parse(scene)
}
