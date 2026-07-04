import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  test: {
    // pipeline は純関数（Node 環境）。React/engine は後続スプリントで jsdom を追加。
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'electron/**/*.test.ts'],
  },
})
