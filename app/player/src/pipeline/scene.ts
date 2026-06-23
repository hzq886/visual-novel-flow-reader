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
 *  [text] 「あら、お帰りなさい。和くん」 … セリフ（「」）。「」のバランスで複数行を 1 beat に集約
 *
 * 話者は `【】` が無い場合、ボイスID接頭辞（AYAN 等）→ 話者名 の学習辞書で継承する
 * （例: L27 のセリフは直前話者が和樹でも voice=AYAN なので綾菜と解決）。
 * bg/sprite は beat 生成時点の sticky 値をスナップショット（注記は次 beat 以降に効く）。
 * 素材ファイルの実体解決（manifest 照合）は別工程（resolve*）。ここでは label のみ付与。
 */
import { Scene, type Beat, type BgRef, type Locale, type SpriteRef } from './types'

type Draft = {
  kind: 'narration' | 'line'
  who?: string
  voice?: { id: string; file: null }
  lines: string[]
  bg?: BgRef
  sprite?: SpriteRef
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseScene(text: string, opts: { code: string; locale: Locale }): Scene {
  const { code, locale } = opts
  const route = code.split('_')[0] ?? code
  // ボイスID = <CHAR>_<sceneCode>_<serial>。制御マーカー（BG_BLACK/OFF/0001D/MIX…）は除外。
  const voiceRe = new RegExp(`^[A-Z]+_${escapeRegExp(code)}_\\d+[A-Z]?$`)

  const beats: Beat[] = []
  let title: string | undefined
  let cur: Draft | null = null
  let pendingSpeaker: string | null = null
  let pendingVoice: string | null = null
  let stickyBg: BgRef | undefined
  let stickySprite: SpriteRef | undefined
  let quoteDepth = 0
  let lastWho: string | null = null
  const voiceMap = new Map<string, string>() // ボイスID接頭辞 → 話者名

  const flush = () => {
    if (cur) beats.push(cur as Beat)
    cur = null
  }
  const snapshot = (): { bg?: BgRef; sprite?: SpriteRef } => ({
    ...(stickyBg ? { bg: stickyBg } : {}),
    ...(stickySprite ? { sprite: stickySprite } : {}),
  })

  for (const rawLine of text.split(/\r?\n/)) {
    const m = /^\[(text|id|note)\]\s?(.*)$/.exec(rawLine)
    if (!m) continue
    const tag = m[1]
    const val = m[2].replace(/\s+$/, '')
    if (val === '') continue

    if (tag === 'note') {
      if (/^#(背景|EV)/.test(val)) stickyBg = { label: val, file: null }
      else if (val.startsWith('#')) stickySprite = { label: val, body: null, face: null }
      continue
    }

    if (tag === 'id') {
      if (voiceRe.test(val)) pendingVoice = val
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
