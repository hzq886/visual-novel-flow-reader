/**
 * flow/scenegraph — flow.json（arc 単位の検証済み CFG）を **1シーン=1ノード** のグラフへ展開する
 * 純関数（React/dagre 非依存・Vitest 対象）。位置計算は持たない（layout.ts が担う）。
 *
 * モデル:
 *  - arc ノードの順序付き `scenes:[s0..sn]` を連鎖 s0→s1→…→sn に展開（各シーンが1ノード）。
 *  - flow.json の構造エッジは arc の末尾/先頭シーンへ張り替える（arc 入辺→先頭、出辺→末尾発）。
 *    選択肢シーンは各 arc 末尾なので、HU-21 が付けたラベル付き分岐エッジが末尾シーン発として残る。
 *  - hub(SMAIN_* / branch) と end / omake はノードとして残置。**start はノード化しない**（要件④）。
 */
import type { Flow, Locale, SceneIndex } from '@/pipeline/types'
import { categoryOfNode, categoryOfScene, type Category } from './category'

export type SceneGraphNode = {
  id: string // 完全シーンコード（例 "001_PRO001A"）。非シーンは hub/end/omake の id
  kind: 'scene' | 'branch' | 'end' | 'omake'
  category: Category
  title: string // ひと言の内容概要（locale 適用）
}

export type SceneGraphEdge = {
  id: string
  source: string
  target: string
  label?: string
  variant: 'continue' | 'structural' // continue=arc 内連鎖 / structural=flow.json のノード間辺
  branch: boolean // 選択肢ラベル付きの分岐辺か（Image #4 の意匠対象）
  category?: Category // 分岐辺の着地先カテゴリ（配色用）
}

export type SceneGraph = { nodes: SceneGraphNode[]; edges: SceneGraphEdge[] }

/** シーンコード → 短縮表示コード（"002_AYAN001A" → "001A"。接頭辞 NNN_XXX を除去）。 */
export function shortSceneCode(code: string): string {
  return code.replace(/^\d{3}_[A-Z]+/, '') || code
}

/** 生 title（"<prefix>\N<概要>" 形式。\N はリテラル2文字）→ ひと言概要。\N が無ければ全体、空なら ''。 */
export function sceneSummary(rawTitle: string): string {
  const parts = rawTitle
    .split(/\\N/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

function localeTitle(index: SceneIndex, code: string, locale: Locale): string {
  const e = index[code]
  if (!e) return ''
  return locale === 'cn' ? e.cn || e.jp : e.jp
}

/** flow.json（arc CFG）＋ scene-index ＋ locale → シーン単位グラフ。 */
export function buildSceneGraph(flow: Flow, index: SceneIndex, locale: Locale): SceneGraph {
  const nodes: SceneGraphNode[] = []
  const edges: SceneGraphEdge[] = []
  const firstScene = new Map<string, string>() // arc id → 先頭シーン
  const lastScene = new Map<string, string>() // arc id → 末尾シーン
  const dropped = new Set<string>() // ノード化しない（start）

  for (const n of flow.nodes) {
    if (n.kind === 'start') {
      dropped.add(n.id)
      continue
    }
    if (n.kind === 'arc') {
      n.scenes.forEach((code, i) => {
        const short = shortSceneCode(code)
        nodes.push({
          id: code,
          kind: 'scene',
          category: categoryOfScene(code),
          title: sceneSummary(localeTitle(index, code, locale)) || short,
        })
        if (i > 0) {
          const prev = n.scenes[i - 1]
          edges.push({
            id: `c-${prev}-${code}`,
            source: prev,
            target: code,
            variant: 'continue',
            branch: false,
          })
        }
      })
      if (n.scenes.length) {
        firstScene.set(n.id, n.scenes[0])
        lastScene.set(n.id, n.scenes[n.scenes.length - 1])
      }
    } else {
      // branch(hub) / end / omake はノードとして残置。
      const kind = n.kind === 'end' ? 'end' : n.kind === 'omake' ? 'omake' : 'branch'
      nodes.push({
        id: n.id,
        kind,
        category: categoryOfNode(n),
        title: n.title,
      })
    }
  }

  // 選択肢→分岐先の locale 別ラベル（HU-21 の FlowChoice.options）。key = "<choiceNodeId>-><targetNodeId>"。
  const choiceLabel = new Map<string, { jp: string; cn: string | null }>()
  for (const n of flow.nodes)
    for (const c of n.choices ?? [])
      for (const o of c.options)
        if (o.target) choiceLabel.set(`${n.id}->${o.target}`, { jp: o.jp, cn: o.cn })

  // 構造エッジ: arc は末尾/先頭シーンへ張り替え、hub/end/omake は自身、start 端点は落とす。
  const nodeIds = new Set(nodes.map((nn) => nn.id))
  const catById = new Map(nodes.map((nn) => [nn.id, nn.category]))
  const srcOf = (id: string) => lastScene.get(id) ?? id
  const tgtOf = (id: string) => firstScene.get(id) ?? id
  flow.edges.forEach((e, i) => {
    if (dropped.has(e.source) || dropped.has(e.target)) return
    const source = srcOf(e.source)
    const target = tgtOf(e.target)
    if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) return
    // 選択肢分岐は locale 別文言を優先（cn 未抽出は jp）。それ以外は flow.json の label（jp）。
    const opt = choiceLabel.get(`${e.source}->${e.target}`)
    const label = opt ? (locale === 'cn' ? (opt.cn ?? opt.jp) : opt.jp) : e.label
    edges.push({
      id: `s${i}-${source}-${target}`,
      source,
      target,
      ...(label ? { label } : {}),
      variant: 'structural',
      branch: !!opt,
      category: catById.get(target),
    })
  })

  return { nodes, edges }
}

/** シーンコード → 表示用の通し番号などを引く索引（FlowMap のライブハイライト等）。 */
export function indexByScene(graph: SceneGraph): Map<string, SceneGraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]))
}
