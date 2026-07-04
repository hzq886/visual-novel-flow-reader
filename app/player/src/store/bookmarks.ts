/**
 * store/bookmarks — ブックマーク（セーブデータ）の Zustand ストア（HU-60）。
 * 1 シーン（＝フロー図の 1 ノード）につき 1 件で上書き。複数シーンにはそれぞれ保存できる。
 * savedAt（epoch ms）で時系列を保持し、latestBookmark() が最終保存を返す（起動時の自動ジャンプ用）。
 * 永続化（HU-65）: Electron では preload の saimin4Desktop.bookmarks 経由で userData/bookmarks.json、
 * Web（npm run dev）では従来どおり localStorage（キー saimin4.bookmarks.v1）へフォールバック。
 * Electron 初回起動（ファイル無し）は localStorage の v1 データをファイルへ移行する。
 */
import { create } from 'zustand'

export type Bookmark = {
  code: string // シーンコード（例 "002_AYAN002A"）
  index: number // beat index
  line: number // beat 内の行サブインデックス（narration の行送り）
  savedAt: number // epoch ms（時系列・最終保存の判定）
}

const STORAGE_KEY = 'saimin4.bookmarks.v1'

// preload（electron/preload.ts）が公開するファイル永続化ブリッジ。無ければ Web 実行。
type DesktopBookmarks = {
  read: () => unknown // Record<string, Bookmark> | null（null = ファイル無し）
  write: (marks: Record<string, Bookmark>) => void
}

function desktopBookmarks(): DesktopBookmarks | undefined {
  return (globalThis as { saimin4Desktop?: { bookmarks?: DesktopBookmarks } }).saimin4Desktop
    ?.bookmarks
}

function sanitize(parsed: unknown): Record<string, Bookmark> {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, Bookmark>)
    : {}
}

// localStorage はテスト（node 環境）や容量超過で使えないことがあるため、読み書きとも防御的に。
// 失敗時はメモリ上の状態だけで動作を継続する（揮発）。
function readLocalStorage(): Record<string, Bookmark> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch {
    return {}
  }
}

function writeLocalStorage(marks: Record<string, Bookmark>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    /* 書けなくても再生は継続 */
  }
}

/**
 * 起動時の初期読込（store 生成時に 1 回。テストからも直接呼ぶ）。
 * Electron: ファイルを読む。ファイル無し（null）は初回起動 → localStorage v1 の内容を
 * ファイルへ移行する（空でも書いてファイルを作る＝次回以降は移行しない）。
 * 移行後も localStorage は消さない（write は片方向で成否が取れず、消すと喪失リスクがある。
 * ファイルが存在する限り再移行はしないので実害はない）。
 */
export function readInitialMarks(): Record<string, Bookmark> {
  const desktop = desktopBookmarks()
  if (!desktop) return readLocalStorage()
  try {
    const fromFile = desktop.read()
    if (fromFile !== null) return sanitize(fromFile)
    const legacy = readLocalStorage()
    desktop.write(legacy)
    return legacy
  } catch {
    return readLocalStorage()
  }
}

function writeStorage(marks: Record<string, Bookmark>): void {
  const desktop = desktopBookmarks()
  if (desktop) {
    try {
      desktop.write(marks)
    } catch {
      /* 書けなくても再生は継続 */
    }
    return
  }
  writeLocalStorage(marks)
}

type BookmarksState = {
  marks: Record<string, Bookmark>
  modalCode: string | null // ブックマークアイコンのダブルクリックで開く操作モーダルの対象シーン
  save: (code: string, index: number, line: number) => void
  remove: (code: string) => void
  openModal: (code: string) => void
  closeModal: () => void
}

export const useBookmarks = create<BookmarksState>((set, get) => ({
  marks: readInitialMarks(),
  modalCode: null,
  // 同一シーンは上書き（1 ノード 1 件）。別シーンは追加。
  save: (code, index, line) => {
    const marks = { ...get().marks, [code]: { code, index, line, savedAt: Date.now() } }
    writeStorage(marks)
    set({ marks })
  },
  remove: (code) => {
    const marks = { ...get().marks }
    delete marks[code]
    writeStorage(marks)
    // 削除対象のモーダルが開いていれば閉じる。
    set((s) => ({ marks, modalCode: s.modalCode === code ? null : s.modalCode }))
  },
  openModal: (code) => set({ modalCode: code }),
  closeModal: () => set({ modalCode: null }),
}))

/** 最終保存のブックマーク（無ければ null）。起動時の自動ジャンプ（HU-60）に使う。 */
export function latestBookmark(
  marks: Record<string, Bookmark> = useBookmarks.getState().marks,
): Bookmark | null {
  let best: Bookmark | null = null
  for (const b of Object.values(marks)) if (!best || b.savedAt > best.savedAt) best = b
  return best
}
