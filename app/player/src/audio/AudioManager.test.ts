import { describe, it, expect, vi, beforeEach } from 'vitest'

// Howler は実ブラウザ音声に依存するためモック。Howl の生成/再生/停止/解放を spy で観測する。
const { ctorSpy, playSpy, stopSpy, unloadSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
  playSpy: vi.fn(),
  stopSpy: vi.fn(),
  unloadSpy: vi.fn(),
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
})
