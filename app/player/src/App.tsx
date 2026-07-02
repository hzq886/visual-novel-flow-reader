/**
 * App — 物語再生（Stage）とルート分岐図（FlowMap）の 2 ビューを切り替える。
 * Stage は常時マウントして再生位置を保持し、FlowMap は map ビュー時にオーバーレイ表示する。
 * 起動後はルート図（map）から開始する（HU-58）。切替 UI はボタンを置かずキーのみ:
 *   Tab = ビュー切替 / `（Backquote・Tab キーの上）= 言語 jp⇄cn トグル。
 *
 * レイアウト（HU-52）: アプリ全体を 16:9（原ゲーム論理解像度 1280×720）に固定する。
 * 外側は全ウィンドウの黒背景（レターボックス）、内側にウィンドウ内で最大の 16:9 ボックスを
 * 中央寄せし、Stage / FlowMap をすべてこの 16:9 ボックス内に配置する。
 * Electron 化の想定（ネイティブローカルアプリ・自由なリサイズ無し）に向けた土台。
 * NOTE(Electron): Electron 追加時は BrowserWindow.setAspectRatio(16/9) でウィンドウ側も
 *   16:9 にロックすること（レターボックス帯を最小化できる）。
 * Stage は内部で 16:9 に contain フィットするため、この 16:9 ボックス内では過不足なく
 * ちょうど埋まる（二重レターボックスにならない）。
 */
import { useEffect, useState } from 'react'
import { Stage } from '@/engine/Stage'
import { FlowMap } from '@/flow/FlowMap'
import { usePlayer } from '@/store/player'

type View = 'story' | 'map'

// 全ウィンドウのレターボックス背景（黒）。装飾は載せない（ドット等は別チケット / flow 専用）。
const letterboxStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#000',
  display: 'flex',
}

// ウィンドウ内で最大の 16:9 ボックスを中央寄せ。Stage / FlowMap はこの中に配置する。
const boxStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(100vw, calc(100vh * 16 / 9))',
  height: 'min(100vh, calc(100vw * 9 / 16))',
  margin: 'auto',
  overflow: 'hidden',
}

function App() {
  // 起動後の初期画面はルート図（HU-58）。物語はノードクリック / Tab で入る。
  const [view, setView] = useState<View>('map')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        setView((v) => (v === 'story' ? 'map' : 'story'))
      } else if (e.code === 'Backquote') {
        // Tab キー上の ` で言語トグル（HU-58。JIS 配列では同位置の半角/全角キー）。
        // テキスト入力欄が無いビューア専用画面なので素のキーで可。
        e.preventDefault()
        void usePlayer.getState().setLocale(usePlayer.getState().locale === 'jp' ? 'cn' : 'jp')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={letterboxStyle}>
      <div style={boxStyle}>
        <Stage />
        {view === 'map' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
            <FlowMap onJump={() => setView('story')} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
