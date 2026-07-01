/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。
 * data/flow.json（arc 単位 CFG）を scenegraph で **1シーン=1ノード** に展開し、dagre で自動レイアウト、
 * カテゴリ別配色（category.ts の9分類）の SceneNode／ラベル付きエッジ＋凡例（Legend）を表示する。
 * 再生中シーン（usePlayer.scene）のノードを金枠でハイライトしてストーリー進行と連動させる。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import flowJson from '@data/flow.json'
import sceneIndexJson from '@data/scene-index.json'
import { Flow, SceneIndex } from '@/pipeline/types'
import { usePlayer } from '@/store/player'
import { CATEGORY_COLOR, type Category } from './category'
import { Legend } from './Legend'
import { SceneNode, type SceneNodeData } from './SceneNode'
import { GroupNode, type GroupNodeData } from './GroupNode'
import { SCENE_SIZE, HUB_SIZE } from './nodeSize'
import {
  buildSceneGraph,
  groupScenes,
  type SceneGraph,
  type SceneGraphEdge,
  type SceneGraphNode,
} from './scenegraph'
import { layoutGraph, type GroupBox } from './layout'

const flow = Flow.parse(flowJson)
const sceneIndex = SceneIndex.parse(sceneIndexJson)

// 構造（ノード集合・エッジ・グループ）は locale 不変なので、レイアウトは一度だけ計算して使い回す。
// 見出し文字列のみ locale 依存（描画時に現 locale の題へ差し替える）。
const baseGraph = buildSceneGraph(flow, sceneIndex, 'jp')
const groups = groupScenes(baseGraph)
const { positions, groupBoxes } = layoutGraph(
  baseGraph,
  (n: SceneGraphNode) => (n.kind === 'scene' ? SCENE_SIZE : HUB_SIZE),
  {},
  groups,
)
// TB レイアウトの初期表示基点（HU-53）: 最上段ノードの中心。ここを画面上部に据え、
// zoom=1（等倍・可読）で表示 → ユーザは下方向へスクロール（パン）して残りを辿る。
// 全体 fitView はしない（縮小して全ノードを一望にしない）。
const startCenterX = (() => {
  let topY = Infinity
  let cx = 0
  for (const n of baseGraph.nodes) {
    const p = positions.get(n.id)
    if (!p) continue
    const s = n.kind === 'scene' ? SCENE_SIZE : HUB_SIZE
    if (p.y < topY) {
      topY = p.y
      cx = p.x + s.width / 2
    }
  }
  return { cx, topY: topY === Infinity ? 0 : topY }
})()

// メンバー id → 属する群（コンテナ見出し差し替え・grouped フラグ用）。
const groupByMember = new Map<string, (typeof groups)[number]>()
for (const g of groups) for (const m of g.memberIds) groupByMember.set(m, g)
// 群 head の category（コンテナの配色）。
const headCategory = new Map(
  groups.map((g) => [g.id, baseGraph.nodes.find((n) => n.id === g.headId)?.category ?? 'common']),
)

// nodeTypes はモジュールレベルで安定参照にする（毎レンダー再生成すると React Flow が警告）。
const nodeTypes = { flowNode: SceneNode, groupBox: GroupNode }

// コンテナノードは最背面（配列先頭・低 zIndex）に置き、内側のシーンノードがクリックを受ける。
function rfGroupNodes(graph: SceneGraph): Node<GroupNodeData>[] {
  const titleById = new Map(graph.nodes.map((n) => [n.id, n.title]))
  return groupBoxes.map((b: GroupBox) => {
    const g = groups.find((gg) => gg.id === b.id)!
    return {
      id: b.id,
      type: 'groupBox',
      position: { x: b.x, y: b.y },
      width: b.width,
      height: b.height,
      draggable: false,
      selectable: false,
      zIndex: 0,
      data: {
        // 見出しは現 locale の head 題（cn 未抽出時は jp フォールバック済の graph.title）。
        title: titleById.get(g.headId) ?? g.title,
        category: headCategory.get(g.id) as Category,
      },
    }
  })
}

function rfNodes(graph: SceneGraph, liveCode: string | null): Node<SceneNodeData>[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    draggable: false,
    zIndex: 1,
    data: {
      kind: n.kind,
      category: n.category,
      title: n.title,
      live: n.id === liveCode,
      grouped: groupByMember.has(n.id),
    },
  }))
}

// エッジ意匠（Image #4）: 分岐辺＝着地先カテゴリ色で太く・ラベル強調、構造リンク＝中間グレー、
// arc 内連鎖＝淡いグレー。いずれも曲線（bezier）＋終点矢印で進行方向を示す。
function edgeStroke(e: SceneGraphEdge): string {
  // 分岐辺は着地先カテゴリ色（HU-45）。category 欠落時は共通色にフォールバック。
  if (e.branch) return CATEGORY_COLOR[e.category ?? 'common'] ?? CATEGORY_COLOR.common
  if (e.variant === 'structural') return '#46536b'
  return '#2b3340'
}

function rfEdges(graph: SceneGraph): Edge[] {
  return graph.edges.map((e) => {
    const stroke = edgeStroke(e)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      style: { stroke, strokeWidth: e.branch ? 2.4 : e.variant === 'structural' ? 2 : 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 15, height: 15 },
      labelStyle: {
        fill: e.branch ? '#fdf3df' : '#cfd6e0',
        fontSize: e.branch ? 12.5 : 11,
        fontWeight: 700,
      },
      labelBgStyle: { fill: 'rgba(12,15,21,.72)', fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      zIndex: e.branch ? 10 : 1,
    }
  })
}

export function FlowMap({ onJump }: { onJump?: () => void } = {}) {
  const sceneCode = usePlayer((s) => s.scene?.code ?? null)
  const locale = usePlayer((s) => s.locale)

  // 見出しは locale 依存（ノード/エッジ構造は不変）。
  const graph = useMemo(() => buildSceneGraph(flow, sceneIndex, locale), [locale])

  // FlowMap コンテナの実寸参照。水平中央寄せは window ではなくこの幅基準で計算する
  // （HU-52 でアプリが 16:9 枠に収まると FlowMap 幅 < window 幅になるため）。
  const containerRef = useRef<HTMLDivElement>(null)

  // コンテナ（groupBox）を配列先頭＝最背面に、シーン/hub ノードを前面に重ねる。
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([
    ...rfGroupNodes(graph),
    ...rfNodes(graph, sceneCode),
  ])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges(graph))

  // 再生中シーンの変化／言語切替で、ノード（ハイライト・見出し）とエッジ（ラベル）を更新。
  useEffect(() => {
    setNodes([...rfGroupNodes(graph), ...rfNodes(graph, sceneCode)])
    setEdges(rfEdges(graph))
  }, [graph, sceneCode, setNodes, setEdges])

  // 初期ビュー: 最上段ノードをコンテナ上部・水平中央へ等倍で据える（HU-53）。以降はユーザが
  // 下へパン/スクロールして辿る。座標は明示ズーム基準（*INIT_ZOOM）で計算するのでどのタイミングで
  // 適用しても中央がずれない。水平中央は FlowMap コンテナ実幅基準（HU-52 の 16:9 枠内でも正しい）。
  const applyInitialView = useCallback((rf: ReactFlowInstance<Node, Edge>) => {
    const INIT_ZOOM = 1 // 等倍・可読サイズ。
    const topPad = 96 // 上端の見出し（Legend）下に最上段ノードを収める余白。
    const width = containerRef.current?.clientWidth ?? window.innerWidth
    rf.setViewport({
      x: width / 2 - startCenterX.cx * INIT_ZOOM,
      y: topPad - startCenterX.topY * INIT_ZOOM,
      zoom: INIT_ZOOM,
    })
  }, [])

  // onInit 直後の setViewport は React Flow の初期フィットに上書きされ得るため、描画確定後
  // （rAF 2 フレーム）に再適用して確実に定着させる。
  const onInit = useCallback(
    (rf: ReactFlowInstance<Node, Edge>) => {
      applyInitialView(rf)
      requestAnimationFrame(() => requestAnimationFrame(() => applyInitialView(rf)))
    },
    [applyInitialView],
  )

  // シーンノードのクリックで物語をそのシーン先頭へスキップし、物語ビューへ戻す（HU-46）。
  // hub(分岐)/end/omake・コンテナは再生対象シーンが無いので無視する。
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if ((node.data as SceneNodeData).kind !== 'scene') return
      void usePlayer.getState().gotoScene(node.id)
      onJump?.()
    },
    [onJump],
  )

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 5,
          maxWidth: 'calc(100% - 28px)',
        }}
      >
        <Legend />
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onInit={onInit}
        nodesDraggable={false}
        minZoom={0.2}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#13161c' }}
      >
        <Background color="#222834" gap={26} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === 'groupBox'
              ? 'rgba(255,255,255,.04)'
              : (CATEGORY_COLOR[(n.data as SceneNodeData).category as Category] ??
                CATEGORY_COLOR.common)
          }
          maskColor="rgba(19,22,28,.7)"
        />
        <Controls />
      </ReactFlow>
    </div>
  )
}
