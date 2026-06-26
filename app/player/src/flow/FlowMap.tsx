/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。data/flow.json を読み、
 * キャラ別配色のノード／ラベル付きエッジを表示。再生中シーン（usePlayer.scene）が属する
 * ノードを金枠でハイライトし、ストーリー進行と連動させる（prototype の highlightNode 相当）。
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
import { CHARACTER_COLOR, findNodeIdByScene, toReactFlow } from './flow'

const flow = Flow.parse(flowJson)
const base = toReactFlow(flow)

type NodeData = { label: string; character: string }

function nodeStyle(character: string, live: boolean): React.CSSProperties {
  const color = CHARACTER_COLOR[character] ?? CHARACTER_COLOR.common
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
      data: { label, character: n.data.character },
      style: nodeStyle(n.data.character, n.id === liveId),
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
    <div style={{ width: '100%', height: '100%' }}>
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
          nodeColor={(n) =>
            CHARACTER_COLOR[(n.data as NodeData).character] ?? CHARACTER_COLOR.common
          }
          maskColor="rgba(19,22,28,.7)"
        />
        <Controls />
      </ReactFlow>
    </div>
  )
}
