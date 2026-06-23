/**
 * fetch-assets — ローカル/別ディレクトリの素材ソース（ASSET_SRC）から、
 * 必要なファイルを app/player/public/assets/<category>/ へ同期し、
 * data/manifest.json（ファイル一覧＋size＋sha256）を生成・マージする。
 *
 * 使い方:
 *   ASSET_SRC=/abs/path npm run assets:fetch -- --scene 002_AYAN001A
 *   npm run assets:fetch -- --only bgm
 *   npm run assets:fetch -- --only voice --scene 002_AYAN001A
 *
 * Sprint 0 の縦串では voice をシーンコードでフィルタ取得できる（ファイル名がシーンコードを含むため決定的）。
 * 背景CG/立ち絵のシーン別フィルタは parseScene（VN-3）完成後に VN-5 で配線する。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Category = 'cg' | 'sprite' | 'voice' | 'se' | 'bgm'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const ASSET_SRC = resolve(process.env.ASSET_SRC ?? resolve(APP, '../../data_extract'))
const PUBLIC_ASSETS = join(APP, 'public', 'assets')
const MANIFEST_PATH = join(APP, 'data', 'manifest.json')

const SRC_DIRS: Record<Category, string> = {
  cg: join(ASSET_SRC, 'CG', 'md_gra_cg'),
  sprite: join(ASSET_SRC, 'CG', 'md_gra2_cg'),
  voice: join(ASSET_SRC, 'audio', 'md_cv_audio'),
  se: join(ASSET_SRC, 'audio', 'md_se_audio'),
  bgm: join(ASSET_SRC, 'audio', 'md_bgm_audio'),
}

type ManifestEntry = { category: Category; file: string; size: number; sha256: string | null }

function parseArgs(argv: string[]) {
  let scene: string | null = null
  let only: Category[] | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--scene') scene = argv[++i] ?? null
    else if (a === '--only') only = (argv[++i] ?? '').split(',').filter(Boolean) as Category[]
  }
  return { scene, only }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  return (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => d.name)
}

async function loadManifest(): Promise<Map<string, ManifestEntry>> {
  if (!existsSync(MANIFEST_PATH)) return new Map()
  try {
    const json = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    return new Map((json.entries as ManifestEntry[]).map((e) => [e.file, e]))
  } catch {
    return new Map()
  }
}

async function main() {
  const { scene, only } = parseArgs(process.argv.slice(2))

  if (!existsSync(ASSET_SRC)) {
    console.error(`✗ ASSET_SRC が見つかりません: ${ASSET_SRC}`)
    console.error('  環境変数 ASSET_SRC で素材ソースの絶対パスを指定してください。')
    process.exit(1)
  }

  // 取得対象カテゴリ: --only 優先。無指定で --scene のみなら voice（シーンから決定的に絞れる唯一のカテゴリ）。
  const categories: Category[] = only ?? (scene ? ['voice'] : [])
  if (categories.length === 0) {
    console.error('✗ --scene <code> か --only <categories> を指定してください。')
    process.exit(1)
  }

  console.log(`ASSET_SRC = ${ASSET_SRC}`)
  if (scene) console.log(`--scene   = ${scene}`)
  console.log(`categories = ${categories.join(', ')}\n`)

  const manifest = await loadManifest()
  let copied = 0
  let skippedNoSceneFilter = 0

  for (const category of categories) {
    const srcDir = SRC_DIRS[category]
    const names = await listFiles(srcDir)
    if (names.length === 0) {
      console.warn(`  (${category}) ソース無し or 空: ${srcDir}`)
      continue
    }

    let targets = names
    if (scene) {
      if (category === 'voice') {
        const needle = scene.toLowerCase()
        targets = names.filter((n) => n.toLowerCase().includes(needle))
      } else {
        // 背景CG/立ち絵のシーン別フィルタは parseScene 連携（VN-5）まで未対応。
        console.warn(
          `  (${category}) --scene フィルタは未対応のためスキップ（VN-5 で parseScene 連携）。`,
        )
        skippedNoSceneFilter += names.length
        continue
      }
    }

    const destDir = join(PUBLIC_ASSETS, category)
    await mkdir(destDir, { recursive: true })
    for (const name of targets) {
      const src = join(srcDir, name)
      const dest = join(destDir, name)
      await copyFile(src, dest)
      const { size } = await stat(dest)
      const file = `${category}/${name}`
      manifest.set(file, { category, file, size, sha256: await sha256(dest) })
      copied++
    }
    console.log(`  (${category}) ${targets.length} ファイル取得`)
  }

  await mkdir(dirname(MANIFEST_PATH), { recursive: true })
  const entries = [...manifest.values()].sort((a, b) => a.file.localeCompare(b.file))
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify({ generatedFrom: ASSET_SRC, entries }, null, 2) + '\n',
    'utf8',
  )

  console.log(`\n✓ ${copied} ファイルを public/assets へ同期`)
  console.log(`✓ manifest: ${MANIFEST_PATH}（計 ${entries.length} エントリ）`)
  if (skippedNoSceneFilter > 0) {
    console.log(`  ※ シーン別フィルタ未対応で ${skippedNoSceneFilter} 件スキップ（VN-5 で対応）`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
