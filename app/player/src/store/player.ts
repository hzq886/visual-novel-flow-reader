/**
 * store/player — 再生位置（現在シーン・beat index）の Zustand ストア。
 * Stage（描画）と AudioManager（HU-11）が共有して beat 送りに同期する。
 */
import { create } from 'zustand'
import type { Scene } from '@/pipeline/types'

type PlayerState = {
  scene: Scene | null
  index: number
  load: (scene: Scene) => void
  next: () => void
  prev: () => void
  goto: (i: number) => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  scene: null,
  index: 0,
  load: (scene) => set({ scene, index: 0 }),
  next: () => {
    const { scene, index } = get()
    if (scene && index < scene.beats.length - 1) set({ index: index + 1 })
  },
  prev: () => {
    const { index } = get()
    if (index > 0) set({ index: index - 1 })
  },
  goto: (i) => {
    const { scene } = get()
    if (scene && i >= 0 && i < scene.beats.length) set({ index: i })
  },
}))
