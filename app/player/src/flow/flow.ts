/**
 * flow — ルート図の純ヘルパー（React 非依存・Vitest 対象）。
 * data/flow.json（extract-flow.py が SMAIN から機械生成）への純クエリ。
 * React Flow 形状への写像はシーン単位グラフ（scenegraph.ts）＋レイアウト（layout.ts）が担う。
 */
import type { Flow } from '@/pipeline/types'

/**
 * シーンコードを内包するノードの id を返す（flow.json 上の所有 arc 特定）。
 * まず scenes、次に groups.kids を探索。どこにも無ければ null。
 */
export function findNodeIdByScene(flow: Flow, code: string): string | null {
  for (const n of flow.nodes) if (n.scenes.includes(code)) return n.id
  for (const n of flow.nodes)
    if (n.groups?.some((g) => g.kids.some((k) => k.code === code))) return n.id
  return null
}
