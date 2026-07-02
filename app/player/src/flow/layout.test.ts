import { describe, expect, it } from 'vitest'
import type { SceneGraph, SceneGraphNode } from './scenegraph'
import { layoutGraph, layoutOmakeBox, OMAKE_BOX_ID } from './layout'

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

describe('layoutOmakeBox — おまけ枠の分離配置（HU-57）', () => {
  const omake = [scene('o1'), scene('o2'), scene('o3')]

  it('枠は本編 bbox の右側・最上段揃いに置かれる', () => {
    const g = chain(['a', 'b', 'c'])
    const { positions } = layoutGraph(g, size)
    const { box } = layoutOmakeBox(g, positions, size, omake)
    let right = 0
    let top = Infinity
    for (const id of ['a', 'b', 'c']) {
      const p = positions.get(id)!
      right = Math.max(right, p.x + 248)
      top = Math.min(top, p.y)
    }
    expect(box.id).toBe(OMAKE_BOX_ID)
    expect(box.x).toBeGreaterThan(right)
    expect(box.y).toBe(top)
  })

  it('全おまけノードが枠内に収まり、縦積み（y 単調増加・x 揃い）になる', () => {
    const g = chain(['a', 'b'])
    const { positions } = layoutGraph(g, size)
    const { positions: op, box } = layoutOmakeBox(g, positions, size, omake)
    let prevY = -Infinity
    const x0 = op.get('o1')!.x
    for (const n of omake) {
      const p = op.get(n.id)!
      expect(p.x).toBe(x0)
      expect(p.y).toBeGreaterThan(prevY)
      prevY = p.y
      expect(p.x).toBeGreaterThanOrEqual(box.x)
      expect(p.y).toBeGreaterThanOrEqual(box.y)
      expect(p.x + 248).toBeLessThanOrEqual(box.x + box.width)
      expect(p.y + 58).toBeLessThanOrEqual(box.y + box.height)
    }
  })
})
