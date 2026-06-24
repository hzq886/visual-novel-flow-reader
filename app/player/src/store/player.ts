/**
 * store/player — 再生状態（現在シーン・beat index・ルートフラグ）の Zustand ストア。
 * Stage（描画 / HU-10）と AudioManager（HU-11）が共有して beat 送りに同期する。
 *
 * flags は flow.json の `FlowEdge.condition.flags` が参照するルート分岐条件の集合
 * （プレイ進行で立つ）。ここでは状態コンテナとして保持するだけで、分岐の解釈・消費は
 * フロー側（HU-13/15）が担う。`load` はシーン読み込み（index リセット）のみでフラグは
 * 触らない＝同一プレイスルー内でシーンを跨いで蓄積される。新規プレイは `resetFlags` で。
 */
import { create } from 'zustand'
import type { Scene } from '@/pipeline/types'

type PlayerState = {
  scene: Scene | null
  index: number
  flags: ReadonlySet<string>
  load: (scene: Scene) => void
  next: () => void
  prev: () => void
  goto: (i: number) => void
  setFlag: (name: string) => void
  unsetFlag: (name: string) => void
  hasFlag: (name: string) => boolean
  resetFlags: () => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  scene: null,
  index: 0,
  flags: new Set<string>(),
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
  // フラグは不変更新（新しい Set を割り当て）して subscribe を発火させる。
  // 既存状態と同じになる no-op では set を呼ばず、無駄な通知を避ける。
  setFlag: (name) => {
    const { flags } = get()
    if (flags.has(name)) return
    set({ flags: new Set(flags).add(name) })
  },
  unsetFlag: (name) => {
    const { flags } = get()
    if (!flags.has(name)) return
    const next = new Set(flags)
    next.delete(name)
    set({ flags: next })
  },
  hasFlag: (name) => get().flags.has(name),
  resetFlags: () => {
    if (get().flags.size === 0) return
    set({ flags: new Set<string>() })
  },
}))
