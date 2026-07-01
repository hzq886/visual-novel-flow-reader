/**
 * flow/scenegraph — flow.json（arc 単位の検証済み CFG）を **1シーン=1ノード** のグラフへ展開する
 * 純関数（React/dagre 非依存・Vitest 対象）。位置計算は持たない（layout.ts が担う）。
 *
 * モデル:
 *  - arc ノードの順序付き `scenes:[s0..sn]` を連鎖 s0→s1→…→sn に展開（各シーンが1ノード）。
 *  - flow.json の構造エッジは arc の末尾/先頭シーンへ張り替える（arc 入辺→先頭、出辺→末尾発）。
 *    選択肢シーンは各 arc 末尾なので、HU-21 が付けたラベル付き分岐エッジが末尾シーン発として残る。
 *  - hub(SMAIN_* / branch) は分岐点ではなく合流/素通り点（全 hub out=1）なので**ノード化せず畳む**
 *    （HU-55）: 入辺を継続先の実シーンへ張り替え、空の合流ノードを消す。分岐自体は選択肢シーンの
 *    ラベル付き辺が担う。end / omake は終端マーカーとしてノード残置。**start はノード化しない**（要件④）。
 */
import type { Flow, Locale, SceneIndex } from '@/pipeline/types'
import { categoryOfNode, categoryOfScene, type Category } from './category'

export type SceneGraphNode = {
  id: string // 完全シーンコード（例 "001_PRO001A"）。非シーンは hub/end/omake の id
  kind: 'scene' | 'branch' | 'end' | 'omake'
  category: Category
  title: string // ひと言の内容概要（locale 適用）。題が無いシーンは短縮コードにフォールバック
  titled?: boolean // 原作のタイトルカードを持つシーンか（フォールバックでない実題）。grouping の頭判定用
}

/**
 * シーンタイトル群（HU-51）。タイトルカードを持つシーン（head）と、そこから連なる**題なし継続
 * シーン**を1つのコンテナにまとめる単位。原作はカット（暗転/背景・CGリセット）で題を打ち直すため、
 * 題なしの継続は直前の題シーンの続き＝同じエピソード。head の題をコンテナ見出しにする。
 */
export type SceneGroup = {
  id: string // コンテナノード id（"grp-<headId>"）
  headId: string // 題を持つ先頭シーン
  title: string // コンテナ見出し（head の locale 適用題）
  memberIds: string[] // head を先頭に、取り込んだ題なし継続シーンを含む全メンバー
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
  const hubIds = new Set<string>() // 畳む hub(branch)。入辺を継続先へ張り替え、ノード化しない

  for (const n of flow.nodes) {
    if (n.kind === 'start') {
      dropped.add(n.id)
      continue
    }
    if (n.kind === 'arc') {
      n.scenes.forEach((code, i) => {
        const short = shortSceneCode(code)
        const summary = sceneSummary(localeTitle(index, code, locale))
        nodes.push({
          id: code,
          kind: 'scene',
          category: categoryOfScene(code),
          title: summary || short,
          titled: !!summary,
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
    } else if (n.kind === 'end' || n.kind === 'omake') {
      // end / omake は終端マーカーとしてノード残置。
      nodes.push({
        id: n.id,
        kind: n.kind,
        category: categoryOfNode(n),
        title: n.title,
      })
    } else {
      // branch(hub) は畳む（HU-55）。ノード化せず、入辺を継続先の実シーンへ張り替える（下の辺ループ）。
      hubIds.add(n.id)
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

  // hub 畳み込み: 各 hub の唯一の out 継続先を辿り、着地先の実シーン（arc 先頭）へ解決する。
  // hub→hub 連鎖は推移的に辿る（現データには無いが安全側。guard で循環も防ぐ）。
  const hubOut = new Map<string, string>()
  for (const e of flow.edges) if (hubIds.has(e.source)) hubOut.set(e.source, e.target)
  const resolveTarget = (id: string): string => {
    let cur = id
    const guard = new Set<string>()
    while (hubIds.has(cur) && !guard.has(cur)) {
      guard.add(cur)
      const nx = hubOut.get(cur)
      if (nx === undefined) break
      cur = nx
    }
    return tgtOf(cur)
  }

  flow.edges.forEach((e, i) => {
    if (dropped.has(e.source) || dropped.has(e.target)) return
    // hub の出辺は入辺の張替で代替するので落とす（source が hub のケース）。
    if (hubIds.has(e.source)) return
    const source = srcOf(e.source)
    // 着地先が hub なら畳んで継続先の実シーンへ張り替える。
    const target = hubIds.has(e.target) ? resolveTarget(e.target) : tgtOf(e.target)
    if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) return
    // 選択肢分岐は locale 別文言を優先（cn 未抽出は jp）。それ以外は flow.json の label（jp）。
    // choiceLabel は raw id（畳む前の hub 宛）で引くので、継続先へ張り替えてもラベルは移設される。
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

/**
 * シーングラフ → タイトル群（HU-51）。題を持つシーンを head とし、そこから前方へ辿れる**題なし
 * 継続シーン**を最近接の head に取り込む。別の題シーン／hub／end／omake で停止（境界）。
 *
 * - head から forward BFS。題なし scene 後続のみ取り込み、距離が近い head を優先（同距離は head id 昇順で安定）。
 * - hub 経由でしか辿れない題なしシーンは合流点扱いでどの群にも属さず単独（呼び出し側でフォールバック表示）。
 * - メンバー（題なし継続）を1つ以上持つ head のみ群化（単独 head は通常ノードのまま）。
 * 構造は locale 非依存（題の有無は jp 基準で安定させる前提で呼ぶ）。見出し文字列のみ locale 依存。
 */
export function groupScenes(graph: SceneGraph): SceneGroup[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    const a = adj.get(e.source)
    if (a) a.push(e.target)
    else adj.set(e.source, [e.target])
  }
  const isTitleless = (id: string): boolean => {
    const n = byId.get(id)
    return n?.kind === 'scene' && !n.titled
  }
  const heads = graph.nodes.filter((n) => n.kind === 'scene' && n.titled)

  // 題なしシーン id → 最近接 head（{ head, depth }）。
  const owner = new Map<string, { head: string; depth: number }>()
  for (const h of heads) {
    const queue: Array<[string, number]> = [[h.id, 0]]
    const seen = new Set<string>([h.id])
    for (let i = 0; i < queue.length; i++) {
      const [cur, d] = queue[i]
      for (const nx of adj.get(cur) ?? []) {
        if (seen.has(nx)) continue
        seen.add(nx)
        if (!isTitleless(nx)) continue // 別題シーン・hub・end・omake は境界（取り込まず辿らない）
        const prev = owner.get(nx)
        if (!prev || d + 1 < prev.depth || (d + 1 === prev.depth && h.id < prev.head)) {
          owner.set(nx, { head: h.id, depth: d + 1 })
        }
        queue.push([nx, d + 1])
      }
    }
  }

  const membersByHead = new Map<string, string[]>()
  for (const [scene, { head }] of owner) {
    const m = membersByHead.get(head)
    if (m) m.push(scene)
    else membersByHead.set(head, [scene])
  }
  const groups: SceneGroup[] = []
  for (const h of heads) {
    const m = membersByHead.get(h.id)
    if (!m || m.length === 0) continue
    groups.push({ id: `grp-${h.id}`, headId: h.id, title: h.title, memberIds: [h.id, ...m] })
  }
  return groups
}
