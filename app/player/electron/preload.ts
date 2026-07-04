/**
 * electron/preload — レンダラへの橋渡し。
 * デスクトップ実行の識別と、ブックマークのファイル永続化 IPC（HU-65）。
 * read は起動時 1 回だけ呼ぶ想定の同期読み（store 初期化が同期のため）。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('saimin4Desktop', {
  platform: process.platform,
  bookmarks: {
    // null = ファイル無し（初回起動）。レンダラ側の localStorage 移行判定に使う。
    read: (): unknown => ipcRenderer.sendSync('bookmarks:read'),
    write: (marks: Record<string, unknown>): void => ipcRenderer.send('bookmarks:write', marks),
  },
})
