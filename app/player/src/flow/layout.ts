/**
 * flow/layout — dagre による階層レイアウト。シーン単位グラフ（~290ノード）の座標を計算する。
 * React Flow の position は左上原点なので、dagre の中心座標から幅/高さの半分を引く。
 */
import Dagre from '@dagrejs/dagre'
import type { SceneGraph, SceneGraphNode, SceneGroup } from './scenegraph'

export type NodeSize = { width: number; height: number }
export type Positions = Map<string, { x: number; y: number }>
/** グループコンテナの矩形（React Flow の左上原点）。title はコンテナ見出し。 */
export type GroupBox = { id: string; x: number; y: number; width: number; height: number }
export type LayoutResult = { positions: Positions; groupBoxes: GroupBox[] }

export type LayoutOptions = {
  rankdir?: 'LR' | 'TB' // ストーリー進行方向（既定 TB＝上→下：縦スクロール閲覧・HU-53）
  nodesep?: number
  ranksep?: number
}

// コンテナ上端に見出しラベルを置くための追加余白（dagre のクラスタ既定パディングに上乗せ）。
export const GROUP_LABEL_PAD = 22

/**
 * SceneGraph → ノード id ごとの左上座標＋グループコンテナ矩形。groups を渡すと dagre の
 * compound（クラスタ）でメンバーを近接配置し、クラスタの bbox をコンテナ矩形として返す。
 * size はノード種別ごとの寸法を返す。
 */
export function layoutGraph(
  graph: SceneGraph,
  size: (node: SceneGraphNode) => NodeSize,
  opts: LayoutOptions = {},
  groups: SceneGroup[] = [],
): LayoutResult {
  const g = new Dagre.graphlib.Graph({ compound: groups.length > 0 })
  // 既定は TB（上→下）。縦積みでノードを固定サイズ・可読間隔で並べ、縦スクロールで辿る（HU-53）。
  // nodesep=同ランク内の水平間隔、ranksep=ランク間（縦方向）の間隔。
  g.setGraph({
    rankdir: opts.rankdir ?? 'TB',
    nodesep: opts.nodesep ?? 44,
    ranksep: opts.ranksep ?? 78,
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
  // クラスタノードを宣言し、メンバーを親付けする（compound layout で近接クラスタリング）。
  for (const grp of groups) {
    g.setNode(grp.id, {})
    for (const m of grp.memberIds) if (sizeById.has(m)) g.setParent(m, grp.id)
  }
  for (const e of graph.edges) g.setEdge(e.source, e.target)

  Dagre.layout(g)

  const positions: Positions = new Map()
  for (const n of graph.nodes) {
    const p = g.node(n.id)
    const s = sizeById.get(n.id)!
    positions.set(n.id, { x: p.x - s.width / 2, y: p.y - s.height / 2 })
  }
  const groupBoxes: GroupBox[] = []
  for (const grp of groups) {
    const c = g.node(grp.id)
    if (!c) continue
    // dagre のクラスタ座標は中心。React Flow 用に左上へ変換し、見出し分だけ上へ広げる。
    groupBoxes.push({
      id: grp.id,
      x: c.x - c.width / 2,
      y: c.y - c.height / 2 - GROUP_LABEL_PAD,
      width: c.width,
      height: c.height + GROUP_LABEL_PAD,
    })
  }
  return { positions, groupBoxes }
}
