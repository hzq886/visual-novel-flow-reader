import { describe, expect, it } from 'vitest'
import type { SceneGraph, SceneGraphNode } from './scenegraph'
import { layoutGraph, layoutWrapped, wrappedGridWidth } from './layout'

const scene = (id: string): SceneGraphNode => ({
  id,
  kind: 'scene',
  category: 'common',
  title: id,
  titled: true,
})
const size = () => ({ width: 248, height: 58 })
const chain = (ids: string[]): SceneGraph => ({
  nodes: ids.map(scene),
  edges: ids.slice(1).map((t, i) => ({
    id: `c-${ids[i]}-${t}`,
    source: ids[i],
    target: t,
    variant: 'continue' as const,
    branch: false,
  })),
})

describe('layoutGraph — TB（上→下）レイアウト（HU-53）', () => {
  it('既定は TB：連鎖ノードが縦（y 増加）に積まれ、x はほぼ揃う', () => {
    const g = chain(['a', 'b', 'c'])
    const { positions } = layoutGraph(g, size)
    const a = positions.get('a')!
    const b = positions.get('b')!
    const c = positions.get('c')!
    // 進行方向は下向き：y は単調増加。
    expect(b.y).toBeGreaterThan(a.y)
    expect(c.y).toBeGreaterThan(b.y)
    // 直列連鎖は同一カラムに整列（x のばらつきは小さい）。
    expect(Math.abs(b.x - a.x)).toBeLessThan(4)
    expect(Math.abs(c.x - a.x)).toBeLessThan(4)
  })

  it('opts.rankdir=LR を明示すると横（x 増加）に並ぶ（後方互換）', () => {
    const g = chain(['a', 'b', 'c'])
    const { positions } = layoutGraph(g, size, { rankdir: 'LR' })
    const a = positions.get('a')!
    const b = positions.get('b')!
    expect(b.x).toBeGreaterThan(a.x)
    expect(Math.abs(b.y - a.y)).toBeLessThan(4)
  })

  it('compound グループの bbox がメンバーを内包する（TB でもクラスタリング維持）', () => {
    const g = chain(['H', 'a', 'b'])
    const { positions, groupBoxes } = layoutGraph(g, size, {}, [
      { id: 'grp-H', headId: 'H', title: 'H', memberIds: ['H', 'a', 'b'] },
    ])
    expect(groupBoxes).toHaveLength(1)
    const box = groupBoxes[0]
    for (const id of ['H', 'a', 'b']) {
      const p = positions.get(id)!
      expect(p.x).toBeGreaterThanOrEqual(box.x)
      expect(p.y).toBeGreaterThanOrEqual(box.y)
      expect(p.x + 248).toBeLessThanOrEqual(box.x + box.width)
      expect(p.y + 58).toBeLessThanOrEqual(box.y + box.height)
    }
  })
})

describe('layoutWrapped — 折り返しグリッド（HU-54）', () => {
  const wrapOpts = { perRow: 5, gapX: 48, gapY: 72, cellW: 248, cellH: 58 }

  it('graph.nodes 順に左→右で perRow 個ずつ並び、行末で次行へ折り返す', () => {
    const g = chain(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    const pos = layoutWrapped(g, size, wrapOpts)
    // 行内は x 増加・y 一定
    expect(pos.get('n1')!.x).toBeGreaterThan(pos.get('n0')!.x)
    expect(pos.get('n4')!.y).toBe(pos.get('n0')!.y)
    // 5個目(index5)で折り返し: n5 は次行の先頭（x は n0 と同じ・y は下）
    expect(pos.get('n5')!.x).toBe(pos.get('n0')!.x)
    expect(pos.get('n5')!.y).toBeGreaterThan(pos.get('n0')!.y)
    // 折り返し先頭 n5 は行末 n4 より左
    expect(pos.get('n5')!.x).toBeLessThan(pos.get('n4')!.x)
  })

  it('行ピッチ = cellH + gapY、列ピッチ = cellW + gapX', () => {
    const g = chain(['a', 'b', 'c', 'd', 'e', 'f'])
    const pos = layoutWrapped(g, size, wrapOpts)
    expect(pos.get('b')!.x - pos.get('a')!.x).toBe(248 + 48) // 列ピッチ
    expect(pos.get('f')!.y - pos.get('a')!.y).toBe(58 + 72) // 行ピッチ（a=行0, f=行1）
  })

  it('小さいノード（hub/end）は均一セル内で中央寄せされる', () => {
    const g: SceneGraph = { nodes: [{ ...scene('h'), kind: 'branch' }], edges: [] }
    const sizeSmall = () => ({ width: 168, height: 48 })
    const pos = layoutWrapped(g, sizeSmall, wrapOpts)
    // セル 248×58 に 168×48 を中央寄せ → x=(248-168)/2=40, y=(58-48)/2=5
    expect(pos.get('h')!).toEqual({ x: 40, y: 5 })
  })

  it('wrappedGridWidth: perRow 列ぶんの幅（列ピッチ×(cols-1)+cellW）', () => {
    expect(wrappedGridWidth(20, 248, 48, 5)).toBe(5 * 248 + 4 * 48)
    // ノード数が perRow 未満なら実ノード数ぶん
    expect(wrappedGridWidth(3, 248, 48, 5)).toBe(3 * 248 + 2 * 48)
  })
})
