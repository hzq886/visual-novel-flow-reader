/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。data/flow.json を読み、
 * カテゴリ別配色（category.ts の9分類）のノード／ラベル付きエッジ＋凡例（Legend）を表示。
 * 再生中シーン（usePlayer.scene）が属するノードを金枠でハイライトし、ストーリー進行と
 * 連動させる（prototype の highlightNode 相当）。
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
import { Flow, type Locale } from '@/pipeline/types'
import { usePlayer } from '@/store/player'
import { findNodeIdByScene, toReactFlow } from './flow'
import { CATEGORY_COLOR, type Category } from './category'
import { Legend } from './Legend'

const flow = Flow.parse(flowJson)
const base = toReactFlow(flow)

type NodeData = { label: string; category: Category }

function nodeStyle(category: Category, live: boolean): React.CSSProperties {
  const color = CATEGORY_COLOR[category] ?? CATEGORY_COLOR.common
  return {
    background: 'linear-gradient(180deg,#222936,#1b202a)',
    color: live ? '#fff3d6' : '#e7ecf3',
    border: `1.5px solid ${live ? '#ffe6a6' : color}`,
    borderRadius: 12,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 700,
    width: 180,
    whiteSpace: 'pre-line', // 選択肢ラベルの改行（◇…）を表示
    textAlign: 'center',
    boxShadow: live
      ? '0 0 0 2.5px #ffd166, 0 0 26px 2px rgba(255,209,102,.6)'
      : `0 0 0 1px ${color}33`,
  }
}

// 選択肢メニュー（HU-18）をノードに可視化: オプションを「◇A／B」でラベル末尾に付す。
// locale=cn では cn 文言（未抽出は jp）を使う。ノード見出し（n.data.label）は flow.json に cn が
// 無いため jp のまま（構造ラベル）。
const choicesById = new Map(flow.nodes.map((n) => [n.id, n.choices ?? []]))

function choiceLabel(id: string, locale: Locale): string {
  return (choicesById.get(id) ?? [])
    .flatMap((c) => c.options.map((o) => (locale === 'cn' ? (o.cn ?? o.jp) : o.jp)))
    .join('／')
}

function rfNodes(liveId: string | null, locale: Locale): Node<NodeData>[] {
  return base.nodes.map((n) => {
    const choices = choiceLabel(n.id, locale)
    const label = choices ? `${n.data.label}\n◇${choices}` : n.data.label
    return {
      id: n.id,
      position: n.position,
      data: { label, category: n.data.category },
      style: nodeStyle(n.data.category, n.id === liveId),
    }
  })
}

const initialEdges: Edge[] = base.edges.map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  label: e.label,
  style: { stroke: '#3a4252', strokeWidth: 2 },
  labelStyle: { fill: '#dfe6ef', fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: '#0e1117' },
  labelBgPadding: [5, 3],
  labelBgBorderRadius: 4,
}))

export function FlowMap() {
  const sceneCode = usePlayer((s) => s.scene?.code ?? null)
  const locale = usePlayer((s) => s.locale)
  const liveId = useMemo(() => (sceneCode ? findNodeIdByScene(flow, sceneCode) : null), [sceneCode])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(rfNodes(liveId, locale))
  const [edges, , onEdgesChange] = useEdgesState<Edge>(initialEdges)

  // 再生中シーンの変化／言語切替で、該当ノードのハイライトと選択肢ラベルを更新。
  useEffect(() => {
    setNodes(rfNodes(liveId, locale))
  }, [liveId, locale, setNodes])

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={false}
        minZoom={0.2}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: '#13161c' }}
      >
        <Background color="#222834" gap={26} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => CATEGORY_COLOR[(n.data as NodeData).category] ?? CATEGORY_COLOR.common}
          maskColor="rgba(19,22,28,.7)"
        />
        <Controls />
      </ReactFlow>
    </div>
  )
}
