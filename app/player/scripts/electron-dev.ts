/**
 * electron-dev — Vite dev サーバと Electron を同時起動する開発ランチャ。
 * Electron 側は VITE_DEV_SERVER_URL を見て dev サーバへ接続する（electron/main.ts）。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { bundleElectron } from './electron-build'

await bundleElectron()

const server = await createServer()
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) {
  await server.close()
  throw new Error('Vite dev サーバの URL を解決できなかった')
}
server.printUrls()

// Node から import した 'electron' パッケージは実行バイナリのパス（文字列）を返す
const electronBin = (await import('electron')).default as unknown as string
const child = spawn(electronBin, ['.'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
  stdio: 'inherit',
})
child.on('exit', (code) => {
  void server.close().finally(() => process.exit(code ?? 0))
})
