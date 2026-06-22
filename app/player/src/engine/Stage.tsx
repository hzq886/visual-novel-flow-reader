import { useEffect, useRef } from 'react'
import { Application, Text } from 'pixi.js'

/**
 * VN 描画ステージ（PixiJS / WebGL）。
 * Sprint 0 では空のキャンバスにプレースホルダを描画するのみ。
 * 背景・立ち絵・字幕レイヤは VN-6 で picturebook_v3.html の演出を移植して載せる。
 */
export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let app: Application | null = null
    let cancelled = false

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

        const label = new Text({
          text: '催眠4 — player\nStage ready (Sprint 0)',
          style: {
            fill: '#444a55',
            fontSize: 18,
            fontFamily: 'system-ui, sans-serif',
            align: 'center',
            lineHeight: 26,
          },
        })
        label.anchor.set(0.5)
        const place = () => {
          label.position.set(app!.screen.width / 2, app!.screen.height / 2)
        }
        place()
        app.renderer.on('resize', place)
        app.stage.addChild(label)
      })

    return () => {
      cancelled = true
      if (app) {
        app.canvas.remove()
        app.destroy(true, { children: true })
        app = null
      }
    }
  }, [])

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
