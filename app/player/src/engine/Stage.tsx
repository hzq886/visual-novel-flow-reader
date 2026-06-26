/**
 * Stage — PixiJS 描画ステージ。論理ゲーム空間（1280×720）に CgLayer / SpriteLayer /
 * SubtitleLayer を重ね、画面へ contain フィットする。flow.json の開始シーンから始め、
 * クリック / Space / → で beat を送り、シーン末尾では flow に従って次シーンへ遷移する
 * （選択肢ノードでは選択肢オーバーレイを提示）。離脱シーンのテクスチャ/ボイスは解放する。
 */
import { useEffect, useRef } from 'react'
import { Application, Assets, Container } from 'pixi.js'
import { type Beat, type Scene } from '@/pipeline/types'
import { usePlayer } from '@/store/player'
import { AudioManager } from '@/audio/AudioManager'
import { assetUrl, cgUrl, containFit, spriteUrl } from './assets'
import { sceneAssetUrls } from './sceneLoader'
import { CgLayer } from './layers/CgLayer'
import { SpriteLayer } from './layers/SpriteLayer'
import { SubtitleLayer } from './layers/SubtitleLayer'

// 離脱シーンのテクスチャ解放はクロスフェード（Cg 1.4s）完了後に行う。
const ASSET_RELEASE_DELAY_MS = 1800

export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null)
  // HUD / 選択肢は React 側で購読（PIXI の命令的描画とは独立に再レンダ）。
  const scene = usePlayer((s) => s.scene)
  const index = usePlayer((s) => s.index)
  const ended = usePlayer((s) => s.ended)

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
        const audio = new AudioManager()

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
          // 字幕と同期して実ボイスを再生（台詞のみ）。地の文では前のボイスを止める。
          if (beat.kind === 'line' && beat.voice?.file) audio.playVoice(assetUrl(beat.voice.file))
          else audio.stopVoice()
          // この beat の効果音（ワンショット、複数可）を再生。
          for (const s of beat.se ?? []) if (s.file) audio.playSe(assetUrl(s.file))
        }

        // シーン切替時: 旧シーン専用のテクスチャ/ボイスを解放。クロスフェード完了後に、
        // 「現シーンが使う URL」と「レイヤに割り当て中の URL」を除外して unload する
        // （表示中テクスチャを解放すると addressModeU 例外になるため必ず除外）。
        let prevUrls: string[] = []
        const onSceneChange = (s: Scene) => {
          // BGM はシーンを跨いで継続（同 track は no-op）、track が変わるシーンでクロスフェード。
          if (s.bgm?.file) audio.playBgm(assetUrl(s.bgm.file))
          const leaving = prevUrls
          prevUrls = sceneAssetUrls(s)
          audio.releaseVoices()
          if (leaving.length === 0) return
          setTimeout(() => {
            const keep = new Set([...prevUrls, ...cg.inUseUrls(), ...sprite.inUseUrls()])
            // 実際にロード済み（キャッシュ在中）かつ現在未使用の URL だけを解放する
            // （未ロード URL を unload すると "not found in Cache" 警告が出るため絞る）。
            const toFree = leaving.filter((u) => !keep.has(u) && Assets.cache.has(u))
            if (toFree.length > 0) void Assets.unload(toFree).catch(() => {})
          }, ASSET_RELEASE_DELAY_MS)
        }

        // ストアを購読して描画（シーン変更＝先頭 beat、index 変更＝該当 beat）。
        const unsub = usePlayer.subscribe((s, prev) => {
          if (s.ended && !prev.ended) audio.stopBgm() // 終端で BGM を止める
          if (!s.scene) return
          if (s.scene !== prev.scene) {
            onSceneChange(s.scene)
            renderBeat(s.scene.beats[s.index])
          } else if (s.index !== prev.index) {
            renderBeat(s.scene.beats[s.index])
          }
        })

        // 既にシーンが載っていれば描画、無ければ flow の開始シーンをロード。
        const player = usePlayer.getState()
        if (player.scene) {
          onSceneChange(player.scene)
          renderBeat(player.scene.beats[player.index])
        } else {
          void player.start()
        }

        // 入力: クリック / キー。advance はシーン跨ぎ（末尾で次シーン／選択肢）。
        const onClick = () => void usePlayer.getState().advance()
        const onKey = (e: KeyboardEvent) => {
          if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) {
            e.preventDefault()
            void usePlayer.getState().advance()
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            usePlayer.getState().prev()
          }
        }
        app.canvas.addEventListener('pointerdown', onClick)
        window.addEventListener('keydown', onKey)

        cleanup = () => {
          unsub()
          audio.destroy()
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

  const total = scene?.beats.length ?? 0

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <ChoiceOverlay />
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
        {ended
          ? '— 終 —'
          : `${scene?.code ?? '…'} · ${index + 1} / ${total} · クリック / Space で進む`}
      </div>
    </div>
  )
}

/** 分岐ノードの選択肢オーバーレイ（DOM）。pendingChoice がある間だけ表示する。 */
function ChoiceOverlay() {
  const choices = usePlayer((s) => s.pendingChoice)
  const choose = usePlayer((s) => s.choose)
  if (!choices) return null
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: 'rgba(8,10,14,.55)',
        zIndex: 5,
      }}
    >
      {choices.map((o, i) => (
        <button
          key={i}
          onClick={() => void choose(o.target)}
          style={{
            minWidth: 360,
            maxWidth: '80%',
            padding: '14px 22px',
            background: 'rgba(20,24,31,.92)',
            border: '1.5px solid #e0a94f',
            color: '#f4ead2',
            font: '15px system-ui, sans-serif',
            fontWeight: 600,
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
