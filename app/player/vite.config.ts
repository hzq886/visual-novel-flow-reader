import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  server: {
    // repo ルート配下（data/ やテキスト原本）を dev サーバから参照できるよう許可
    fs: { allow: ['../..'] },
  },
  build: {
    // 既定の 'assets' だと public/assets（ゲーム素材 2.4GB のコピー）とバンドル出力が
    // dist/assets に同居する。Electron パッケージで素材を除外できるよう出力先を分離（HU-64）。
    assetsDir: 'static',
  },
})
