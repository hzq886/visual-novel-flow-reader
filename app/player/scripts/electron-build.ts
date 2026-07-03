/**
 * electron-build — main/preload を esbuild で dist-electron/ へバンドルする。
 * レンダラは既存の vite build のまま（electron-vite 等の統合ツールは使わない — ADR 0008）。
 */
import { build, type BuildOptions } from 'esbuild'
import { pathToFileURL } from 'node:url'

const shared: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node22',
  sourcemap: true,
}

export async function bundleElectron(): Promise<void> {
  await build({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
  })
}

// 直接実行時（npm run build:electron）はそのままバンドル
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await bundleElectron()
}
