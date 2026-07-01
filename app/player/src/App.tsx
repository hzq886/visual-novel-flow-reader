/**
 * App — 物語再生（Stage）とルート分岐図（FlowMap）の 2 ビューを切り替える。
 * Stage は常時マウントして再生位置を保持し、FlowMap は map ビュー時にオーバーレイ表示する。
 * Tab キーまたは右上ボタンで切替（prototype の toggleView 相当）。両ビューとも usePlayer を共有。
 *
 * レイアウト（HU-52）: アプリ全体を 16:9（原ゲーム論理解像度 1280×720）に固定する。
 * 外側は全ウィンドウの黒背景（レターボックス）、内側にウィンドウ内で最大の 16:9 ボックスを
 * 中央寄せし、Stage / FlowMap / 右上ボタンをすべてこの 16:9 ボックス内に配置する。
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
import { UI_FONT } from '@/theme'

type View = 'story' | 'map'

// 全ウィンドウのレターボックス背景（黒）。装飾は載せない（ドット等は別チケット / flow 専用）。
const letterboxStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#000',
  display: 'flex',
}

// ウィンドウ内で最大の 16:9 ボックスを中央寄せ。Stage / FlowMap / ボタンはこの中に配置する。
const boxStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(100vw, calc(100vh * 16 / 9))',
  height: 'min(100vh, calc(100vw * 9 / 16))',
  margin: 'auto',
  overflow: 'hidden',
}

const btnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  zIndex: 20,
  background: 'rgba(20,24,31,.78)',
  border: '1px solid #2a313e',
  color: '#e7ecf3',
  font: `12px ${UI_FONT}`,
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: 9,
  cursor: 'pointer',
}

function App() {
  const [view, setView] = useState<View>('story')
  const locale = usePlayer((s) => s.locale)
  const setLocale = usePlayer((s) => s.setLocale)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        setView((v) => (v === 'story' ? 'map' : 'story'))
      } else if (e.key.toLowerCase() === 'l') {
        // L キーで言語トグル（テキスト入力欄が無いビューア専用画面なので素のキーで可）。
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
        <button
          onClick={() => void setLocale(locale === 'jp' ? 'cn' : 'jp')}
          aria-label="言語切替 / 切换语言"
          style={{ ...btnStyle, right: 132 }}
        >
          {locale === 'jp' ? '🌐 日本語 → 中文 (L)' : '🌐 中文 → 日本語 (L)'}
        </button>
        <button
          onClick={() => setView((v) => (v === 'story' ? 'map' : 'story'))}
          style={{ ...btnStyle, right: 12 }}
        >
          {view === 'story' ? '🗺 ルート図 (Tab)' : '▶ 物語へ (Tab)'}
        </button>
      </div>
    </div>
  )
}

export default App
