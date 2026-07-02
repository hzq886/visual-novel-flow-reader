/**
 * store/bookmarks — ブックマーク（セーブデータ）の Zustand ストア（HU-60）。
 * 1 シーン（＝フロー図の 1 ノード）につき 1 件で上書き。複数シーンにはそれぞれ保存できる。
 * savedAt（epoch ms）で時系列を保持し、latestBookmark() が最終保存を返す（起動時の自動ジャンプ用）。
 * 永続化は localStorage（Electron 化までの暫定。ADR 不要の一時方式・キーは v1 サフィックスで移行余地を残す）。
 */
import { create } from 'zustand'

export type Bookmark = {
  code: string // シーンコード（例 "002_AYAN002A"）
  index: number // beat index
  line: number // beat 内の行サブインデックス（narration の行送り）
  savedAt: number // epoch ms（時系列・最終保存の判定）
}

const STORAGE_KEY = 'saimin4.bookmarks.v1'

// localStorage はテスト（node 環境）や容量超過で使えないことがあるため、読み書きとも防御的に。
// 失敗時はメモリ上の状態だけで動作を継続する（揮発）。
function readStorage(): Record<string, Bookmark> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Bookmark>) : {}
  } catch {
    return {}
  }
}

function writeStorage(marks: Record<string, Bookmark>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    /* 書けなくても再生は継続 */
  }
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
  marks: readStorage(),
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
