import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import { Flow } from '@/pipeline/types'
import { findNodeIdByScene, toReactFlow } from './flow'

const flow = Flow.parse(flowJson)

describe('flow.json — 暫定ルートグラフ（build-flow 生成物）', () => {
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

  it('scenes に擬似エントリ（→… / _…）が混入しない', () => {
    for (const n of flow.nodes)
      for (const s of n.scenes) expect(s.startsWith('→') || s.startsWith('_')).toBe(false)
  })
})

describe('findNodeIdByScene — 連動ハイライトの所有者特定', () => {
  it('002_AYAN001A は ayan1 ノードに属する（受入）', () => {
    expect(findNodeIdByScene(flow, '002_AYAN001A')).toBe('ayan1')
  })

  it('未知コードは null', () => {
    expect(findNodeIdByScene(flow, 'ZZZ_NONE001A')).toBeNull()
  })
})

describe('toReactFlow — React Flow 形状への写像', () => {
  const rf = toReactFlow(flow)

  it('ノード数が一致し position/label を持つ', () => {
    expect(rf.nodes.length).toBe(flow.nodes.length)
    const start = rf.nodes.find((n) => n.id === 'start')
    expect(start?.position).toEqual({ x: 40, y: 858 })
    expect(start?.data.label).toContain('スタート')
  })

  it('エッジ id は一意', () => {
    const ids = rf.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ラベル付きエッジが label を持つ（hub → sister_life）', () => {
    const e = rf.edges.find((x) => x.source === 'hub' && x.target === 'sister_life')
    expect(e?.label).toBe('両方撤退 → 姉妹')
  })
})
