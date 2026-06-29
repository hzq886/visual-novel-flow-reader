/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。
 * data/flow.json（arc 単位 CFG）を scenegraph で **1シーン=1ノード** に展開し、dagre で自動レイアウト、
 * カテゴリ別配色（category.ts の9分類）の SceneNode／ラベル付きエッジ＋凡例（Legend）を表示する。
 * 再生中シーン（usePlayer.scene）のノードを金枠でハイライトしてストーリー進行と連動させる。
 */
import { useCallback, useEffect, useMemo } from 'react'
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
  type SceneGraph,
  type SceneGraphEdge,
  type SceneGraphNode,
} from './scenegraph'
import { layoutGraph } from './layout'

const flow = Flow.parse(flowJson)
const sceneIndex = SceneIndex.parse(sceneIndexJson)

// 構造（ノード集合・エッジ）は locale 不変なので、レイアウトは一度だけ計算して使い回す。
const baseGraph = buildSceneGraph(flow, sceneIndex, 'jp')
const positions = layoutGraph(baseGraph, (n: SceneGraphNode) =>
  n.kind === 'scene' ? SCENE_SIZE : HUB_SIZE,
)

// nodeTypes はモジュールレベルで安定参照にする（毎レンダー再生成すると React Flow が警告）。
const nodeTypes = { flowNode: SceneNode }

function rfNodes(graph: SceneGraph, liveCode: string | null): Node<SceneNodeData>[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    draggable: false,
    data: {
      kind: n.kind,
      category: n.category,
      seq: n.seq,
      shortCode: n.shortCode,
      title: n.title,
      live: n.id === liveCode,
    },
  }))
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SceneNodeData>>(
    rfNodes(graph, sceneCode),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges(graph))

  // 再生中シーンの変化／言語切替で、ノード（ハイライト・見出し）とエッジ（ラベル）を更新。
  useEffect(() => {
    setNodes(rfNodes(graph, sceneCode))
    setEdges(rfEdges(graph))
  }, [graph, sceneCode, setNodes, setEdges])

  // シーンノードのクリックで物語をそのシーン先頭へスキップし、物語ビューへ戻す（HU-46）。
  // hub(分岐)/end/omake は再生対象シーンが無いので無視する。
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node<SceneNodeData>) => {
      if (node.data.kind !== 'scene') return
      void usePlayer.getState().gotoScene(node.id)
      onJump?.()
    },
    [onJump],
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
        nodesDraggable={false}
        minZoom={0.03}
        fitView
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
