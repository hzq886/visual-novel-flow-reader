import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import { Flow } from '@/pipeline/types'
import { findNodeIdByScene, toReactFlow } from './flow'

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

  it('選択肢を持つノードの scene にその選択肢シーンが含まれる', () => {
    for (const n of flow.nodes) for (const c of n.choices ?? []) expect(n.scenes).toContain(c.scene)
  })
})

describe('toReactFlow — React Flow 形状への写像', () => {
  const rf = toReactFlow(flow)

  it('ノード数が一致し position/label を持つ', () => {
    expect(rf.nodes.length).toBe(flow.nodes.length)
    const start = rf.nodes.find((n) => n.id === 'start')
    expect(start).toBeDefined()
    expect(start?.position).toBeDefined()
    expect(start?.data.label).toContain('スタート')
  })

  it('エッジ id は一意', () => {
    const ids = rf.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('SMAIN の hub 合流が分岐ノードへ向かうエッジとして存在', () => {
    const toHub = rf.edges.filter((e) => e.target.startsWith('SMAIN_'))
    expect(toHub.length).toBeGreaterThan(0)
  })
})
