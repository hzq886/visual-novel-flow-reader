/**
 * build-flow — route_map.html の N/E（→ route-map.data.ts に逐語ポート）を Flow スキーマへ
 * 写像して data/flow.routemap.json を生成する。
 *
 * 【降格】一次ソース extract-flow.py（HU-15・実装済）が SMAIN から data/flow.json を機械生成する
 * ようになったため、本スクリプトは二次（照合・ラベル補完）に降格。出力先も flow.json を
 * クロバーしないよう flow.routemap.json に変更（手動比較・HU-16 の制御構造 diff 用）。
 * アプリが読むのは flow.json（extract-flow 生成）のみ。
 *
 * 旧暫定方針（route_map ポートの設計メモ。参照のため残置）:
 *  - ノード/エッジのグラフ構造は route_map の N/E をそのまま採用。
 *  - scenes は実シーンコードのみ採用（"→ …" の結末ラベルや "_START" の擬似入口は除外）。
 *    これにより `npm run validate` の flow↔原テキスト相互照合（全 scenes が .txt 実在か）を満たす。
 *  - 分岐フラグ（FlowEdge.condition.flags）はこの暫定版では付与しない。フラグの機械表現は
 *    SMAIN の _DEF 軸を解析する HU-15 の役割（ノード description に人手注記のみ残す）。
 *  - build_ayan_end1.py の SCENES は綾菜END1の線形読み順で、route_map の ayan_route/ayan010/
 *    ayan_end1 ノードに既に内包されるため構造追加はしない（KEEP の select 範囲は HU-15 の
 *    テキストレベル分岐の出典）。
 *
 * 使い方: npm run data:flow
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Flow, type FlowEdge, type FlowNode } from '../src/pipeline/types.ts'
import { E, N } from './route-map.data.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const DATA_DIR = join(APP, 'data')

/** 実シーンコードのみ true（"→ NORMAL_END" 等の結末ラベル / "_START" の擬似入口を除外）。 */
const isRealScene = (s: string): boolean => !s.startsWith('→') && !s.startsWith('_')

function buildNodes(): FlowNode[] {
  return N.map((n) => ({
    id: n.id,
    kind: n.kind as FlowNode['kind'],
    character: n.c as FlowNode['character'],
    title: n.t,
    ...(n.ico ? { icon: n.ico } : {}),
    ...(n.d ? { description: n.d } : {}),
    pos: { x: n.x, y: n.y },
    scenes: n.sc.filter(isRealScene),
    ...(n.groups
      ? {
          groups: n.groups.map((g) => ({
            key: g.key,
            tone: g.tone,
            title: g.title,
            kids: g.kids.map((k) => ({ code: k.c, label: k.l })),
          })),
        }
      : {}),
  }))
}

function buildEdges(): FlowEdge[] {
  return E.map((e) => ({
    source: e[0],
    target: e[1],
    ...(e[2] ? { label: e[2] } : {}),
    ...(e[3] ? { character: e[3] } : {}),
  }))
}

async function main() {
  const nodes = buildNodes()
  const edges = buildEdges()

  // エッジ端点が実在ノードを指すか検証（転記ミスを早期検出）。
  const ids = new Set(nodes.map((n) => n.id))
  const dangling = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target))
  if (dangling.length > 0) {
    console.error('✗ 未解決のエッジ端点:')
    for (const e of dangling) console.error(`  ${e.source} → ${e.target}`)
    process.exit(1)
  }

  const flow = Flow.parse({ nodes, edges }) // スキーマ検証（kind/character の enum 等）
  await writeFile(
    join(DATA_DIR, 'flow.routemap.json'),
    JSON.stringify(flow, null, 2) + '\n',
    'utf8',
  )

  const sceneCount = new Set(flow.nodes.flatMap((n) => n.scenes)).size
  console.log(`[build-flow] route_map N/E → data/flow.routemap.json（二次・照合用）`)
  console.log(
    `  ✓ ${flow.nodes.length} ノード / ${flow.edges.length} エッジ（実シーン参照 ${sceneCount} 件、暫定・フラグ未付与）`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
