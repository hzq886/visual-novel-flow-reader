/**
 * flow/layout — dagre による階層レイアウト。シーン単位グラフ（~290ノード）の座標を計算する。
 * React Flow の position は左上原点なので、dagre の中心座標から幅/高さの半分を引く。
 */
import Dagre from '@dagrejs/dagre'
import type { SceneGraph, SceneGraphNode } from './scenegraph'

export type NodeSize = { width: number; height: number }
export type Positions = Map<string, { x: number; y: number }>

export type LayoutOptions = {
  rankdir?: 'LR' | 'TB' // ストーリー進行方向（既定 LR＝左→右）
  nodesep?: number
  ranksep?: number
}

/** SceneGraph → ノード id ごとの左上座標。size はノード種別ごとの寸法を返す。 */
export function layoutGraph(
  graph: SceneGraph,
  size: (node: SceneGraphNode) => NodeSize,
  opts: LayoutOptions = {},
): Positions {
  const g = new Dagre.graphlib.Graph()
  g.setGraph({
    rankdir: opts.rankdir ?? 'LR',
    nodesep: opts.nodesep ?? 26,
    ranksep: opts.ranksep ?? 90,
    marginx: 24,
    marginy: 24,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const sizeById = new Map<string, NodeSize>()
  for (const n of graph.nodes) {
    const s = size(n)
    sizeById.set(n.id, s)
    g.setNode(n.id, { width: s.width, height: s.height })
  }
  for (const e of graph.edges) g.setEdge(e.source, e.target)

  Dagre.layout(g)

  const pos: Positions = new Map()
  for (const n of graph.nodes) {
    const p = g.node(n.id)
    const s = sizeById.get(n.id)!
    pos.set(n.id, { x: p.x - s.width / 2, y: p.y - s.height / 2 })
  }
  return pos
}
