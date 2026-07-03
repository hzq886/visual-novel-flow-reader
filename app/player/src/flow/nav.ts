/**
 * flow/nav — flow.json のノード列／エッジから「次に何を再生するか」を解く純ロジック
 * （React/PIXI 非依存・Vitest 対象）。store の advance/choose/start が利用する。
 *
 * モデル:
 *  - ノードは順序付き scenes[] を持ち、ノード内は逐次再生。ノード末尾でエッジを辿る。
 *  - 分岐点 = ある scene が node.choices の `scene` で、その options に分岐先 `target`（HU-21）が付くもの。
 *    その scene を再生し終えたら選択肢を提示し、選んだ option の target ノードへ遷移する。
 *  - 単一エッジのノード末尾は自動進行。複数エッジ（choices 無し）はエッジ自体を選択肢化。
 *  - start や hub など scenes が空のノードは単一エッジを辿って最初の再生可能シーンへ解決する。
 *    hub（SMAIN_* 合流点）は HU-22 で継続先（label 表で解決したブロック先頭）への単一エッジを持つので、
 *    本モデルの entry() がそのまま継続先シーンへ解決する（sink は解消済）。
 */
import type { Flow, FlowNode, SceneIndex } from '@/pipeline/types'
import { sceneSummary } from './scenegraph'

/** 選択肢の 1 オプション。target は解決済みシーンコード（辿り先が無ければ null＝終端）。 */
export type NavOption = { label: string; cn: string | null; target: string | null }

/**
 * 文言なしエッジ分岐の curated ラベル（HU-61）。key = `"<sourceScene>-><解決済み targetScene>"`。
 * 基本は行き先シーンの題（scene-index。jp/cn 自動対応）で表示し、題では意味が伝わらない箇所
 * だけここで上書きする。現状は 010_MAIN003A の大分岐（原作では S14 翼×S15 真琴の無言フラグ
 * 分岐＝行き先の題よりルート名の方が選択肢として分かりやすい）のみ。
 */
const BRANCH_LABELS: Record<string, { jp: string; cn: string }> = {
  '010_MAIN003A->002_AYAN005A': { jp: '姉妹ルートへ', cn: '姐妹路线' },
  '010_MAIN003A->005_MAKO003A': { jp: '真琴ルートへ', cn: '真琴路线' },
  '010_MAIN003A->006_TUBA003A': { jp: '翼ルートへ', cn: '翼路线' },
}

/** 題なしの翼＆真琴 任意挿入シーン（012_SUBTM 系・HU-23）の汎用ラベル。 */
const UNTITLED_INSERT_LABEL = { jp: '挿入シーン（翼＆真琴）', cn: '插入场景（翼＆真琴）' }

export type NavStep =
  | { kind: 'scene'; code: string }
  | { kind: 'choice'; options: NavOption[] }
  | { kind: 'end' }

export class FlowNav {
  private nodeById = new Map<string, FlowNode>()
  private locByScene = new Map<string, { node: FlowNode; idx: number }>()
  private outEdges = new Map<string, { target: string; label?: string }[]>()
  private index?: SceneIndex // 文言なしエッジ分岐のラベル解決用（行き先の題を引く・HU-61）

  constructor(flow: Flow, index?: SceneIndex) {
    this.index = index
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
    // 選択肢文言の無いエッジ分岐は、解決先シーンが同じものをまとめる（SMAIN のフラグ分岐が
    // 抽出で並列エッジ化されたもの＝ユーザに区別を提示する意味が無い。HU-62）。まとめた結果が
    // 単一なら選択肢を出さず自動進行し、全て終端（例 006_TUBA018B の NORMAL_END/TRUE_END）なら
    // end を返す。ラベルは人間可読の文言へ解決する（HU-61）。
    const srcScene = node.scenes.length ? node.scenes[node.scenes.length - 1] : undefined
    const byTarget = new Map<string | null, NavOption>()
    for (const e of outs) {
      const target = this.entryCode(e.target)
      if (byTarget.has(target)) continue
      const l = this.branchLabel(srcScene, target, e.label ?? e.target)
      byTarget.set(target, { label: l.jp, cn: l.cn, target })
    }
    const options = [...byTarget.values()]
    if (options.length === 1) {
      return options[0].target === null
        ? { kind: 'end' }
        : { kind: 'scene', code: options[0].target }
    }
    return { kind: 'choice', options }
  }

  /**
   * 文言なしエッジ分岐のラベル解決（HU-61）: curated 上書き → 行き先シーンの題（scene-index、
   * jp/cn）→ 題なし 012_SUBTM 挿入の汎用ラベル → 生 id（最終フォールバック）。
   */
  private branchLabel(
    srcScene: string | undefined,
    target: string | null,
    raw: string,
  ): { jp: string; cn: string | null } {
    if (srcScene && target) {
      const curated = BRANCH_LABELS[`${srcScene}->${target}`]
      if (curated) return curated
    }
    if (target) {
      const e = this.index?.[target]
      const jp = sceneSummary(e?.jp ?? '')
      if (jp) return { jp, cn: e?.cn ? sceneSummary(e.cn) || null : null }
      if (/^012_SUBTM/.test(target)) return UNTITLED_INSERT_LABEL
    }
    return { jp: raw, cn: null }
  }
}
