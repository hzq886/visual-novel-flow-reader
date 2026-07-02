import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestBookmark, useBookmarks } from './bookmarks'

// node 環境に localStorage が無いため簡易スタブを差す（モジュール側は typeof ガード済み。
// スタブを入れることで永続化の書き込み内容まで検証する）。
const backing = new Map<string, string>()
const storageStub = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
}

beforeEach(() => {
  backing.clear()
  vi.stubGlobal('localStorage', storageStub)
  useBookmarks.setState({ marks: {}, modalCode: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useBookmarks — 保存/上書き/削除（HU-60）', () => {
  it('save は現在位置を保存し localStorage へ永続化する', () => {
    useBookmarks.getState().save('002_AYAN002A', 1, 1)
    const m = useBookmarks.getState().marks['002_AYAN002A']
    expect(m).toMatchObject({ code: '002_AYAN002A', index: 1, line: 1 })
    expect(m.savedAt).toBeGreaterThan(0)
    const persisted = JSON.parse(backing.get('saimin4.bookmarks.v1')!) as Record<string, unknown>
    expect(persisted['002_AYAN002A']).toMatchObject({ index: 1, line: 1 })
  })

  it('同一シーンは上書き（1 ノード 1 件）、別シーンは併存（複数ノード保存可）', () => {
    const s = useBookmarks.getState()
    s.save('002_AYAN002A', 0, 0)
    s.save('002_AYAN002A', 3, 2) // 上書き
    s.save('005_MAKO003A', 1, 0) // 別ノード
    const marks = useBookmarks.getState().marks
    expect(Object.keys(marks).sort()).toEqual(['002_AYAN002A', '005_MAKO003A'])
    expect(marks['002_AYAN002A']).toMatchObject({ index: 3, line: 2 })
  })

  it('remove は該当シーンのみ削除し、対象のモーダルが開いていれば閉じる', () => {
    const s = useBookmarks.getState()
    s.save('A', 0, 0)
    s.save('B', 0, 0)
    s.openModal('A')
    useBookmarks.getState().remove('A')
    expect(useBookmarks.getState().marks.A).toBeUndefined()
    expect(useBookmarks.getState().marks.B).toBeDefined()
    expect(useBookmarks.getState().modalCode).toBeNull()
  })

  it('latestBookmark は savedAt が最新のものを返す（時系列保持）', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(100)
    useBookmarks.getState().save('A', 0, 0)
    now.mockReturnValueOnce(300)
    useBookmarks.getState().save('B', 2, 1)
    now.mockReturnValueOnce(200)
    useBookmarks.getState().save('C', 5, 0)
    expect(latestBookmark()?.code).toBe('B')
    expect(latestBookmark({})).toBeNull()
  })

  it('openModal / closeModal で操作モーダル対象を切り替える', () => {
    useBookmarks.getState().openModal('X')
    expect(useBookmarks.getState().modalCode).toBe('X')
    useBookmarks.getState().closeModal()
    expect(useBookmarks.getState().modalCode).toBeNull()
  })
})
