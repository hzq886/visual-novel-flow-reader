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

export type WrapOptions = {
  perRow?: number // 1 行に並べるノード数（既定 5）
  gapX?: number // セル間 水平間隔
  gapY?: number // セル間 垂直間隔（折り返し接続線・分岐線が通る余白）
  cellW: number // 均一セル幅（最大ノード幅＝SCENE_SIZE.width 想定）
  cellH: number // 均一セル高
}

/**
 * SceneGraph → row-major 折り返しグリッド配置（HU-54）。`graph.nodes` の順（＝flow.json 宣言順
 * ＝ストーリー順）で左→右に `perRow` 個ずつ並べ、行末で次行先頭へ折り返す（全行 左→右）。
 * 各ノードは均一セル内で中央寄せ（hub/end など小さいノードも整列して見える）。
 * 分岐（DAG）はこの線形順の着地先へエッジが張られる（配置は線形・エッジが分岐を表す）。
 */
export function layoutWrapped(
  graph: SceneGraph,
  size: (node: SceneGraphNode) => NodeSize,
  opts: WrapOptions,
): Positions {
  const perRow = Math.max(1, opts.perRow ?? 5)
  const gapX = opts.gapX ?? 48
  const gapY = opts.gapY ?? 68
  const { cellW, cellH } = opts
  const positions: Positions = new Map()
  graph.nodes.forEach((n, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const s = size(n)
    positions.set(n.id, {
      x: col * (cellW + gapX) + (cellW - s.width) / 2,
      y: row * (cellH + gapY) + (cellH - s.height) / 2,
    })
  })
  return positions
}

/** 折り返しグリッド全体の幅（初期ビューの水平中央寄せ用）。 */
export function wrappedGridWidth(nodeCount: number, cellW: number, gapX = 48, perRow = 5): number {
  const cols = Math.min(Math.max(1, perRow), Math.max(1, nodeCount))
  return cols * cellW + (cols - 1) * gapX
}

// ───────────────────────────────────────────────────────────────────────────
// ハイブリッド配置（HU-54）: 線形ラン＝折り返しグリッド、分岐骨格＝dagre 扇状。
// ───────────────────────────────────────────────────────────────────────────

/** 線形ラン（基本ブロック）: 分岐/合流で区切られた一本道の連続ノード列。 */
export type Run = { id: string; nodeIds: string[] }
export type RunSegmentation = { runs: Run[]; runOf: Map<string, string> }

/**
 * SceneGraph を基本ブロック（線形ラン）へ分割する。leader（ラン先頭）= indeg≠1、または唯一の
 * 先行ノードが分岐（outdeg>1）するノード。leader から outdeg==1 かつ後続 indeg==1 が続く限り連結。
 * ＝分岐点/合流点で切れる「一本道」の最大列。純関数（Vitest 対象）。
 */
export function computeRuns(graph: SceneGraph): RunSegmentation {
  const outdeg = new Map<string, number>()
  const indeg = new Map<string, number>()
  const succ = new Map<string, string[]>()
  const pred = new Map<string, string[]>()
  for (const n of graph.nodes) {
    outdeg.set(n.id, 0)
    indeg.set(n.id, 0)
    succ.set(n.id, [])
    pred.set(n.id, [])
  }
  for (const e of graph.edges) {
    if (!outdeg.has(e.source) || !indeg.has(e.target)) continue
    outdeg.set(e.source, outdeg.get(e.source)! + 1)
    indeg.set(e.target, indeg.get(e.target)! + 1)
    succ.get(e.source)!.push(e.target)
    pred.get(e.target)!.push(e.source)
  }
  const isLeader = (id: string): boolean => {
    if (indeg.get(id) !== 1) return true // indeg 0（開始）or >1（合流）は必ず先頭
    return (outdeg.get(pred.get(id)![0]) ?? 0) > 1 // 唯一の先行が分岐するなら先頭
  }
  const runOf = new Map<string, string>()
  const runs: Run[] = []
  const startRun = (leader: string) => {
    const nodeIds: string[] = []
    let cur: string | undefined = leader
    while (cur && !runOf.has(cur)) {
      nodeIds.push(cur)
      runOf.set(cur, `run-${leader}`)
      if (outdeg.get(cur) === 1) {
        const s: string = succ.get(cur)![0]
        if (indeg.get(s) === 1 && !runOf.has(s)) {
          cur = s
          continue
        }
      }
      break
    }
    runs.push({ id: `run-${leader}`, nodeIds })
  }
  for (const n of graph.nodes) if (!runOf.has(n.id) && isLeader(n.id)) startRun(n.id)
  // 取りこぼし（leader に辿れないサイクル等）は単独ランに（安全網）。
  for (const n of graph.nodes) if (!runOf.has(n.id)) startRun(n.id)
  return { runs, runOf }
}

export type HybridOptions = {
  perRow?: number // ラン内 折り返し 1 行あたり（既定 5）
  gapX?: number
  gapY?: number
  cellW: number
  cellH: number
  ranksep?: number // 骨格 dagre のランク間（縦）間隔
  nodesep?: number // 骨格 dagre の同ランク内（横）間隔＝分岐の兄弟ラン間
}

/**
 * ハイブリッド配置（HU-54）: 線形ランを塊に縮約し骨格を dagre(TB) で扇状レイアウト → 各ランを
 * その塊の中で row-major 折り返しグリッド（perRow 個/行）に展開する。分岐は dagre の綺麗な扇状、
 * 一本道は折り返しでコンパクト。返り値の runOf はエッジのハンドル選択（ラン内=横／ラン間=縦）に使う。
 */
export function layoutHybrid(
  graph: SceneGraph,
  size: (node: SceneGraphNode) => NodeSize,
  opts: HybridOptions,
): { positions: Positions; runOf: Map<string, string> } {
  const perRow = Math.max(1, opts.perRow ?? 5)
  const gapX = opts.gapX ?? 48
  const gapY = opts.gapY ?? 68
  const { cellW, cellH } = opts
  const { runs, runOf } = computeRuns(graph)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  const g = new Dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'TB',
    ranksep: opts.ranksep ?? 130,
    nodesep: opts.nodesep ?? 80,
    marginx: 24,
    marginy: 24,
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const run of runs) {
    const len = run.nodeIds.length
    const cols = Math.min(len, perRow)
    const rows = Math.ceil(len / perRow)
    g.setNode(run.id, {
      width: cols * cellW + (cols - 1) * gapX,
      height: rows * cellH + (rows - 1) * gapY,
    })
  }
  const seen = new Set<string>()
  for (const e of graph.edges) {
    const ru = runOf.get(e.source)
    const rv = runOf.get(e.target)
    if (!ru || !rv || ru === rv) continue
    const key = `${ru}>${rv}`
    if (seen.has(key)) continue
    seen.add(key)
    g.setEdge(ru, rv)
  }
  Dagre.layout(g)

  const positions: Positions = new Map()
  for (const run of runs) {
    const box = g.node(run.id)
    if (!box) continue
    const left = box.x - box.width / 2
    const top = box.y - box.height / 2
    run.nodeIds.forEach((id, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const s = size(byId.get(id)!)
      positions.set(id, {
        x: left + col * (cellW + gapX) + (cellW - s.width) / 2,
        y: top + row * (cellH + gapY) + (cellH - s.height) / 2,
      })
    })
  }
  return { positions, runOf }
}
