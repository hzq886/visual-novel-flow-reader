/**
 * store/player — 再生状態（現在シーン・beat index・ルートフラグ・選択肢）の Zustand ストア。
 * Stage（描画）と AudioManager が共有して beat 送り／シーン遷移に同期する。
 *
 * 単一シーンの beat 送り（next/prev/goto）に加え、flow.json 駆動のシーン跨ぎ遷移を持つ:
 *  - start()   : flow の開始シーンをロード（エントリ）。
 *  - advance() : beat 末尾でなければ次 beat、末尾なら flow に従い次シーン or 選択肢提示 or 終端。
 *  - choose()  : 選択肢の分岐先シーンへ遷移。
 *  - setLocale(): jp⇄cn 切替。現在シーンを別ロケールで読み直し再生位置を維持（HU-29）。
 * シーン JSON は sceneLoader が (code, locale) 指定で動的ロード（全件を先読みしない）。
 *
 * flags は flow の `FlowEdge.condition.flags` が参照するルート分岐条件の集合。プレイ進行で
 * 蓄積され、シーンを跨いでも保持される（新規プレイは resetFlags）。
 */
import { create } from 'zustand'
import { Beat, Flow, type Locale, type Scene } from '@/pipeline/types'
import { FlowNav, type NavOption } from '@/flow/nav'
import { loadScene } from '@/engine/sceneLoader'
import flowJson from '@data/flow.json'

const nav = new FlowNav(Flow.parse(flowJson))

// beat 内のページ送り段数。地の文（narration）は原データの行＝原作のメッセージ送り単位ごとに
// 1 行ずつ表示するため lines.length 段。セリフ（line）は `「」` で集約した 1 発話＝ボイス 1 本に
// 対応するので分割せず 1 段（lines は join して全文表示）。
const beatSteps = (beat: Beat): number =>
  beat.kind === 'narration' ? Math.max(1, beat.lines.length) : 1

type PlayerState = {
  scene: Scene | null
  index: number
  line: number // 現在 beat 内の行サブインデックス（narration の行送り）
  locale: Locale
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
  setLocale: (locale: Locale) => Promise<void>
  setFlag: (name: string) => void
  unsetFlag: (name: string) => void
  hasFlag: (name: string) => boolean
  resetFlags: () => void
}

export const usePlayer = create<PlayerState>((set, get) => ({
  scene: null,
  index: 0,
  line: 0,
  locale: 'jp',
  flags: new Set<string>(),
  pendingChoice: null,
  ended: false,
  load: (scene) => set({ scene, index: 0, line: 0, pendingChoice: null, ended: false }),
  next: () => {
    const { scene, index, line } = get()
    if (!scene) return
    if (line < beatSteps(scene.beats[index]) - 1) set({ line: line + 1 })
    else if (index < scene.beats.length - 1) set({ index: index + 1, line: 0 })
  },
  prev: () => {
    const { scene, index, line } = get()
    if (line > 0) set({ line: line - 1 })
    else if (scene && index > 0)
      set({ index: index - 1, line: beatSteps(scene.beats[index - 1]) - 1 })
  },
  goto: (i) => {
    const { scene } = get()
    if (scene && i >= 0 && i < scene.beats.length) set({ index: i, line: 0 })
  },
  // flow の開始シーンをロード（エントリ）。
  start: async () => {
    const first = nav.firstScene()
    if (!first) return
    set({
      scene: await loadScene(first, get().locale),
      index: 0,
      line: 0,
      pendingChoice: null,
      ended: false,
    })
  },
  // beat 内に次の行があれば行送り。行末でも beat 末尾でなければ次 beat。
  // beat も末尾なら flow に従って次シーン／選択肢／終端へ。
  advance: async () => {
    const { scene, index, line, pendingChoice, locale } = get()
    if (pendingChoice || !scene) return // 選択肢提示中は選択待ち
    if (line < beatSteps(scene.beats[index]) - 1) {
      set({ line: line + 1 })
      return
    }
    if (index < scene.beats.length - 1) {
      set({ index: index + 1, line: 0 })
      return
    }
    const step = nav.advance(scene.code)
    if (step.kind === 'scene') {
      set({
        scene: await loadScene(step.code, locale),
        index: 0,
        line: 0,
        pendingChoice: null,
        ended: false,
      })
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
    set({
      scene: await loadScene(target, get().locale),
      index: 0,
      line: 0,
      pendingChoice: null,
      ended: false,
    })
  },
  // 言語切替（jp⇄cn）。再生中なら現在シーンを別ロケールで読み直し、再生位置（index）を維持する
  // （beat 数が異なるシーンでは末尾にクランプ）。選択肢は NavOption が jp/cn 両方を保持するため
  // 描画側（ChoiceOverlay）が locale を見て出し分ける＝ここでは再解決不要。
  setLocale: async (locale) => {
    if (locale === get().locale) return
    const { scene, index, line } = get()
    if (!scene) {
      set({ locale })
      return
    }
    const swapped = await loadScene(scene.code, locale)
    // 取得中に別シーンへ進んでいたら（race）locale だけ更新して打ち切る。
    if (get().scene !== scene) {
      set({ locale })
      return
    }
    // beat 数・行数は jp/cn で異なりうるため index と line を両方クランプ（位置維持はベストエフォート）。
    const ni = Math.min(index, swapped.beats.length - 1)
    set({
      locale,
      scene: swapped,
      index: ni,
      line: Math.min(line, beatSteps(swapped.beats[ni]) - 1),
    })
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
