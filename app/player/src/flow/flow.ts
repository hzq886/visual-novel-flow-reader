/**
 * flow — ルート図の純ヘルパー（React 非依存・Vitest 対象）。
 * data/flow.json（extract-flow.py が SMAIN から機械生成）を React Flow 形状へ写像し、
 * 再生中シーンコードから対応ノードを引く（連動ハイライト用）。描画は FlowMap.tsx。
 */
import type { Flow } from '@/pipeline/types'
import { categoryOfNode, type Category } from './category'

/**
 * シーンコードを内包するノードの id を返す（連動ハイライトの所有者特定）。
 * まず scenes、次に groups.kids を探索。どこにも無ければ null。
 */
export function findNodeIdByScene(flow: Flow, code: string): string | null {
  for (const n of flow.nodes) if (n.scenes.includes(code)) return n.id
  for (const n of flow.nodes)
    if (n.groups?.some((g) => g.kids.some((k) => k.code === code))) return n.id
  return null
}

export interface RfNode {
  id: string
  position: { x: number; y: number }
  data: { label: string; category: Category; kind: string }
}

export interface RfEdge {
  id: string
  source: string
  target: string
  label?: string
}

/** Flow → React Flow の素のノード/エッジ配列（プレーンオブジェクト＝node でテスト可能）。 */
export function toReactFlow(flow: Flow): { nodes: RfNode[]; edges: RfEdge[] } {
  const nodes: RfNode[] = flow.nodes.map((n) => ({
    id: n.id,
    position: { x: n.pos?.x ?? 0, y: n.pos?.y ?? 0 },
    data: {
      label: n.icon ? `${n.icon} ${n.title}` : n.title,
      category: categoryOfNode(n),
      kind: n.kind,
    },
  }))
  const edges: RfEdge[] = flow.edges.map((e, i) => ({
    id: `e${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
  }))
  return { nodes, edges }
}
