/**
 * store/player — 再生状態（現在シーン・beat index・ルートフラグ・選択肢）の Zustand ストア。
 * Stage（描画）と AudioManager が共有して beat 送り／シーン遷移に同期する。
 *
 * 単一シーンの beat 送り（next/prev/goto）に加え、flow.json 駆動のシーン跨ぎ遷移を持つ:
 *  - start()   : flow の開始シーンをロード（エントリ）。
 *  - advance() : beat 末尾でなければ次 beat、末尾なら flow に従い次シーン or 選択肢提示 or 終端。
 *  - choose()  : 選択肢の分岐先シーンへ遷移。
 * シーン JSON は sceneLoader が動的ロード（全 288 を先読みしない）。
 *
 * flags は flow の `FlowEdge.condition.flags` が参照するルート分岐条件の集合。プレイ進行で
 * 蓄積され、シーンを跨いでも保持される（新規プレイは resetFlags）。
 */
import { create } from 'zustand'
import { Flow, type Scene } from '@/pipeline/types'
import { FlowNav, type NavOption } from '@/flow/nav'
import { loadScene } from '@/engine/sceneLoader'
import flowJson from '@data/flow.json'

const nav = new FlowNav(Flow.parse(flowJson))

type PlayerState = {
  scene: Scene | null
  index: number
  flags: ReadonlySet<string>
  pendingChoice: NavOption[] | null
  ended: boolean
  load: (scene: Scene) => void
  next: () => void
  prev: () => void
  goto: (i: number) => void
  start: () => Promise<void>
  advance: () => Promise<void>
  choose: (target: string | null) => Promise<void>
  setFlag: (name: string) => void
  unsetFlag: (name: string) => void
  hasFlag: (name: string) => boolean
  resetFlags: () => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  scene: null,
  index: 0,
  flags: new Set<string>(),
  pendingChoice: null,
  ended: false,
  load: (scene) => set({ scene, index: 0, pendingChoice: null, ended: false }),
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
  // flow の開始シーンをロード（エントリ）。
  start: async () => {
    const first = nav.firstScene()
    if (!first) return
    set({ scene: await loadScene(first), index: 0, pendingChoice: null, ended: false })
  },
  // beat 末尾でなければ次 beat。末尾なら flow に従って次シーン／選択肢／終端へ。
  advance: async () => {
    const { scene, index, pendingChoice } = get()
    if (pendingChoice || !scene) return // 選択肢提示中は選択待ち
    if (index < scene.beats.length - 1) {
      set({ index: index + 1 })
      return
    }
    const step = nav.advance(scene.code)
    if (step.kind === 'scene') {
      set({ scene: await loadScene(step.code), index: 0, pendingChoice: null, ended: false })
    } else if (step.kind === 'choice') {
      set({ pendingChoice: step.options })
    } else {
      set({ ended: true })
    }
  },
  // 選択肢の分岐先へ遷移（target=null は終端）。
  choose: async (target) => {
    if (target === null) {
      set({ pendingChoice: null, ended: true })
      return
    }
    set({ scene: await loadScene(target), index: 0, pendingChoice: null, ended: false })
  },
  // フラグは不変更新（新しい Set を割り当て）して subscribe を発火させる。
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
