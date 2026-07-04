/**
 * electron/preload — レンダラへの橋渡し。
 * 現状はデスクトップ実行の識別のみ。ブックマークのファイル永続化 IPC は HU-65 で追加予定。
 */
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('saimin4Desktop', {
  platform: process.platform,
})
