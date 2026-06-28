import { beforeEach, describe, expect, it } from 'vitest'
import type { Scene } from '@/pipeline/types'
import { usePlayer } from './player'
import { loadScene } from '@/engine/sceneLoader'

// 最小シーン（3 beat）。types の Beat 判別共用体に沿った地の文ビート。
const scene: Scene = {
  code: 'TEST_001',
  route: 'TEST',
  locale: 'jp',
  beats: [
    { kind: 'narration', lines: ['a'] },
    { kind: 'narration', lines: ['b'] },
    { kind: 'narration', lines: ['c'] },
  ],
}

// 複数行 narration を含むシーン（行送りの検証用）。beat0 は 3 行、beat1 は 1 行。
const multiline: Scene = {
  code: 'TEST_ML',
  route: 'TEST',
  locale: 'jp',
  beats: [
    { kind: 'narration', lines: ['n1', 'n2', 'n3'] },
    { kind: 'narration', lines: ['m1'] },
  ],
}

// ストアはシングルトン。各テスト前に初期状態へ戻す（actions は安定なので state のみ）。
beforeEach(() => {
  usePlayer.setState({
    scene: null,
    index: 0,
    line: 0,
    locale: 'jp',
    flags: new Set<string>(),
    pendingChoice: null,
    ended: false,
  })
})

describe('再生位置 — load / next / prev / goto', () => {
  it('load でシーンを設定し index を 0 にする', () => {
    usePlayer.setState({ index: 5 })
    usePlayer.getState().load(scene)
    expect(usePlayer.getState().scene).toBe(scene)
    expect(usePlayer.getState().index).toBe(0)
  })

  it('next は末尾 beat で頭打ち（length を超えない）', () => {
    usePlayer.getState().load(scene)
    const { next } = usePlayer.getState()
    next()
    expect(usePlayer.getState().index).toBe(1)
    next()
    next() // 末尾(2)で頭打ち
    expect(usePlayer.getState().index).toBe(2)
  })

  it('prev は先頭で頭打ち（0 未満にならない）', () => {
    usePlayer.getState().load(scene)
    usePlayer.getState().goto(1)
    usePlayer.getState().prev()
    expect(usePlayer.getState().index).toBe(0)
    usePlayer.getState().prev()
    expect(usePlayer.getState().index).toBe(0)
  })

  it('goto は範囲内のみ反映し、範囲外は無視', () => {
    usePlayer.getState().load(scene)
    usePlayer.getState().goto(2)
    expect(usePlayer.getState().index).toBe(2)
    usePlayer.getState().goto(3) // 範囲外（length と同値）
    expect(usePlayer.getState().index).toBe(2)
    usePlayer.getState().goto(-1) // 範囲外（負）
    expect(usePlayer.getState().index).toBe(2)
  })

  it('シーン未読込なら next/prev/goto は何もしない（例外を投げない）', () => {
    const { next, prev, goto } = usePlayer.getState()
    expect(() => {
      next()
      prev()
      goto(1)
    }).not.toThrow()
    expect(usePlayer.getState().index).toBe(0)
  })
})

describe('行送り — 複数行 narration の beat 内ページ送り', () => {
  it('load は line も 0 にする', () => {
    usePlayer.setState({ index: 5, line: 3 })
    usePlayer.getState().load(multiline)
    expect(usePlayer.getState().index).toBe(0)
    expect(usePlayer.getState().line).toBe(0)
  })

  it('next は beat 内を 1 行ずつ送り、行末で次 beat（line=0）へ', () => {
    usePlayer.getState().load(multiline)
    const { next } = usePlayer.getState()
    next() // beat0 行1
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 1 })
    next() // beat0 行2（末尾行）
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 2 })
    next() // 行末 → 次 beat へ
    expect(usePlayer.getState()).toMatchObject({ index: 1, line: 0 })
    next() // 末尾 beat（1 行）で頭打ち
    expect(usePlayer.getState()).toMatchObject({ index: 1, line: 0 })
  })

  it('advance も beat 内を行送りする（beat 末尾までは flow に触れない）', async () => {
    usePlayer.getState().load(multiline)
    await usePlayer.getState().advance()
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 1 })
    await usePlayer.getState().advance()
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 2 })
  })

  it('prev は行頭なら前 beat の末尾行へ戻る', () => {
    usePlayer.getState().load(multiline)
    usePlayer.getState().goto(1) // 次 beat 先頭（index1, line0）
    expect(usePlayer.getState()).toMatchObject({ index: 1, line: 0 })
    usePlayer.getState().prev() // 行頭 → 前 beat の末尾行（line2）
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 2 })
    usePlayer.getState().prev() // 同一 beat 内を 1 行戻す
    expect(usePlayer.getState()).toMatchObject({ index: 0, line: 1 })
  })

  it('goto は index 設定時に line を 0 へリセットする', () => {
    usePlayer.getState().load(multiline)
    usePlayer.setState({ line: 2 })
    usePlayer.getState().goto(1)
    expect(usePlayer.getState()).toMatchObject({ index: 1, line: 0 })
  })
})

describe('ルートフラグ — set / unset / has / reset', () => {
  it('setFlag で立ち、hasFlag が true を返す', () => {
    usePlayer.getState().setFlag('ayan_route')
    expect(usePlayer.getState().hasFlag('ayan_route')).toBe(true)
    expect(usePlayer.getState().hasFlag('suzu_route')).toBe(false)
  })

  it('setFlag は不変更新（Set 参照が変わり subscribe が発火しうる）', () => {
    const before = usePlayer.getState().flags
    usePlayer.getState().setFlag('f1')
    const after = usePlayer.getState().flags
    expect(after).not.toBe(before)
    expect(before.has('f1')).toBe(false) // 既存 Set は変異させない
  })

  it('既に立っているフラグの setFlag は no-op（参照を変えない）', () => {
    usePlayer.getState().setFlag('f1')
    const ref = usePlayer.getState().flags
    usePlayer.getState().setFlag('f1')
    expect(usePlayer.getState().flags).toBe(ref)
  })

  it('unsetFlag で外れる。未設定の unset は no-op', () => {
    usePlayer.getState().setFlag('f1')
    usePlayer.getState().unsetFlag('f1')
    expect(usePlayer.getState().hasFlag('f1')).toBe(false)
    const ref = usePlayer.getState().flags
    usePlayer.getState().unsetFlag('missing')
    expect(usePlayer.getState().flags).toBe(ref)
  })

  it('resetFlags で全消去。load はフラグを保持する', () => {
    usePlayer.getState().setFlag('f1')
    usePlayer.getState().setFlag('f2')
    usePlayer.getState().load(scene) // シーン読込でフラグは消えない
    expect(usePlayer.getState().hasFlag('f1')).toBe(true)
    usePlayer.getState().resetFlags()
    expect(usePlayer.getState().flags.size).toBe(0)
  })
})

// setLocale は実生成物（data/scenes/<locale>/）を動的ロードする結合テスト。
describe('言語切替 — setLocale（jp⇄cn）', () => {
  it('同一ロケールへの切替は no-op（scene 参照を変えない）', async () => {
    const jp = await loadScene('002_AYAN001A', 'jp')
    usePlayer.getState().load(jp)
    await usePlayer.getState().setLocale('jp')
    expect(usePlayer.getState().locale).toBe('jp')
    expect(usePlayer.getState().scene).toBe(jp)
  })

  it('シーン未読込なら locale だけ更新する', async () => {
    await usePlayer.getState().setLocale('cn')
    expect(usePlayer.getState().locale).toBe('cn')
    expect(usePlayer.getState().scene).toBeNull()
  })

  it('beats 整合シーンでは再生位置（index）を保ったまま cn 本文へ差し替える', async () => {
    const jp = await loadScene('002_AYAN001A', 'jp')
    usePlayer.getState().load(jp)
    usePlayer.getState().goto(3)
    await usePlayer.getState().setLocale('cn')
    const st = usePlayer.getState()
    expect(st.locale).toBe('cn')
    expect(st.scene?.locale).toBe('cn')
    expect(st.index).toBe(3) // 002_AYAN001A は jp/cn で beats 一致 → 位置維持
  })

  it('cn の方が beats が少ないシーンでは index を末尾へクランプする', async () => {
    // 002_AYAN007B は cn 訳が jp より僅かに短い（jp=149 / cn=147）。jp の末尾に居る状態で cn へ
    // 切替えると、cn に存在しない index は cn 末尾へクランプされる。件数はハードコードせず動的に検証。
    const jp = await loadScene('002_AYAN007B', 'jp')
    usePlayer.getState().load(jp)
    const jpLast = jp.beats.length - 1
    usePlayer.getState().goto(jpLast)
    await usePlayer.getState().setLocale('cn')
    const st = usePlayer.getState()
    expect(st.locale).toBe('cn')
    const cnLen = st.scene?.beats.length ?? 0
    expect(cnLen).toBeLessThan(jp.beats.length) // cn は jp より短い（クランプ前提）
    expect(st.index).toBe(cnLen - 1) // cn 末尾へクランプ
    expect(st.index).toBeLessThan(jpLast)
  })
})
