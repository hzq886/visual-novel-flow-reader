/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。
 * data/flow.json（arc 単位 CFG）を scenegraph で **1シーン=1ノード** に展開し、ストーリー順に
 * ~5 個/行の**折り返しグリッド**（左→右、行末で次行へ折り返し・HU-54）で配置する。
 * カテゴリ別配色（category.ts の9分類）の SceneNode／ラベル付きエッジ＋凡例（Legend）を表示し、
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
import { SCENE_SIZE, HUB_SIZE } from './nodeSize'
import {
  buildSceneGraph,
  groupScenes,
  type SceneGraph,
  type SceneGraphEdge,
  type SceneGraphNode,
} from './scenegraph'
import { layoutWrapped, wrappedGridWidth, type NodeSize } from './layout'

const flow = Flow.parse(flowJson)
const sceneIndex = SceneIndex.parse(sceneIndexJson)

// 構造（ノード順・エッジ・グループ）は locale 不変。折り返しグリッド配置を一度だけ計算して使い回す。
// 見出し文字列のみ locale 依存（描画時に現 locale の題へ差し替える）。
const baseGraph = buildSceneGraph(flow, sceneIndex, 'jp')
const groups = groupScenes(baseGraph)

// 折り返しグリッド（HU-54）: ストーリー順に PER_ROW 個ずつ左→右、行末で次行へ折り返す（image #5）。
const PER_ROW = 5
const GAP_X = 48
const GAP_Y = 72
const CELL = SCENE_SIZE // 均一セル（最大ノード幅基準）。hub/end 等は中央寄せで整列。
const sizeOf = (n: SceneGraphNode): NodeSize => (n.kind === 'scene' ? SCENE_SIZE : HUB_SIZE)

const positions = layoutWrapped(baseGraph, sizeOf, {
  perRow: PER_ROW,
  gapX: GAP_X,
  gapY: GAP_Y,
  cellW: CELL.width,
  cellH: CELL.height,
})
// 初期ビュー: グリッド最上行を上部・水平中央へ（HU-53 の非fitView・上端スタート・rAF 定着を流用）。
const gridWidth = wrappedGridWidth(baseGraph.nodes.length, CELL.width, GAP_X, PER_ROW)

// 題なし継続シーン（HU-51 グループの head 以外メンバー）は、折り返しグリッドではコンテナ枠を持てない
// ため、head のエピソード題を自セルの見出しに継承表示する（短縮コードの羅列を避ける）。member id → head id。
const headOfMember = new Map<string, string>()
for (const g of groups)
  for (const m of g.memberIds) if (m !== g.headId) headOfMember.set(m, g.headId)

// nodeTypes はモジュールレベルで安定参照にする（毎レンダー再生成すると React Flow が警告）。
const nodeTypes = { flowNode: SceneNode }

function rfNodes(graph: SceneGraph, liveCode: string | null): Node<SceneNodeData>[] {
  const titleById = new Map(graph.nodes.map((n) => [n.id, n.title]))
  return graph.nodes.map((n) => {
    const headId = headOfMember.get(n.id)
    // グループメンバーは head のエピソード題（locale 適用済）を見出しに継承。
    const title = headId ? (titleById.get(headId) ?? n.title) : n.title
    return {
      id: n.id,
      type: 'flowNode',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      draggable: false,
      data: {
        kind: n.kind,
        category: n.category,
        title,
        live: n.id === liveCode,
        grouped: !!headId,
      },
    }
  })
}

// エッジ意匠（Image #4）: 分岐辺＝着地先カテゴリ色で太く・ラベル強調、構造リンク＝中間グレー、
// arc 内連鎖＝淡いグレー。いずれも曲線（bezier）＋終点矢印で進行方向を示す。
function edgeStroke(e: SceneGraphEdge): string {
  if (e.branch) return CATEGORY_COLOR[e.category ?? 'branch'] ?? CATEGORY_COLOR.branch
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
      // 折り返しグリッド（HU-54）: 行内は短い水平線、折り返し接続線・分岐線は行跨ぎになるため
      // 直交ルーティング（smoothstep）で整える（image #5 の折り返し接続線の見た目）。
      type: 'smoothstep',
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(rfNodes(graph, sceneCode))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges(graph))

  // 再生中シーンの変化／言語切替で、ノード（ハイライト・見出し）とエッジ（ラベル）を更新。
  useEffect(() => {
    setNodes(rfNodes(graph, sceneCode))
    setEdges(rfEdges(graph))
  }, [graph, sceneCode, setNodes, setEdges])

  // 初期ビュー: グリッド最上行をコンテナ上部・水平中央へ等倍で据える（HU-54）。以降はユーザが
  // 下へパン/スクロールして辿る。グリッドは x=0 起点なので、幅 gridWidth をコンテナ実幅の中央へ寄せる
  // （HU-52 の 16:9 枠内でも正しい）。座標は明示ズーム基準（*INIT_ZOOM）で計算。
  const applyInitialView = useCallback((rf: ReactFlowInstance<Node, Edge>) => {
    const INIT_ZOOM = 1 // 等倍・可読サイズ。
    const topPad = 96 // 上端の見出し（Legend）下に最上行を収める余白。
    const width = containerRef.current?.clientWidth ?? window.innerWidth
    rf.setViewport({
      x: (width - gridWidth * INIT_ZOOM) / 2,
      y: topPad,
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
            CATEGORY_COLOR[(n.data as SceneNodeData).category as Category] ?? CATEGORY_COLOR.common
          }
          maskColor="rgba(19,22,28,.7)"
        />
        <Controls />
      </ReactFlow>
    </div>
  )
}
