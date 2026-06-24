/**
 * flow — ルート図の純ヘルパー（React 非依存・Vitest 対象）。
 * data/flow.json（build-flow が生成）を React Flow 形状へ写像し、再生中シーンコードから
 * 対応ノードを引く（連動ハイライト用）。描画は FlowMap.tsx。
 */
import type { Flow } from '@/pipeline/types'

/** キャラ/種別 → 色。route_map.html の COL を移植。 */
export const CHARACTER_COLOR: Record<string, string> = {
  common: '#7b8696',
  ayan: '#e07a93',
  suzu: '#6f93e0',
  tuba: '#3fb6ad',
  mako: '#b08ae8',
  kaede: '#e0a94f',
  branch: '#e9c07a',
  end: '#ffd166',
  omake: '#5d6571',
}

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
  data: { label: string; character: string; kind: string }
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
      character: n.character,
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
