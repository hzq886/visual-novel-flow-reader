import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { usePlayer } from '@/store/player'
import { loadScene } from '@/engine/sceneLoader'

// 同梱フォント（jp/cn × 400/700）を先読みしておく（cn はロケール切替時に即使えるように）。
// PIXI canvas はフォント遅延ロードを反映しないため、Stage 側でロード完了時に再描画する。
if (typeof document !== 'undefined' && 'fonts' in document) {
  for (const family of ['Zen Kaku Gothic New', 'Alibaba PuHuiTi 3'])
    for (const weight of [400, 700])
      void document.fonts.load(`${weight} 16px '${family}'`).catch(() => {})
}

// dev 限定のデバッグフック（prod バンドルでは除去）。手動テスト用に store と任意シーン
// ジャンプを公開する。例: __jump('005_MAKO001A') で分岐直前のシーンへ。
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__player = usePlayer
  w.__jump = async (code: string) =>
    usePlayer.getState().load(await loadScene(code, usePlayer.getState().locale))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
