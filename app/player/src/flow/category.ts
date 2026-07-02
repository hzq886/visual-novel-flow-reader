/**
 * flow/category — フロー図の「表示カテゴリ」モデル（9分類）と配色。純関数・Vitest 対象。
 *
 * これは **フロー図の見た目分類専用**であり、音声(BGM)割当の `characterOfScene`（audio.ts、7分類）
 * とは別概念。最大の違い: 双子合流(FUTA)・翼＋真琴合流(SUBTM)を独立カテゴリ `merge`(合流) に分離する
 * （audio.ts ではそれぞれ suzu / tuba レーンに畳む。BGM 挙動は変えない）。
 *
 * 凡例（8カテゴリ）: 共通 / 綾菜 / 涼菜 / 翼 / 真琴 / 楓 / 合流 / エンド。
 * （旧「分岐」カテゴリは hub ノードの配色専用だったが、HU-55 で hub を畳んだため廃止。分岐は
 *  選択肢シーンのラベル付き辺＝着地先カテゴリ色で表現する。）
 */
import type { FlowNode } from '@/pipeline/types'

export type Category = 'common' | 'ayan' | 'suzu' | 'tuba' | 'mako' | 'kaede' | 'merge' | 'end'

// シーンコード接頭辞トークン → 表示カテゴリ（実データのルート系統を分析して確定）。
// PRO/MAIN/NUKE=共通, AYAN/SUBA=綾菜, SUZU=涼菜, TUBA/SUBT=翼, MAKO=真琴, KAED=楓,
// FUTA(綾菜＆涼菜)/SUBTM(翼＋真琴)=合流。
const CATEGORY_BY_TOKEN: Record<string, Category> = {
  PRO: 'common',
  MAIN: 'common',
  NUKE: 'common',
  AYAN: 'ayan',
  SUBA: 'ayan',
  SUZU: 'suzu',
  FUTA: 'merge',
  TUBA: 'tuba',
  SUBT: 'tuba',
  SUBTM: 'merge',
  MAKO: 'mako',
  KAED: 'kaede',
}

/** シーンコード（"002_AYAN001A"）→ 表示カテゴリ。未知トークン/不一致は common。 */
export function categoryOfScene(code: string): Category {
  const m = /^\d{3}_([A-Z]+?)\d/.exec(code)
  if (!m) return 'common'
  return CATEGORY_BY_TOKEN[m[1]] ?? 'common'
}

/** 凡例・配色の正準順。 */
export const CATEGORY_ORDER: Category[] = [
  'common',
  'ayan',
  'suzu',
  'tuba',
  'mako',
  'kaede',
  'merge',
  'end',
]

/**
 * Flow ノード → 表示カテゴリ。end=エンド / start・omake・branch(hub)=共通。
 * arc ノードは内包シーンの多数決カテゴリ（タイは CATEGORY_ORDER 優先で決定的）。
 * ※ シーン単位ノード化（HU-44）後は各ノードが単一シーン＝`categoryOfScene` で足りる。
 *   hub(branch) は HU-55 で畳んで描画しないため配色対象外（呼ばれても共通に落とす）。
 */
export function categoryOfNode(node: Pick<FlowNode, 'kind' | 'scenes'>): Category {
  if (node.kind === 'end') return 'end'
  if (node.kind === 'start' || node.kind === 'omake' || node.kind === 'branch') return 'common'
  const counts = new Map<Category, number>()
  for (const code of node.scenes) {
    const c = categoryOfScene(code)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best: Category = 'common'
  let bestN = 0
  for (const c of CATEGORY_ORDER) {
    const n = counts.get(c) ?? 0
    if (n > bestN) {
      best = c
      bestN = n
    }
  }
  return best
}

/** カテゴリ → 配色（凡例画像準拠＋合流に独立色 green。楓は end の金色と紛らわしいため水色・HU-58）。 */
export const CATEGORY_COLOR: Record<Category, string> = {
  common: '#7b8696',
  ayan: '#e07a93',
  suzu: '#6f93e0',
  tuba: '#3fb6ad',
  mako: '#b08ae8',
  kaede: '#5bc8f5',
  merge: '#6bbf73',
  end: '#ffd166',
}

/** カテゴリ → 凡例表示名（日本語）。 */
export const CATEGORY_LABEL: Record<Category, string> = {
  common: '共通',
  ayan: '綾菜',
  suzu: '涼菜',
  tuba: '翼',
  mako: '真琴',
  kaede: '楓',
  merge: '合流',
  end: 'エンド',
}
