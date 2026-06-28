/**
 * defs — _SPRSET.txt / _BGSET.txt を解決テーブルにパースし、
 * シーンの `[note]` ラベルを立ち絵参照（SpriteRef）/ 背景参照（BgRef）へ解決する純関数群。
 *
 * 原データの構造（data_extract/text/md_scr_text_jp/）:
 *  _SPRSET.txt … PREFIX ブロックの連なり。
 *    [note] PREFIX:綾菜（中）・通常１（夕）,CH01B_01_02   ← prefixLabel , code
 *    [note] BODY:・私服０２,_003_02                       ← bodyLabel , suffix
 *    [note] FACE:・にっこり１,_102_01,342,84              ← faceLabel , suffix , x , y
 *    [id] PARTS: / [id] PARTS2:                           ← ブロック終端（無視）
 *
 * 立ち絵は **body + face の2層**で完結する。`PARTS:`/`PARTS2:` は _SPRSET 書式上の追加パーツ層の
 * 区切りだが、本作は **値が常に空**（jp 318件すべて空・cn は出現なし）＝パーツを一切定義しない。
 * 表情差分は FACE 層が担う。よって取り込むべき追加レイヤは無い（HU-39 で RE 確認・台帳化済）。
 *  _BGSET.txt … [note] ラベル → 直後の [id] コードの辞書。
 *    [note] #背景・喫茶店（夕）
 *    [id] BG20_02_00
 *
 * シーン側 note は「prefixLabel + bodyLabel + faceLabel」を直結した文字列
 * （"・" は各ラベルの一部）。例: "#綾菜（中）・通常１（夕）・私服０２・にっこり１"。
 * body/face 画像コードは code + suffix（"CH01B_01_02" + "_003_02"）で素材ファイル名に一致する。
 */
import type { BgRef, BgsetTable, SpriteRef, SprsetTable } from './types'

// data_extract の [note]/[id] 行 → { tag, value } に分解。該当しない行は null。
function parseLine(line: string): { tag: 'note' | 'id'; value: string } | null {
  const m = /^\[(note|id)\]\s?(.*)$/.exec(line)
  if (!m) return null
  return { tag: m[1] as 'note' | 'id', value: m[2].trimEnd() }
}

/** _SPRSET.txt → prefixLabel → { code, body, face }。 */
export function parseSprset(text: string): SprsetTable {
  const table: SprsetTable = {}
  let cur: SprsetTable[string] | null = null

  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw)
    if (!parsed || parsed.tag !== 'note') continue // [id] PARTS: などは無視

    const colon = parsed.value.indexOf(':')
    if (colon === -1) continue
    const kind = parsed.value.slice(0, colon)
    const rest = parsed.value.slice(colon + 1)

    if (kind === 'PREFIX') {
      // "綾菜（中）・通常１（夕）,CH01B_01_02" — 最後のカンマで label と code に分割。
      const comma = rest.lastIndexOf(',')
      if (comma === -1) continue
      const label = rest.slice(0, comma)
      const code = rest.slice(comma + 1).trim()
      cur = { code, body: {}, face: {} }
      table[label] = cur
    } else if (kind === 'BODY') {
      if (!cur) continue
      const comma = rest.lastIndexOf(',')
      if (comma === -1) continue
      cur.body[rest.slice(0, comma)] = rest.slice(comma + 1).trim()
    } else if (kind === 'FACE') {
      if (!cur) continue
      // "・にっこり１,_102_01,342,84" — 末尾に x,y が付くことがある（透明ブロックは省略）。
      const parts = rest.split(',')
      const label = parts[0]
      const suffix = (parts[1] ?? '').trim()
      const x = parts.length >= 4 ? Number(parts[2]) : 0
      const y = parts.length >= 4 ? Number(parts[3]) : 0
      cur.face[label] = [suffix, x, y]
    }
  }
  return table
}

/** _BGSET.txt → noteラベル → [id]コード。先頭 [id]（#DUMMY 等、note 無し）は無視。 */
export function parseBgset(text: string): BgsetTable {
  const table: BgsetTable = {}
  let pending: string | null = null // 直前の [note] ラベル

  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw)
    if (!parsed) continue
    if (parsed.tag === 'note') {
      pending = parsed.value
    } else if (pending !== null) {
      table[pending] = parsed.value.trim()
      pending = null
    }
  }
  return table
}

/**
 * シーンの立ち絵 note（"#綾菜（中）・通常１（夕）・私服０２・にっこり１"）を SpriteRef へ解決。
 * 先頭 "#" を除いた文字列に対し、テーブル中で最長一致する prefixLabel を採り、
 * 残り（bodyLabel + faceLabel）から body/face コードと顔オフセットを引く。
 */
export function resolveSprite(table: SprsetTable, note: string): SpriteRef {
  const label = note.replace(/^#/, '').trim()

  let prefix = ''
  for (const p of Object.keys(table)) {
    if ((label === p || label.startsWith(p + '・')) && p.length > prefix.length) prefix = p
  }
  if (!prefix) return { label, body: null, face: null }

  const entry = table[prefix]
  const rest = label.slice(prefix.length) // "・私服０２・にっこり１" or ""
  const segs = rest.split('・').filter((s) => s.length > 0)
  const bodyKey = segs[0] != null ? '・' + segs[0] : undefined
  const faceKey = segs[1] != null ? '・' + segs[1] : undefined

  const bodySuffix = bodyKey != null ? entry.body[bodyKey] : undefined
  const faceVal = faceKey != null ? entry.face[faceKey] : undefined

  const ref: SpriteRef = {
    label,
    body: bodySuffix != null ? entry.code + bodySuffix : null,
    face: faceVal != null ? entry.code + faceVal[0] : null,
  }
  if (faceVal != null) ref.offset = [faceVal[1], faceVal[2]]
  return ref
}

// `#` を持たない bare CG コード（例 ITEM_03_01）= [id] 直書きで指定される CG。
// _BGSET ラベルを介さず id がそのまま CG ファイルコードになる（HU-41）。
const DIRECT_CG_CODE = /^[A-Z0-9_]+$/

/** シーンの背景 note（"#背景・喫茶店（夕）"）を BgRef へ解決。 */
export function resolveBg(table: BgsetTable, note: string): BgRef {
  const label = note.trim()
  if (label in table) return { label, file: table[label] }
  // bgset 未登録でも、`#` の無い bare CG コードはそのまま file として通す（[id] 直書きの
  // ITEM_* など。将来 GRA: の直 CG 指定にも適用可能）。`#` 付き note の未解決は従来通り
  // file=null（validate が検出）。
  if (DIRECT_CG_CODE.test(label)) return { label, file: label }
  return { label, file: null }
}
