/**
 * build-scene-index — data/scenes/{jp,cn}/*.json の `title` を集約し、
 * data/scene-index.json（シーンコード → { jp, cn } の生 title）を生成する。
 *
 * 使い方:
 *   npm run data:scene-index
 *
 * フロー図のシーンノード見出し（ひと言概要）専用の軽量索引。beats を含めないため、
 * 描画レイヤが全シーン JSON を bundle せずに見出しだけを引ける。生成物・手編集禁止
 * （data:scene-index で再生成）。title の整形（`\N` 区切りの概要抽出）は描画側の
 * 純関数（src/flow/scenegraph.ts の sceneSummary）が担う。
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SceneIndex } from '../src/pipeline/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const DATA_DIR = join(APP, 'data')
const SCENES_DIR = join(DATA_DIR, 'scenes')

/** locale ディレクトリの全シーン JSON から code → title を読む（存在しない locale は空）。 */
async function titlesForLocale(locale: 'jp' | 'cn'): Promise<Map<string, string>> {
  const dir = join(SCENES_DIR, locale)
  const out = new Map<string, string>()
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return out // locale 未生成
  }
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(dir, f), 'utf8')) as { code: string; title?: string }
    out.set(raw.code, raw.title ?? '')
  }
  return out
}

async function main() {
  const jp = await titlesForLocale('jp')
  const cn = await titlesForLocale('cn')

  const codes = [...new Set([...jp.keys(), ...cn.keys()])].sort()
  const index: SceneIndex = {}
  for (const code of codes) {
    index[code] = { jp: jp.get(code) ?? '', cn: cn.get(code) ?? '' }
  }

  const validated = SceneIndex.parse(index)
  const path = join(DATA_DIR, 'scene-index.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(validated, null, 2) + '\n', 'utf8')

  const withCn = codes.filter((c) => cn.get(c)).length
  console.log(`[build-scene-index] ${codes.length} シーン（jp ${jp.size} / cn ${withCn}）`)
  console.log(`  ✓ ${path}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
