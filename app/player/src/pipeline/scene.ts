/**
 * scene — 原データ `[text]/[id]/[note]` 行を状態機械でパースし Scene を生成する純関数。
 *
 * 文法（data_extract/text/md_scr_text_<locale>/<code>.txt）:
 *  [text] 古橋綾菜\N喫茶店へ        … 最初の \N 入り本文＝タイトルカード
 *  [id]   BG_BLACK                 … 制御マーカー（beat に影響させない）
 *  [text] ……帰宅する途中、…        … 地の文（narration）。連続行を 1 beat に集約
 *  [note] #背景・喫茶店（夕）         … 通常背景 sticky 更新（#背景。#EV/黒一色は被せ CG・HU-63）
 *  [note] #綾菜（中）・…・にっこり１  … 立ち絵 sticky 更新（#<キャラ>。被せ CG 表示中なら閉じて復帰）
 *  [text] 【古橋綾菜】               … 話者マーカー。直後のセリフ beat に適用（使い切り）
 *  [id]   AYAN_002_AYAN001A_001     … ボイスID（シーンコードを内包）→ 次のセリフ beat へ
 *  [id]   8351A                     … 効果音コード（4桁+英字）→ 現 beat（無ければ次 beat）へ
 *  [text] 「あら、お帰りなさい。和くん」 … セリフ（「」）。「」のバランスで複数行を 1 beat に集約
 *
 * 話者は `【】` が無い場合、ボイスID接頭辞（AYAN 等）→ 話者名 の学習辞書で継承する
 * （例: L27 のセリフは直前話者が和樹でも voice=AYAN なので綾菜と解決）。
 * bg/sprite は beat 生成時点の sticky 値をスナップショット（注記は次 beat 以降に効く）。
 * 素材ファイルの実体解決（manifest 照合）は別工程（resolve*）。ここでは label のみ付与。
 *
 * レイヤモデル（HU-63）: 原作エンジンは「通常背景＋立ち絵」の下レイヤに、EV（一枚絵）／
 * 黒一色（暗転）の**被せ CG** が覆い被さる 2 層構造。被せ CG 表示中は立ち絵を
 * 描かず（下レイヤの sticky は保持）、立ち絵 note か次の `#背景` note が来た時点で被せ CG が
 * 閉じて下レイヤへ復帰する（EV 中の立ち絵 note 15 件・EV→背景後に立ち絵 note 無し 9 件の
 * 原テキスト精読で確定）。beat 出力は bg = 被せ CG ?? 通常背景、sprite = 被せ CG 中は無し。
 *
 * アイテムCG（HU-70）: ITEM_*（400×400）は被せ CG ではなく**独立のオーバーレイ窓**
 * （bytecode 0x3b/0x3c。→ ADR 0009）。背景・立ち絵はそのまま表示され、窓表示中に立ち絵の
 * 差分変更もある（＝立ち絵 note で閉じない）。表示区間は抽出テキストに現れないため
 * items.json（extract-items.py）の「本文 texts 行で閉じる」を消費し、閉じ位置の本文を
 * nextText と照合してズレを fail-fast させる。beat 出力は item フィールド（bg とは独立）。
 */
import {
  Scene,
  type Beat,
  type BgRef,
  type ItemRef,
  type ItemsTable,
  type Locale,
  type SeRef,
  type SpriteRef,
} from './types'
import { SE_RE } from './audio'

type Draft = {
  kind: 'narration' | 'line'
  who?: string
  voice?: { id: string; file: null }
  lines: string[]
  bg?: BgRef
  sprite?: SpriteRef
  item?: ItemRef
  se?: SeRef[]
  bgv?: { id: string; file: null }
  flash?: number
}

// cn ロケールのソースは別タグ語彙を使う（jp と相互排他）。`[cn]`＝本文／`[ascii]`＝id（voice/se/
// 制御コードは jp と同一）／`[jp]`＝note（立ち絵・背景ラベルは**日本語のまま**＝jp 定義で解決可能）。
// 正準タグ（text/id/note）へ正規化して以降の状態機械をロケール非依存に保つ（HU-29）。
const TAG_ALIAS: Record<string, 'text' | 'id' | 'note'> = { cn: 'text', ascii: 'id', jp: 'note' }

// [id] BG_BLACK（黒一色背景の表示制御）に割り当てる背景ラベル。backgrounds.json / _BGSET.txt で
// #背景・黒一色 → BG_BLACK に解決される（[note] 直書きの既存シーンとラベルを統一）。
const BLACK_BG_LABEL = '#背景・黒一色'

// 原データ抽出時に混入する制御残骸。jp の一部シーン冒頭に PUA 文字（U+F8F3「⬚」/ U+E456）や
// デコード失敗（U+FFFD）が、単独のゴミ文字（"G"/"E"/"\\" 等）を伴って [text] 行として現れる
// （本文ではない）。これらはタイトルカード行（`\\N` 入り）の直前に居座るため、捨てないと
// シーン冒頭に偽の本文 beat を作ってしまう。cn ソースには出現しない（別抽出経路でクリーン）。
const JUNK_CHARS = /[\u{e000}-\u{f8ff}\u{fffd}]/gu
// 残骸除去後に本文として残すか。空 or 単独の半角文字（ASCII / 半角カナ）のみなら本文ではない。
const isJunkResidue = (s: string): boolean => s === '' || /^[\x20-\x7e\uff61-\uff9f]$/.test(s)

// ボイスID = <CHAR>_<route 3桁>_<scene 英数>_<連番>。原ゲームは録音を別シーンで流用するため
// （例: 010_MAIN001A 内の [id] AYAN_001_PRO003A_003）、現在のシーンコードとの一致は要求しない
// （HU-67。一致を要求すると流用ボイス 584 箇所・117 シーンが無音になる）。連番は数字＋英字 1 字が
// 基本で、変則 `_SUB` が 1 件（suzu_003_suzu005A_sub.ogg）。BGV_*（背景ボイス）は 2 セグメント目が
// 3 桁数字でないためマッチせず、後段の分岐が拾う。全ソースの [id]/[ascii] と cv 実ファイル全件に
// 対する双方向照合で過不足なしを確認済（未収録は主人公 KAZU_* のみ＝file null で無音継続）。
const VOICE_ID_RE = /^[A-Z]+_\d{3}_[A-Z]+\d{3}[A-Z]?\d?_(?:\d+[A-Z]?|SUB)$/

// 無声・無記名の発話（ボイスIDも【名前】も無い「…」行）に付与する話者名。主人公（KAZU）は
// ボイス未収録（cv 実ファイル 0 件）のため、無声・無記名の発話は主人公と確定できる（HU-67 で
// 全ルートの実データ検証。直前話者の引き継ぎだと女性の有声セリフに挟まれた主人公の応答が
// 直前の女性名に誤帰属していた）。
const PROTAGONIST_BY_LOCALE: Record<Locale, string> = { jp: '古橋　和樹', cn: '古桥和树' }

export function parseScene(
  text: string,
  opts: { code: string; locale: Locale; items?: ItemsTable },
): Scene {
  const { code, locale } = opts
  const route = code.split('_')[0] ?? code
  // [id] の仕分け: ボイスIDは VOICE_ID_RE、se コード（0001D 等）は se、BG_BLACK/ITEM_* は背景、
  // OFF は立ち絵オフ、BGV_* は背景ボイスとして取り込む。その他の制御マーカー（MIX/EFFECT 等）は無視。

  const beats: Beat[] = []
  let title: string | undefined
  let cur: Draft | null = null
  let pendingSpeaker: string | null = null
  let pendingVoice: string | null = null
  let pendingSe: SeRef[] = [] // beat 生成前に現れた se は次 beat へ持ち越す
  let pendingFlash: number | undefined // EFFECT:FLASHn は直後の beat（インパクト行）で光らせる
  let stickyBg: BgRef | undefined // 通常背景（下レイヤ）
  let stickyOverlay: BgRef | undefined // 被せ CG（EV/黒一色。表示中は立ち絵を隠す・HU-63）
  let stickySprite: SpriteRef | undefined // 立ち絵（下レイヤ。被せ CG 中も保持し復帰時に再表示）
  let stickyItem: ItemRef | undefined // アイテムCG窓（bg/sprite と独立のオーバーレイ・HU-70）
  let itemTextsLeft = 0 // 窓表示中に残り何行の本文を進めるか（items.json の texts を消費）
  let stickyBgv: { id: string; file: null } | undefined
  let quoteDepth = 0
  let lastWho: string | null = null
  const voiceMap = new Map<string, string>() // ボイスID接頭辞 → 話者名

  const flush = () => {
    if (cur) beats.push(cur as Beat)
    cur = null
  }
  // beat 生成時のスナップショット: bg/sprite/bgv の sticky 値＋持ち越し中の se を取り込む
  // （se は使い切り）。bgv（背景ボイス）は bg/sprite 同様、次の BGV まで持続するループ音声。
  type Snap = {
    bg?: BgRef
    sprite?: SpriteRef
    item?: ItemRef
    se?: SeRef[]
    bgv?: { id: string; file: null }
    flash?: number
  }
  const snapshot = (): Snap => {
    // 表示状態 = 被せ CG があればそれが bg・立ち絵は隠す。無ければ通常背景＋立ち絵（HU-63）。
    // アイテム窓は独立フィールド（bg/sprite を隠さない・HU-70）。
    const bg = stickyOverlay ?? stickyBg
    const sprite = stickyOverlay ? undefined : stickySprite
    const snap: Snap = {
      ...(bg ? { bg } : {}),
      ...(sprite ? { sprite } : {}),
      ...(stickyItem ? { item: stickyItem } : {}),
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
  // 表示状態（bg/sprite の見え方）が実際に変化する場合のみ、開いているナレーション beat を
  // flush して新しい注記を次 beat からスナップショットさせる。これをしないと、ナレーション
  // 途中の背景/立ち絵切替が「次のセリフ等の flush まで遅延／消失」する（HU-34）。
  // セリフ（line）beat や引用継続中には触れない（narration のみ・発話の原子性を維持）。
  // 通常背景（#背景）。被せ CG が出ていれば閉じて下レイヤへ復帰する（HU-63）。
  // アイテム窓も防御的に閉じる（原データでは窓表示中の背景変更は 0 件＝通常 texts 消費で閉じ済）。
  const setBg = (label: string) => {
    if (stickyOverlay === undefined && label === stickyBg?.label) return
    if (cur?.kind === 'narration') flush()
    stickyOverlay = undefined
    stickyItem = undefined
    stickyBg = { label, file: null }
  }
  // 被せ CG（#EV / 黒一色）。下レイヤ（通常背景・立ち絵）はそのまま保持する（HU-63）。
  const setOverlay = (label: string) => {
    if (label === stickyOverlay?.label) return
    if (cur?.kind === 'narration') flush()
    stickyOverlay = { label, file: null }
    stickyItem = undefined // 防御的クローズ（setBg と同様）
  }
  // アイテムCG窓を開く（HU-70）。座標・表示区間は items.json（extract-items.py が bytecode
  // 0x3b/0x3c から機械抽出）。区間は「本文 texts 行」で表現され、以降の本文処理で消費する。
  const openItem = (id: string) => {
    const spec = opts.items?.[code]
    const texts = spec?.texts[locale]
    if (!spec || spec.item !== id || texts === undefined)
      throw new Error(
        `[id] ${id}（${code}/${locale}）が items.json に無い/不一致（npm run data:items で再生成）`,
      )
    if (cur?.kind === 'narration') flush()
    stickyItem = { code: id, file: null, x: spec.x, y: spec.y }
    itemTextsLeft = texts
  }
  // アイテム窓の表示区間を本文 1 行ぶん消費する。使い切ったら次の本文＝閉じ位置。
  // 閉じ位置の本文を items.json の nextText と照合し、ズレ（txt 再生成との不整合）を fail-fast。
  const consumeItemText = (line: string) => {
    if (stickyItem === undefined) return
    if (itemTextsLeft > 0) {
      itemTextsLeft--
      return
    }
    const expect = opts.items?.[code]?.nextText[locale]
    if (expect !== undefined && line !== expect)
      throw new Error(
        `${code}: アイテム窓の閉じ位置が items.json と不一致（expected=${JSON.stringify(expect)} actual=${JSON.stringify(line)}）`,
      )
    stickyItem = undefined
    if (cur?.kind === 'narration') flush()
  }
  // 立ち絵 note。被せ CG 表示中に来たら被せ CG を閉じ、通常背景＋立ち絵へ復帰する（HU-63）。
  const setSprite = (label: string) => {
    if (stickyOverlay === undefined && label === stickySprite?.label) return
    if (cur?.kind === 'narration') flush()
    stickyOverlay = undefined
    stickySprite = { label, body: null, face: null }
  }
  // 立ち絵オフ（[id] OFF）。sticky を消すと以降の beat は sprite 無し＝エンジンが自動で
  // 立ち絵を隠す（Stage は beat.sprite が無ければ sprite.hide()）。bg には触れない（HU-36）。
  // 被せ CG 表示中は見た目が変わらない（既に隠れている）ため flush しない。
  const clearSprite = () => {
    if (stickySprite === undefined) return
    if (cur?.kind === 'narration' && stickyOverlay === undefined) flush()
    stickySprite = undefined
  }
  // 背景ボイス（[id] BGV_<CHAR>_<...>）。単一ループチャンネルで、次の BGV までシーン内で持続
  // （停止マーカーは原データに無い＝離脱時にエンジンが停止）。bg/sprite 同様、変化時に narration
  // を flush して正しい行から鳴らす（HU-37）。id がそのまま voice ファイルコード（resolveVoice で解決）。
  const setBgv = (id: string) => {
    if (id === stickyBgv?.id) return
    if (cur?.kind === 'narration') flush()
    stickyBgv = { id, file: null }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const m = /^\[(text|id|note|cn|ascii|jp)\]\s?(.*)$/.exec(rawLine)
    if (!m) continue
    const tag = TAG_ALIAS[m[1]] ?? m[1]
    const raw = m[2].replace(/\s+$/, '')
    if (raw === '') continue
    // 制御残骸（PUA / デコード失敗）を除去。残骸を含む行で除去後が本文を成さない
    // （空 or 単独の半角文字）なら行ごと捨てる＝シーン冒頭のゴミヘッダを除外する。
    const val = raw.replace(JUNK_CHARS, '')
    if (val === '') continue
    if (val !== raw && isJunkResidue(val)) continue

    if (tag === 'note') {
      // #EV（一枚絵）と黒一色（note 直書きの暗転）は被せ CG、#背景 は通常背景（下レイヤ・HU-63）。
      if (/^#EV/.test(val) || val === BLACK_BG_LABEL) setOverlay(val)
      else if (/^#背景/.test(val)) setBg(val)
      else if (val.startsWith('#')) setSprite(val)
      continue
    }

    // [id] マーカー台帳（HU-40 仕分け）。取り込む = 下記の分岐。意図的に無視 = それ以外:
    //  - `_VIEW` / `_START` と、その後に続く小文字 CG コード（例 002_ayan004B_01_02）
    //    = CG ギャラリー登録・複合シーン開始のメタ。本編再生の表示には無関係（gallery 機能は別途）。
    //  - `MIX01/02/03` = 画像トランジションのローカル印 → CgLayer の既定クロスフェードで表現済（HU-38）。
    //  - `SE:` / `MUSIC:` / `GRA:` / `VOL_SET:` / `THM_SIZE:` / `TYPE:` 等のコロン命令 = 演出マクロ表
    //    （`_MANPU`/`_DEF`/`EFFECT`）専用で、build-scenes は `/^[0-9]/` のシーンのみ parse するため
    //    そもそも本関数には到達しない（→ smain_flow_guide.md §3.11 台帳）。
    if (tag === 'id') {
      // 新しいボイスID = 新発話の確定的境界。直前のセリフが未クローズ「」でも quoteDepth を 0 に
      // 戻す（`【speaker】` と同じ役割）。これをしないと、原データに閉じ「」」が欠けた箇所で
      // quoteDepth が 0 に戻らず以降の行を無制限に吸収する（HU-42）。正規の複数行セリフは
      // voice-id を跨がないため正常系では既に 0＝no-op。flush は後続の dialogue/narration 分岐が担う。
      if (VOICE_ID_RE.test(val)) {
        pendingVoice = val
        quoteDepth = 0
      }
      // [id] BG_BLACK = 黒一色（暗転）。被せ CG として扱い（HU-63。表示中は立ち絵を隠す）、
      // ラベル #背景・黒一色 経由で解決させる。無視すると直前 CG が残る（HU-35）。
      else if (val === 'BG_BLACK') setOverlay(BLACK_BG_LABEL)
      // [id] OFF = 立ち絵オフ。無視すると直前の立ち絵が残り続ける（HU-36）。
      else if (val === 'OFF') clearSprite()
      // [id] ITEM_xx_yy = アイテムCG窓（HU-70）。_BGSET ラベルを介さず id がそのまま CG
      // ファイルコード（HU-41）。背景・立ち絵の上に重なる独立オーバーレイで、表示区間・座標は
      // items.json（→ ADR 0009）。
      else if (/^ITEM_\d+_\d+$/.test(val)) openItem(val)
      // [id] BGV_<CHAR>_<...> = 背景ボイス（喘ぎ等のループ）。sticky に保持し次 BGV まで持続（HU-37）。
      else if (/^BGV_/.test(val)) setBgv(val)
      // [id] EFFECT:FLASHn = 画面フラッシュ（n=1-3 の強度）。インパクト行（直後の beat）で光らせる
      // ため次 beat へ持ち越す（HU-38）。MIX01/02/03（画像トランジション）は CgLayer の既定
      // クロスフェードで表現済のため取り込まない。その他 EFFECT:（未使用の FLASH_RED 等）も無視。
      else if (/^EFFECT:FLASH(\d)$/.test(val)) pendingFlash = Number(/(\d)$/.exec(val)![1])
      // 効果音コード（4桁+英字）。現 beat があればそこへ、無ければ次 beat へ持ち越す。
      else if (SE_RE.test(val)) {
        if (cur) (cur.se ??= []).push({ code: val, file: null })
        else pendingSe.push({ code: val, file: null })
      }
      continue
    }

    // --- tag === 'text' ---
    const spk = /^【(.+?)】$/.exec(val)
    if (spk) {
      flush()
      quoteDepth = 0
      pendingSpeaker = spk[1]
      continue
    }

    // タイトルカード（`\N` 入り本文）。通常は冒頭だが、夜→朝のアイキャッチ等で本編 beat の
    // 後に現れることもある（例 011_SUBT003A は前夜の回想 beat の後に `朝の風景\N…`）。最初の
    // 1 つを採用し、セクション境界として開いている beat を flush する（冒頭なら no-op）。
    // `\N` は地の文に出現せず必ずタイトルカード形式なので、最初の出現を拾って安全（HU-49）。
    if (title === undefined && /\\[Nn]/.test(val)) {
      flush()
      title = val // \N は描画側で改行
      continue
    }

    // アイテム窓の表示区間消費（HU-70）。本文（地の文/セリフ。話者【】・タイトルは 0x01 でない
    // ため対象外）1 行ごとに減算し、使い切った本文行の直前で窓を閉じる。
    consumeItemText(val)

    const opens = (val.match(/「/g) ?? []).length
    const closes = (val.match(/」/g) ?? []).length

    if (quoteDepth > 0) {
      // セリフ継続行
      cur?.lines.push(val)
      quoteDepth = Math.max(0, quoteDepth + opens - closes)
      continue
    }

    if (opens > 0) {
      // セリフ開始 → 新規 line beat
      flush()
      const prefix = pendingVoice ? pendingVoice.slice(0, pendingVoice.indexOf('_')) : null
      let who: string
      if (pendingSpeaker) who = pendingSpeaker
      // 有声: 接頭辞→話者の学習済み対応、無ければ従来どおり直前話者→接頭辞そのもの。
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
      continue
    }

    // 地の文
    if (cur && cur.kind !== 'narration') flush()
    if (!cur) cur = { kind: 'narration', lines: [], ...snapshot() }
    cur.lines.push(val)
  }
  flush()

  const scene: Scene = { code, route, locale, beats }
  if (title !== undefined) scene.title = title
  return Scene.parse(scene)
}
