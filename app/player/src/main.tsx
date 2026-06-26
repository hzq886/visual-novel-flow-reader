import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { usePlayer } from '@/store/player'
import { loadScene } from '@/engine/sceneLoader'

// dev 限定のデバッグフック（prod バンドルでは除去）。手動テスト用に store と任意シーン
// ジャンプを公開する。例: __jump('005_MAKO001A') で分岐直前のシーンへ。
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__player = usePlayer
  w.__jump = async (code: string) => usePlayer.getState().load(await loadScene(code))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
