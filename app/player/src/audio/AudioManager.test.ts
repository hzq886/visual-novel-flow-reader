import { describe, it, expect, vi, beforeEach } from 'vitest'

// Howler は実ブラウザ音声に依存するためモック。Howl の生成/再生/停止/解放を spy で観測する。
const { ctorSpy, playSpy, stopSpy, unloadSpy, fadeSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
  playSpy: vi.fn(),
  stopSpy: vi.fn(),
  unloadSpy: vi.fn(),
  fadeSpy: vi.fn(),
}))
vi.mock('howler', () => ({
  Howl: class {
    constructor(opts: unknown) {
      ctorSpy(opts)
    }
    state() {
      return 'loaded' as const
    }
    once() {}
    play() {
      playSpy()
    }
    stop() {
      stopSpy()
    }
    unload() {
      unloadSpy()
    }
    fade(...args: unknown[]) {
      fadeSpy(...args)
    }
    volume() {
      return 0.4
    }
  },
  Howler: { ctx: null }, // resume 経路はブラウザ検証（ctx=null → 即 whenReady）
}))

import { AudioManager } from './AudioManager'

const A = '/assets/voice/ayan_002_ayan001A_001.ogg'
const B = '/assets/voice/ayan_002_ayan001A_002.ogg'

beforeEach(() => {
  ctorSpy.mockClear()
  playSpy.mockClear()
  stopSpy.mockClear()
  unloadSpy.mockClear()
  fadeSpy.mockClear()
})

describe('AudioManager', () => {
  it('playVoice で Howl を生成して再生（src に URL）', () => {
    const am = new AudioManager()
    am.playVoice(A)
    expect(ctorSpy).toHaveBeenCalledWith(expect.objectContaining({ src: [A] }))
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('別ボイスへ進むと前のボイスを停止して新規再生', () => {
    const am = new AudioManager()
    am.playVoice(A)
    am.playVoice(B)
    expect(stopSpy).toHaveBeenCalledTimes(1) // A を停止
    expect(ctorSpy).toHaveBeenCalledTimes(2) // A, B
    expect(playSpy).toHaveBeenCalledTimes(2)
  })

  it('同一ボイスは Howl をキャッシュ再利用（再生成しない）', () => {
    const am = new AudioManager()
    am.playVoice(A)
    am.playVoice(B)
    am.playVoice(A)
    expect(ctorSpy).toHaveBeenCalledTimes(2) // A, B のみ。3回目の A は再利用
    expect(playSpy).toHaveBeenCalledTimes(3)
  })

  it('destroy で全 Howl を解放', () => {
    const am = new AudioManager()
    am.playVoice(A)
    am.playVoice(B)
    am.destroy()
    expect(unloadSpy).toHaveBeenCalledTimes(2)
  })

  it('playBgv はループで再生し、別URLで切替・同一URLは no-op（HU-37）', () => {
    const am = new AudioManager()
    const V1 = '/assets/voice/BGV_ayan_h001a.ogg'
    const V2 = '/assets/voice/BGV_ayan_h002a.ogg'
    am.playBgv(V1)
    expect(ctorSpy).toHaveBeenCalledWith(expect.objectContaining({ src: [V1], loop: true }))
    expect(playSpy).toHaveBeenCalledTimes(1)
    am.playBgv(V1) // 同一 → no-op
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(playSpy).toHaveBeenCalledTimes(1)
    am.playBgv(V2) // 切替 → 前を停止して新規
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(playSpy).toHaveBeenCalledTimes(2)
  })

  it('playBgm は BGM ゲイン 0.4 へフェードインする（感覚上 0.5:1:1・HU-68）', () => {
    const am = new AudioManager()
    am.playBgm('/assets/bgm/M01.ogg')
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ src: ['/assets/bgm/M01.ogg'], loop: true, volume: 0 }),
    )
    // フェード先が 1.0 ではなく BGM_VOLUME（0.4）であること（voice/se は 1.0 のまま）。
    expect(fadeSpy).toHaveBeenCalledWith(0, 0.4, 800)
    // 同一 URL は no-op（シーン跨ぎ継続）。
    fadeSpy.mockClear()
    am.playBgm('/assets/bgm/M01.ogg')
    expect(fadeSpy).not.toHaveBeenCalled()
  })

  it('releaseVoices で背景ボイスを停止する（シーン離脱）', () => {
    const am = new AudioManager()
    am.playBgv('/assets/voice/BGV_suzu_h001a.ogg')
    am.releaseVoices()
    expect(stopSpy).toHaveBeenCalled()
    // 停止後は同一 URL でも再生され直す（bgvUrl がクリアされている）。
    playSpy.mockClear()
    am.playBgv('/assets/voice/BGV_suzu_h001a.ogg')
    expect(playSpy).toHaveBeenCalledTimes(1)
  })
})
