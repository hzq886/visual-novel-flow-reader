/**
 * scene — 原データ `[text]/[id]/[note]` 行を状態機械でパースし Scene を生成する純関数。
 *
 * 文法（data_extract/text/md_scr_text_<locale>/<code>.txt）:
 *  [text] 古橋綾菜\N喫茶店へ        … 最初の \N 入り本文＝タイトルカード
 *  [id]   BG_BLACK                 … 制御マーカー（beat に影響させない）
 *  [text] ……帰宅する途中、…        … 地の文（narration）。連続行を 1 beat に集約
 *  [note] #背景・喫茶店（夕）         … 背景 sticky 更新（#背景 / #EV）
 *  [note] #綾菜（中）・…・にっこり１  … 立ち絵 sticky 更新（#<キャラ>）
 *  [text] 【古橋綾菜】               … 話者マーカー。直後のセリフ beat に適用（使い切り）
 *  [id]   AYAN_002_AYAN001A_001     … ボイスID（シーンコードを内包）→ 次のセリフ beat へ
 *  [id]   8351A                     … 効果音コード（4桁+英字）→ 現 beat（無ければ次 beat）へ
 *  [text] 「あら、お帰りなさい。和くん」 … セリフ（「」）。「」のバランスで複数行を 1 beat に集約
 *
 * 話者は `【】` が無い場合、ボイスID接頭辞（AYAN 等）→ 話者名 の学習辞書で継承する
 * （例: L27 のセリフは直前話者が和樹でも voice=AYAN なので綾菜と解決）。
 * bg/sprite は beat 生成時点の sticky 値をスナップショット（注記は次 beat 以降に効く）。
 * 素材ファイルの実体解決（manifest 照合）は別工程（resolve*）。ここでは label のみ付与。
 */
import { Scene, type Beat, type BgRef, type Locale, type SeRef, type SpriteRef } from './types'
import { SE_RE } from './audio'

type Draft = {
  kind: 'narration' | 'line'
  who?: string
  voice?: { id: string; file: null }
  lines: string[]
  bg?: BgRef
  sprite?: SpriteRef
  se?: SeRef[]
  bgv?: { id: string; file: null }
  flash?: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
// （本文ではない）。これらはタイトルカード行（`\\N` 入り）の直前に居座り、タイトル判定
// （cur===null 前提）も阻害する。cn ソースには出現しない（別抽出経路でクリーン）。
const JUNK_CHARS = /[\u{e000}-\u{f8ff}\u{fffd}]/gu
// 残骸除去後に本文として残すか。空 or 単独の半角文字（ASCII / 半角カナ）のみなら本文ではない。
const isJunkResidue = (s: string): boolean => s === '' || /^[\x20-\x7e\uff61-\uff9f]$/.test(s)

export function parseScene(text: string, opts: { code: string; locale: Locale }): Scene {
  const { code, locale } = opts
  const route = code.split('_')[0] ?? code
  // ボイスID = <CHAR>_<sceneCode>_<serial>。se コード（0001D 等）は se、BG_BLACK/ITEM_* は背景、
  // OFF は立ち絵オフ、BGV_* は背景ボイスとして取り込む。その他の制御マーカー（MIX/EFFECT 等）は無視。
  const voiceRe = new RegExp(`^[A-Z]+_${escapeRegExp(code)}_\\d+[A-Z]?$`)

  const beats: Beat[] = []
  let title: string | undefined
  let cur: Draft | null = null
  let pendingSpeaker: string | null = null
  let pendingVoice: string | null = null
  let pendingSe: SeRef[] = [] // beat 生成前に現れた se は次 beat へ持ち越す
  let pendingFlash: number | undefined // EFFECT:FLASHn は直後の beat（インパクト行）で光らせる
  let stickyBg: BgRef | undefined
  let stickySprite: SpriteRef | undefined
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
    se?: SeRef[]
    bgv?: { id: string; file: null }
    flash?: number
  }
  const snapshot = (): Snap => {
    const snap: Snap = {
      ...(stickyBg ? { bg: stickyBg } : {}),
      ...(stickySprite ? { sprite: stickySprite } : {}),
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
  // bg/sprite が実際に変化する場合のみ、開いているナレーション beat を flush して
  // 新しい注記を次 beat からスナップショットさせる。これをしないと、ナレーション
  // 途中の背景/立ち絵切替が「次のセリフ等の flush まで遅延／消失」する（HU-34）。
  // セリフ（line）beat や引用継続中には触れない（narration のみ・発話の原子性を維持）。
  const setBg = (label: string) => {
    if (label === stickyBg?.label) return
    if (cur?.kind === 'narration') flush()
    stickyBg = { label, file: null }
  }
  const setSprite = (label: string) => {
    if (label === stickySprite?.label) return
    if (cur?.kind === 'narration') flush()
    stickySprite = { label, body: null, face: null }
  }
  // 立ち絵オフ（[id] OFF）。sticky を消すと以降の beat は sprite 無し＝エンジンが自動で
  // 立ち絵を隠す（Stage は beat.sprite が無ければ sprite.hide()）。bg には触れない（HU-36）。
  const clearSprite = () => {
    if (stickySprite === undefined) return
    if (cur?.kind === 'narration') flush()
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
      if (/^#(背景|EV)/.test(val)) setBg(val)
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
      if (voiceRe.test(val)) {
        pendingVoice = val
        quoteDepth = 0
      }
      // [id] BG_BLACK = 黒一色背景の表示制御（BG_BLACK.png は実アセット）。背景切替として
      // 扱い、ラベル #背景・黒一色 経由で解決させる。無視すると直前 CG が残る（HU-35）。
      else if (val === 'BG_BLACK') setBg(BLACK_BG_LABEL)
      // [id] OFF = 立ち絵オフ。無視すると直前の立ち絵が残り続ける（HU-36）。
      else if (val === 'OFF') clearSprite()
      // [id] ITEM_xx_yy = アイテムCG（全画面クローズアップ）。_BGSET ラベルを介さず id が
      // そのまま CG ファイルコード。背景切替として扱う（resolveBg の直CGフォールバックで解決）。
      // 無視すると直前 CG が残る（HU-41）。
      else if (/^ITEM_\d+_\d+$/.test(val)) setBg(val)
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

    if (title === undefined && beats.length === 0 && cur === null && /\\[Nn]/.test(val)) {
      title = val // タイトルカード（\N は描画側で改行）
      continue
    }

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
      else if (prefix && voiceMap.has(prefix)) who = voiceMap.get(prefix)!
      else if (lastWho) who = lastWho
      else who = prefix ?? ''
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
