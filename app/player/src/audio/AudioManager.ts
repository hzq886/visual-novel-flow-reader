/**
 * audio/AudioManager — Howler ラッパ。Sprint 1 縦串では voice（台詞 .ogg）再生を担う。
 * beat 進行に同期して当該ボイスを再生し、beat が変わると前のボイスを止める。
 * （プロトタイプのブラウザ TTS プレースホルダを実 .ogg 再生に置換＝廃止。se/bgm は後続。）
 *
 * Howler は click/touch でしか AudioContext を解除しない。本アプリはキーボードでも beat を
 * 送れるため、ユーザー操作スタック内で suspended の context を明示 resume してから再生する。
 * また生成直後（デコード未完了）の play() は無音になりうるので loaded を待って再生する。
 */
import { Howl, Howler } from 'howler'

export class AudioManager {
  private voiceCache = new Map<string, Howl>()
  private current: Howl | null = null

  /** 台詞ボイスを再生（前のボイスは停止）。同一URLは Howl をキャッシュして再利用。 */
  playVoice(url: string): void {
    this.stopVoice()
    let howl = this.voiceCache.get(url)
    if (!howl) {
      howl = new Howl({ src: [url], preload: true })
      this.voiceCache.set(url, howl)
    }
    this.current = howl

    const target = howl
    const start = () => {
      if (this.current === target) target.play()
    }
    const whenReady = () => {
      if (target.state() === 'loaded') start()
      else target.once('load', start)
    }

    const ctx = Howler.ctx
    if (ctx && ctx.state !== 'running') void ctx.resume().then(whenReady, whenReady)
    else whenReady()
  }

  /** 再生中のボイスを停止。 */
  stopVoice(): void {
    this.current?.stop()
    this.current = null
  }

  /** 全 Howl を解放（Stage アンマウント時）。 */
  destroy(): void {
    this.stopVoice()
    for (const howl of this.voiceCache.values()) howl.unload()
    this.voiceCache.clear()
  }
}
