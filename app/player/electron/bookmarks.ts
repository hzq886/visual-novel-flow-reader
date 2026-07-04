/**
 * electron/bookmarks — ブックマークのファイル永続化（HU-65）。
 * userData/bookmarks.json の読み書きを担う純 Node 関数（Vitest 対象）。
 * IPC 配線は main.ts、レンダラ側のフォールバック・移行判定は src/store/bookmarks.ts。
 */
import fs from 'node:fs'
import path from 'node:path'

export const BOOKMARKS_FILENAME = 'bookmarks.json'

/**
 * ブックマークファイルを読む。
 * - ファイル無し → null（初回起動＝localStorage からの移行判定に使うため {} と区別する）
 * - 破損 JSON・オブジェクト以外 → {}（読めなくても再生は継続）
 */
export function readBookmarksFile(file: string): Record<string, unknown> | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * ブックマークファイルを書く。親ディレクトリが無ければ作成。
 * 途中書き（電源断など）で破損しないよう tmp へ書いてから rename で原子的に置換する。
 */
export function writeBookmarksFile(file: string, marks: Record<string, unknown>): void {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(marks, null, 2))
  fs.renameSync(tmp, file)
}
