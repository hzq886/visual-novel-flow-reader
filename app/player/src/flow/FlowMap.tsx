/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。
 * data/flow.json（arc 単位 CFG）を scenegraph で **1シーン=1ノード** に展開し、dagre で自動レイアウト、
 * カテゴリ別配色（category.ts の9分類）の SceneNode／ラベル付きエッジ＋凡例（Legend）を表示する。
 * 再生中シーン（usePlayer.scene）のノードを金枠でハイライトしてストーリー進行と連動させる。
 */
import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
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
import { buildSceneGraph, type SceneGraph, type SceneGraphNode } from './scenegraph'
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

function rfEdges(graph: SceneGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
    style: { stroke: '#3a4252', strokeWidth: 1.8 },
    labelStyle: { fill: '#dfe6ef', fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: '#0e1117' },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 4,
  }))
}

export function FlowMap() {
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
