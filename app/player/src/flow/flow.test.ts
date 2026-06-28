import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import { Flow } from '@/pipeline/types'
import { findNodeIdByScene } from './flow'

const flow = Flow.parse(flowJson)

describe('flow.json — SMAIN 機械抽出のルートグラフ（extract-flow.py 生成物）', () => {
  it('Flow スキーマに適合し、ノード/エッジが存在', () => {
    expect(flow.nodes.length).toBeGreaterThan(0)
    expect(flow.edges.length).toBeGreaterThan(0)
  })

  it('全エッジの端点が実在ノードを指す', () => {
    const ids = new Set(flow.nodes.map((n) => n.id))
    for (const e of flow.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  it('ノード id は一意', () => {
    const ids = flow.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('scenes に擬似エントリ（→… / _… / hub名）が混入しない（実シーンコードのみ）', () => {
    for (const n of flow.nodes) for (const s of n.scenes) expect(/^\d{3}_[A-Z]/.test(s)).toBe(true)
  })

  it('開始/分岐/終端ノードが揃う（start 1・branch 複数・end 複数）', () => {
    const byKind = (k: string) => flow.nodes.filter((n) => n.kind === k)
    expect(byKind('start')).toHaveLength(1)
    expect(byKind('branch').length).toBeGreaterThan(0)
    expect(byKind('end').length).toBeGreaterThan(0)
    // 終端 hub は SMAIN の NORMAL_END / TRUE_END に対応
    const endIds = new Set(byKind('end').map((n) => n.id))
    expect(endIds.has('NORMAL_END')).toBe(true)
    expect(endIds.has('TRUE_END')).toBe(true)
  })
})

describe('findNodeIdByScene — 連動ハイライトの所有者特定', () => {
  it('002_AYAN001A は実在ノードに属し、その scenes に含まれる（受入）', () => {
    const id = findNodeIdByScene(flow, '002_AYAN001A')
    expect(id).not.toBeNull()
    const owner = flow.nodes.find((n) => n.id === id)
    expect(owner?.scenes).toContain('002_AYAN001A')
  })

  it('未知コードは null', () => {
    expect(findNodeIdByScene(flow, 'ZZZ_NONE001A')).toBeNull()
  })
})

describe('選択肢メニュー i18n（HU-18）', () => {
  const menus = flow.nodes.flatMap((n) => n.choices ?? [])

  it('選択肢メニューが flow に載り、各 2 択以上で jp/cn を持つ', () => {
    expect(menus.length).toBeGreaterThan(0)
    for (const m of menus) {
      expect(m.options.length).toBeGreaterThanOrEqual(2)
      for (const o of m.options) {
        expect(o.jp.length).toBeGreaterThan(0)
        expect(typeof o.cn === 'string' || o.cn === null).toBe(true)
      }
    }
  })

  it('002_AYAN010A の選択肢（キーワードを言う / 一生懸命に頼み込む）が jp/cn で載る（受入）', () => {
    const menu = menus.find((m) => m.scene === '002_AYAN010A')
    expect(menu).toBeDefined()
    expect(menu?.options.map((o) => o.jp)).toEqual(['キーワードを言う', '一生懸命に頼み込む'])
    expect(menu?.options.map((o) => o.cn)).toEqual(['说出关键词', '拼命地请求'])
  })

  it('_VIEW 方式メニュー 006_TUBA001B（後悔/背徳）が jp/cn で載る（HU-19 受入）', () => {
    const menu = menus.find((m) => m.scene === '006_TUBA001B')
    expect(menu).toBeDefined()
    expect(menu?.options.map((o) => o.jp)).toEqual([
      '後悔して、すぐに止める',
      '背徳に溺れて、このまま続ける',
    ])
    expect(menu?.options.map((o) => o.cn)).toEqual(['立刻后悔，停止下来', '沉溺于背德，继续下去'])
  })

  it('選択肢を持つノードの scene にその選択肢シーンが含まれる', () => {
    for (const n of flow.nodes) for (const c of n.choices ?? []) expect(n.scenes).toContain(c.scene)
  })
})

describe('選択肢オプション→分岐先ノードの紐付け（HU-21・SMAIN len-8 switch）', () => {
  const ids = new Set(flow.nodes.map((n) => n.id))
  const opts = flow.nodes.flatMap((n) => (n.choices ?? []).flatMap((c) => c.options))

  it('ルート分岐の選択肢に flag/target/targetTitle が付き、target は実在ノード', () => {
    const branchOpts = opts.filter((o) => o.target)
    // 10 = 5 つの len-8 switch × 2 択（HU-21）＋ 7 = len-7 等値テストの hub-goto 恒久分岐（HU-23・S12/S77）。
    expect(branchOpts.length).toBe(17)
    for (const o of branchOpts) {
      expect(o.flag).toMatch(/^S\d+(\/.+)?=\d+$/) // 例 "S71/軸2_1=2"・"S12=0"（_DEF 名の無いスロット）
      expect(o.targetTitle).toBeTruthy()
      expect(ids.has(o.target!)).toBe(true)
    }
  })

  it('S71（軸2）分岐: 005_MAKO001A の各選択肢が正しい分岐先へ（受入）', () => {
    const menu = flow.nodes.flatMap((n) => n.choices ?? []).find((c) => c.scene === '005_MAKO001A')
    expect(menu).toBeDefined()
    const by = Object.fromEntries(menu!.options.map((o) => [o.jp, o]))
    expect(by['人のことは言えない']).toMatchObject({ flag: 'S71/軸2_1=1', target: 'SMAIN_MIX03' })
    expect(by['血が出そうなほど、唇を強く噛む。']).toMatchObject({
      flag: 'S71/軸2_1=2',
      target: '005_MAKO001B',
    })
  })

  it('TUBA 内分岐 S62: それが絶頂…→006_TUBA001E / まだ我慢→006_TUBA002A（合流畳み込みを分離）', () => {
    const menu = flow.nodes.flatMap((n) => n.choices ?? []).find((c) => c.scene === '006_TUBA001C')
    const by = Object.fromEntries((menu?.options ?? []).map((o) => [o.jp, o.target]))
    expect(by['それが絶頂の反応だと分かったとき……。']).toBe('006_TUBA001E')
    expect(by['まだ我慢をする']).toBe('006_TUBA002A')
  })

  it('分岐先ごとに選択肢ラベル＋条件フラグ付きエッジが張られる', () => {
    const labeled = flow.edges.filter((e) => e.label && e.condition)
    expect(labeled.length).toBe(10)
    // 例: 002_AYAN002A(…005_MAKO001A の選択) --[血が…]--> 005_MAKO001B（S71=2）。
    // HU-22 で MIX01 ブロック(006_TUBA001D)と MIX02 ブロック(002_AYAN002A…)が正しく分離した結果、
    // 選択肢シーン 005_MAKO001A を含むノードの id は 002_AYAN002A。
    const e = labeled.find((x) => x.source === '002_AYAN002A' && x.target === '005_MAKO001B')
    expect(e?.condition?.flags).toEqual(['S71/軸2_1=2'])
    expect(e?.label).toBe('血が出そうなほど、唇を強く噛む。')
  })
})

describe('len-7 等値テストの任意挿入シーン紐付け（HU-23）', () => {
  const ids = new Set(flow.nodes.map((n) => n.id))
  const opts = flow.nodes.flatMap((n) => (n.choices ?? []).flatMap((c) => c.options))

  it('挿入選択肢に flag/inserts/insertsTitle が付き、inserts は実在ノード（恒久分岐 target とは排他）', () => {
    const insOpts = opts.filter((o) => o.inserts)
    expect(insOpts.length).toBe(11)
    for (const o of insOpts) {
      expect(o.flag).toMatch(/^S\d+(\/.+)?=\d+$/)
      expect(o.insertsTitle).toBeTruthy()
      expect(ids.has(o.inserts!)).toBe(true)
      expect(o.target).toBeUndefined() // 任意挿入は合流する＝恒久分岐 target と区別する
    }
  })

  it('SUBTM（真琴）の if-test 選択肢が挿入ブロックを表現する（受入）', () => {
    const by = (scene: string) => {
      const menu = flow.nodes.flatMap((n) => n.choices ?? []).find((c) => c.scene === scene)
      return Object.fromEntries((menu?.options ?? []).map((o) => [o.jp, o]))
    }
    // 012_SUBTM001A: 「真琴にも手を出そう」(S75=1) は真琴/真琴ルートの挿入ブロック（005_MAKO003…）へ。
    const subtm = by('012_SUBTM001A')
    expect(subtm['真琴にも、手を出そう']).toMatchObject({
      flag: 'S75/軸3_3=1',
      inserts: '005_MAKO003A',
    })
    expect(subtm['真琴には、手を出さない'].flag).toBe('S75/軸3_3=2')
    // 005_MAKO005E: 「無視する」(S74=1) が MAKO006 系の挿入ブロックへ。
    const mako = by('005_MAKO005E')
    expect(mako['無視する']).toMatchObject({ flag: 'S74/軸3_2=1', inserts: '005_MAKO006A' })
  })
})
