/**
 * App — 物語再生（Stage）とルート分岐図（FlowMap）の 2 ビューを切り替える。
 * Stage は常時マウントして再生位置を保持し、FlowMap は map ビュー時にオーバーレイ表示する。
 * Tab キーまたは右上ボタンで切替（prototype の toggleView 相当）。両ビューとも usePlayer を共有。
 */
import { useEffect, useState } from 'react'
import { Stage } from '@/engine/Stage'
import { FlowMap } from '@/flow/FlowMap'
import { usePlayer } from '@/store/player'
import { UI_FONT } from '@/theme'

type View = 'story' | 'map'

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
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Stage />
      {view === 'map' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
          <FlowMap />
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
  )
}

export default App
