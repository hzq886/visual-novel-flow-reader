/**
 * Stage — PixiJS 描画ステージ。論理ゲーム空間（1280×720）に CgLayer / SpriteLayer /
 * SubtitleLayer を重ね、画面へ contain フィットする。data/scenes/002_AYAN001A.json を読み、
 * クリック / Space / →←  で beat を送りながら背景・立ち絵・字幕を描画する。
 */
import { useEffect, useRef } from 'react'
import { Application, Container } from 'pixi.js'
import sceneJson from '@data/scenes/002_AYAN001A.json'
import { Scene, type Beat } from '@/pipeline/types'
import { usePlayer } from '@/store/player'
import { cgUrl, containFit, spriteUrl } from './assets'
import { CgLayer } from './layers/CgLayer'
import { SpriteLayer } from './layers/SpriteLayer'
import { SubtitleLayer } from './layers/SubtitleLayer'

const scene = Scene.parse(sceneJson)

export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const index = usePlayer((s) => s.index)
  const total = scene.beats.length

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let app: Application | null = null
    let cleanup: (() => void) | null = null
    const application = new Application()

    application
      .init({
        resizeTo: host,
        background: '#000000',
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        if (cancelled) {
          application.destroy(true, { children: true })
          return
        }
        app = application
        host.appendChild(app.canvas)

        const root = new Container()
        app.stage.addChild(root)
        const cg = new CgLayer(app.ticker)
        const sprite = new SpriteLayer(app.ticker)
        const subtitle = new SubtitleLayer(app.ticker)
        root.addChild(cg, sprite, subtitle)

        const layout = () => {
          const { scale, x, y } = containFit(app!.screen.width, app!.screen.height)
          root.scale.set(scale)
          root.position.set(x, y)
        }
        layout()
        app.renderer.on('resize', layout)

        const renderBeat = (beat: Beat) => {
          if (beat.bg?.file) void cg.show(cgUrl(beat.bg.file))
          cg.setGray(0) // 感情(gray)データは未抽出のため 0
          if (beat.sprite?.body) {
            void sprite.show(
              spriteUrl(beat.sprite.body),
              beat.sprite.face ? spriteUrl(beat.sprite.face) : null,
              beat.sprite.offset,
            )
          } else {
            sprite.hide()
          }
          subtitle.show(beat)
        }

        // ストアを起点に描画（load → beat0、以降は index 変更で再描画）。
        const player = usePlayer.getState()
        player.load(scene)
        renderBeat(scene.beats[usePlayer.getState().index])
        const unsub = usePlayer.subscribe((s, prev) => {
          if (s.index !== prev.index && s.scene) renderBeat(s.scene.beats[s.index])
        })

        // 入力: クリック / キー。
        const onClick = () => usePlayer.getState().next()
        const onKey = (e: KeyboardEvent) => {
          if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) {
            e.preventDefault()
            usePlayer.getState().next()
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            usePlayer.getState().prev()
          }
        }
        app.canvas.addEventListener('pointerdown', onClick)
        window.addEventListener('keydown', onKey)

        cleanup = () => {
          unsub()
          window.removeEventListener('keydown', onKey)
          app?.canvas.removeEventListener('pointerdown', onClick)
          app?.renderer.off('resize', layout)
        }
      })

    return () => {
      cancelled = true
      cleanup?.()
      if (app) {
        app.canvas.remove()
        app.destroy(true, { children: true })
        app = null
      }
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 10,
          color: 'rgba(255,255,255,.7)',
          font: '12px system-ui, sans-serif',
          letterSpacing: '.12em',
          textShadow: '0 1px 4px #000',
          pointerEvents: 'none',
        }}
      >
        {index + 1} / {total} · クリック / Space で進む
      </div>
    </div>
  )
}
