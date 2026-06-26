/**
 * flow/nav — flow.json のノード列／エッジから「次に何を再生するか」を解く純ロジック
 * （React/PIXI 非依存・Vitest 対象）。store の advance/choose/start が利用する。
 *
 * モデル:
 *  - ノードは順序付き scenes[] を持ち、ノード内は逐次再生。ノード末尾でエッジを辿る。
 *  - 分岐点 = ある scene が node.choices の `scene` で、その options に分岐先 `target`（HU-21）が付くもの。
 *    その scene を再生し終えたら選択肢を提示し、選んだ option の target ノードへ遷移する。
 *  - 単一エッジのノード末尾は自動進行。複数エッジ（choices 無し）はエッジ自体を選択肢化。
 *  - start や hub など scenes が空のノードは単一エッジを辿って最初の再生可能シーンへ解決する
 *    （SMAIN_* sink 等、辿り先が無ければ end）。HU-22（hub 合流後の継続）は本モデルの範囲外。
 */
import type { Flow, FlowNode } from '@/pipeline/types'

/** 選択肢の 1 オプション。target は解決済みシーンコード（辿り先が無ければ null＝終端）。 */
export type NavOption = { label: string; cn: string | null; target: string | null }

export type NavStep =
  | { kind: 'scene'; code: string }
  | { kind: 'choice'; options: NavOption[] }
  | { kind: 'end' }

export class FlowNav {
  private nodeById = new Map<string, FlowNode>()
  private locByScene = new Map<string, { node: FlowNode; idx: number }>()
  private outEdges = new Map<string, { target: string; label?: string }[]>()

  constructor(flow: Flow) {
    for (const n of flow.nodes) {
      this.nodeById.set(n.id, n)
      n.scenes.forEach((code, idx) => this.locByScene.set(code, { node: n, idx }))
    }
    for (const e of flow.edges) {
      const arr = this.outEdges.get(e.source) ?? []
      arr.push({ target: e.target, ...(e.label ? { label: e.label } : {}) })
      this.outEdges.set(e.source, arr)
    }
  }

  /** 物語の開始シーン（start ノードを解決）。解決できなければ null。 */
  firstScene(): string | null {
    const step = this.entry('start', new Set())
    return step.kind === 'scene' ? step.code : null
  }

  /** 現在シーンを再生し終えた後の次ステップ。 */
  advance(code: string): NavStep {
    const loc = this.locByScene.get(code)
    if (!loc) return { kind: 'end' }
    const { node, idx } = loc

    // この scene が分岐点なら選択肢を提示（ノード内の続きより優先）。
    const here = (node.choices ?? [])
      .filter((c) => c.scene === code)
      .flatMap((c) => c.options)
      .filter((o) => o.target)
    if (here.length > 0) {
      return {
        kind: 'choice',
        options: here.map((o) => ({ label: o.jp, cn: o.cn, target: this.entryCode(o.target!) })),
      }
    }

    // ノード内に続きがあれば次シーン。
    if (idx < node.scenes.length - 1) return { kind: 'scene', code: node.scenes[idx + 1] }

    // ノード末尾 → 出エッジ。
    const outs = this.outEdges.get(node.id) ?? []
    if (outs.length === 0) return { kind: 'end' }
    if (outs.length === 1) return this.entry(outs[0].target, new Set([node.id]))
    return this.branch(node, outs)
  }

  /** ノード id を最初の再生可能シーンへ解決（空シーンノードは単一エッジを辿る）。 */
  private entry(nodeId: string, seen: Set<string>): NavStep {
    if (seen.has(nodeId)) return { kind: 'end' }
    seen.add(nodeId)
    const node = this.nodeById.get(nodeId)
    if (!node) return { kind: 'end' }
    if (node.scenes.length > 0) return { kind: 'scene', code: node.scenes[0] }
    const outs = this.outEdges.get(nodeId) ?? []
    if (outs.length === 0) return { kind: 'end' }
    if (outs.length === 1) return this.entry(outs[0].target, seen)
    return this.branch(node, outs)
  }

  private entryCode(nodeId: string): string | null {
    const step = this.entry(nodeId, new Set())
    return step.kind === 'scene' ? step.code : null
  }

  /** 複数エッジ／choices を選択肢ステップへ。choices があれば文言を使い、無ければエッジラベル。 */
  private branch(node: FlowNode, outs: { target: string; label?: string }[]): NavStep {
    const opts = (node.choices ?? []).flatMap((c) => c.options).filter((o) => o.target)
    if (opts.length > 0) {
      return {
        kind: 'choice',
        options: opts.map((o) => ({ label: o.jp, cn: o.cn, target: this.entryCode(o.target!) })),
      }
    }
    return {
      kind: 'choice',
      options: outs.map((e) => ({
        label: e.label ?? e.target,
        cn: null,
        target: this.entryCode(e.target),
      })),
    }
  }
}
