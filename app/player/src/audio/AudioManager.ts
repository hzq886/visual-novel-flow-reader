/**
 * audio/AudioManager — Howler ラッパ。voice（台詞）に加え bgm（ループ・シーン跨ぎ継続）と
 * se（ワンショット）のチャンネルを持つ。voice は beat に同期、bgm/se は scene/beat のキューに同期する。
 *
 * 本クラスは**再生機構**を提供する。どの beat で何を鳴らすか（bgm/se キュー）のデータは
 * scene JSON 側に必要で、その抽出（bytecode RE）は HU-28 で行う。HU-27 時点では voice のみ実配線。
 *
 * Howler は click/touch でしか AudioContext を解除しない。本アプリはキーボードでも beat を
 * 送れるため、ユーザー操作スタック内で suspended の context を明示 resume してから再生する。
 * また生成直後（デコード未完了）の play() は無音になりうるので loaded を待って再生する。
 */
import { Howl, Howler } from 'howler'

const BGM_FADE_MS = 800

export class AudioManager {
  private voiceCache = new Map<string, Howl>()
  private current: Howl | null = null
  private seCache = new Map<string, Howl>()
  private bgm: Howl | null = null
  private bgmUrl: string | null = null
  private bgvCache = new Map<string, Howl>()
  private bgv: Howl | null = null
  private bgvUrl: string | null = null

  /** AudioContext が suspended なら resume してから cb を実行（ユーザー操作スタック内で呼ぶ）。 */
  private withContext(cb: () => void): void {
    const ctx = Howler.ctx
    if (ctx && ctx.state !== 'running') void ctx.resume().then(cb, cb)
    else cb()
  }

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
    this.withContext(() => {
      if (target.state() === 'loaded') start()
      else target.once('load', start)
    })
  }

  /** 再生中のボイスを停止。 */
  stopVoice(): void {
    this.current?.stop()
    this.current = null
  }

  /**
   * BGM を再生（ループ）。同一 URL が既に鳴っていれば何もしない（シーンを跨いで継続）。
   * 別曲なら前の BGM をフェードアウトしつつ新曲をフェードインする。
   */
  playBgm(url: string): void {
    if (url === this.bgmUrl) return
    const prev = this.bgm
    if (prev) {
      prev.fade(prev.volume(), 0, BGM_FADE_MS)
      prev.once('fade', () => prev.stop())
    }
    const howl = new Howl({ src: [url], loop: true, volume: 0 })
    this.bgm = howl
    this.bgmUrl = url
    const start = () => {
      if (this.bgm !== howl) return
      howl.play()
      howl.fade(0, 1, BGM_FADE_MS)
    }
    this.withContext(() => {
      if (howl.state() === 'loaded') start()
      else howl.once('load', start)
    })
  }

  /** BGM を停止（フェードアウト）。 */
  stopBgm(): void {
    const prev = this.bgm
    if (prev) {
      prev.fade(prev.volume(), 0, BGM_FADE_MS)
      prev.once('fade', () => prev.stop())
    }
    this.bgm = null
    this.bgmUrl = null
  }

  /**
   * 背景ボイス（喘ぎ等のループ音声）を再生。単一チャンネルで、別 URL なら前を停止して切替、
   * 同一 URL なら継続（no-op）。シーン内で次の BGV まで持続し、シーン離脱で停止する（HU-37）。
   */
  playBgv(url: string): void {
    if (url === this.bgvUrl) return
    this.bgv?.stop()
    let howl = this.bgvCache.get(url)
    if (!howl) {
      howl = new Howl({ src: [url], loop: true, preload: true })
      this.bgvCache.set(url, howl)
    }
    this.bgv = howl
    this.bgvUrl = url
    const target = howl
    const start = () => {
      if (this.bgv === target) target.play()
    }
    this.withContext(() => {
      if (target.state() === 'loaded') start()
      else target.once('load', start)
    })
  }

  /** 背景ボイスを停止（シーン離脱・終端）。 */
  stopBgv(): void {
    this.bgv?.stop()
    this.bgv = null
    this.bgvUrl = null
  }

  /** 効果音をワンショット再生（多重再生可）。同一 URL は Howl をキャッシュ。 */
  playSe(url: string): void {
    let howl = this.seCache.get(url)
    if (!howl) {
      howl = new Howl({ src: [url], preload: true })
      this.seCache.set(url, howl)
    }
    const target = howl
    this.withContext(() => {
      if (target.state() === 'loaded') target.play()
      else target.once('load', () => target.play())
    })
  }

  /**
   * voice キャッシュを解放（シーン離脱時。次シーンの voice は都度ロードし直す＝メモリを抱えない）。
   * 背景ボイス（BGV）はシーン局所なのでここで停止する（ループはシーンを跨がない）。
   */
  releaseVoices(): void {
    this.stopVoice()
    this.stopBgv()
    for (const howl of this.voiceCache.values()) howl.unload()
    this.voiceCache.clear()
  }

  /** 全 Howl を解放（Stage アンマウント時）。 */
  destroy(): void {
    this.stopVoice()
    this.stopBgv()
    this.bgm?.stop()
    this.bgm = null
    this.bgmUrl = null
    for (const howl of this.voiceCache.values()) howl.unload()
    for (const howl of this.seCache.values()) howl.unload()
    for (const howl of this.bgvCache.values()) howl.unload()
    this.voiceCache.clear()
    this.seCache.clear()
    this.bgvCache.clear()
  }
}
