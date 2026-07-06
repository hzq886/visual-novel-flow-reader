import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Scene } from '@/pipeline/types'
import { usePlayer } from './player'
import { loadScene } from '@/engine/sceneLoader'
import { useBookmarks } from './bookmarks'

// 最小シーン（3 beat）。types の Beat 判別共用体に沿った地の文ビート（各 1 ページ）。
const scene: Scene = {
  code: 'TEST_001',
  route: 'TEST',
  locale: 'jp',
  beats: [
    { kind: 'narration', pages: [['a']] },
    { kind: 'narration', pages: [['b']] },
    { kind: 'narration', pages: [['c']] },
  ],
}

// 複数ページ narration を含むシーン（ページ送りの検証用）。beat0 は 3 ページ、beat1 は 1 ページ（HU-78）。
const multiline: Scene = {
  code: 'TEST_ML',
  route: 'TEST',
  locale: 'jp',
  beats: [
    { kind: 'narration', pages: [['n1'], ['n2'], ['n3']] },
    { kind: 'narration', pages: [['m1']] },
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

describe('ページ送り — 複数ページ narration の beat 内送り（HU-78）', () => {
  it('load は line も 0 にする', () => {
    usePlayer.setState({ index: 5, line: 3 })
    usePlayer.getState().load(multiline)
    expect(usePlayer.getState().index).toBe(0)
    expect(usePlayer.getState().line).toBe(0)
  })

  it('next は beat 内を 1 ページずつ送り、末尾ページで次 beat（line=0）へ', () => {
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

// gotoScene は実生成物（data/scenes/<locale>/）を動的ロードする結合テスト（フロー図ノードクリック）。
describe('シーンスキップ — gotoScene（フロー図ノードクリック）', () => {
  it('指定シーンを先頭から読み込み、index/line/pendingChoice/ended をリセットする', async () => {
    usePlayer.setState({ index: 5, line: 2, pendingChoice: [], ended: true })
    await usePlayer.getState().gotoScene('002_AYAN001A')
    const st = usePlayer.getState()
    expect(st.scene?.code).toBe('002_AYAN001A')
    expect(st.index).toBe(0)
    expect(st.line).toBe(0)
    expect(st.pendingChoice).toBeNull()
    expect(st.ended).toBe(false)
  })

  it('現在 locale でロードし、ルートフラグは保持する（任意位置探索）', async () => {
    usePlayer.setState({ locale: 'cn' })
    usePlayer.getState().setFlag('S71/軸2_1=2')
    await usePlayer.getState().gotoScene('002_AYAN001A')
    const st = usePlayer.getState()
    expect(st.scene?.locale).toBe('cn')
    expect(st.hasFlag('S71/軸2_1=2')).toBe(true)
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
    // 006_TUBA001B は cn 訳が jp より僅かに短い（jp=51 / cn=50）。jp の末尾に居る状態で cn へ
    // 切替えると、cn に存在しない index は cn 末尾へクランプされる。件数はハードコードせず動的に検証。
    const jp = await loadScene('006_TUBA001B', 'jp')
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

describe('ブックマーク連携 — gotoPosition / start 自動ジャンプ（HU-60）', () => {
  beforeEach(() => useBookmarks.setState({ marks: {}, modalCode: null }))
  afterEach(() => useBookmarks.setState({ marks: {}, modalCode: null }))

  it('gotoPosition は保存位置（beat/行）へ復帰する', async () => {
    await usePlayer.getState().gotoPosition('009_NUKE001', 2, 0)
    const st = usePlayer.getState()
    expect(st.scene?.code).toBe('009_NUKE001')
    expect(st.index).toBe(2)
    expect(st.line).toBe(0)
    expect(st.ended).toBe(false)
  })

  it('gotoPosition は範囲外の index/line を現シーンへクランプする（再生成で短縮した場合の保険）', async () => {
    await usePlayer.getState().gotoPosition('009_NUKE001', 999, 999)
    const st = usePlayer.getState()
    expect(st.index).toBe(st.scene!.beats.length - 1)
    // 末尾 beat の行数の範囲内に収まる。
    expect(st.line).toBeLessThanOrEqual(
      st.scene!.beats[st.index].kind === 'narration'
        ? (st.scene!.beats[st.index] as { pages: string[][] }).pages.length - 1
        : 0,
    )
  })

  it('start はブックマーク無しなら flow の開始シーンへ', async () => {
    await usePlayer.getState().start()
    expect(usePlayer.getState().scene?.code).toBe('001_PRO001A')
  })

  it('start は最終保存（savedAt 最新）のブックマークへ自動ジャンプする', async () => {
    useBookmarks.setState({
      marks: {
        '002_AYAN001A': { code: '002_AYAN001A', index: 1, line: 0, savedAt: 100 },
        '005_MAKO003A': { code: '005_MAKO003A', index: 2, line: 0, savedAt: 200 },
      },
      modalCode: null,
    })
    await usePlayer.getState().start()
    const st = usePlayer.getState()
    expect(st.scene?.code).toBe('005_MAKO003A')
    expect(st.index).toBe(2)
  })

  it('ブックマーク先のシーンが存在しなければ開始シーンへフォールバックする', async () => {
    useBookmarks.setState({
      marks: { ZZZ_GONE001A: { code: 'ZZZ_GONE001A', index: 0, line: 0, savedAt: 1 } },
      modalCode: null,
    })
    await usePlayer.getState().start()
    expect(usePlayer.getState().scene?.code).toBe('001_PRO001A')
  })
})
