/**
 * fetch-assets — ローカル/別ディレクトリの素材ソース（ASSET_SRC）から、
 * 必要なファイルを app/player/public/assets/<category>/ へ同期し、
 * data/manifest.json（ファイル一覧＋size＋sha256）を生成・マージする。
 *
 * 使い方:
 *   npm run assets:fetch -- --scene 002_AYAN001A          # voice＋背景CG＋立ち絵をシーン別取得
 *   npm run assets:fetch -- --only bgm                    # カテゴリ全件
 *   npm run assets:fetch -- --only voice --scene 002_AYAN001A
 *   npm run assets:fetch -- --only cg,sprite,voice,se,bgm # 全カテゴリ全件（全編展開）
 *
 * 冪等: 既に同サイズで配置済 & manifest にハッシュ記録済のファイルは copy+sha256 を省略するため、
 * 再実行は差分のみ処理する（size 一致を同一性の代理に使う。安定ソースからの同期前提）。
 *
 * --scene 別フィルタ: voice はファイル名がシーンコードを含むため部分一致で絞る。背景CG/立ち絵は
 * parseScene→resolve で参照コードを算出して絞る（要 `data:defs` 済の sprites/backgrounds.json）。
 * se/bgm はシーンから決定的に絞れないため --only で全件取得する。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveScene, sceneAssetRefs } from '../src/pipeline/resolve.ts'
import { parseScene } from '../src/pipeline/scene.ts'
import { BgsetTable, SprsetTable } from '../src/pipeline/types.ts'

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

/**
 * シーンが参照する素材コードを parseScene→resolve で算出（cg=背景, sprite=立ち絵 body/face）。
 * 大小文字無視で照合できるよう小文字コード集合を返す。CG/立ち絵は jp/cn でバイト同一のため jp で解決。
 */
async function sceneWantedCodes(code: string): Promise<{ cg: Set<string>; sprite: Set<string> }> {
  const textPath = resolve(APP, '..', '..', 'data_extract', 'text', 'md_scr_text_jp', `${code}.txt`)
  const spritesPath = join(APP, 'data', 'sprites.json')
  const bgPath = join(APP, 'data', 'backgrounds.json')
  if (!existsSync(textPath)) {
    console.error(`✗ シーン原文が見つかりません: ${textPath}`)
    process.exit(1)
  }
  if (!existsSync(spritesPath) || !existsSync(bgPath)) {
    console.error(
      '✗ sprites.json / backgrounds.json が未生成。先に `npm run data:defs` を実行してください。',
    )
    process.exit(1)
  }
  const sprset = SprsetTable.parse(JSON.parse(await readFile(spritesPath, 'utf8')))
  const bgset = BgsetTable.parse(JSON.parse(await readFile(bgPath, 'utf8')))
  const scene = resolveScene(parseScene(await readFile(textPath, 'utf8'), { code, locale: 'jp' }), {
    sprset,
    bgset,
    voiceIndex: new Map(),
  })
  const refs = sceneAssetRefs(scene)
  return {
    cg: new Set(refs.cg.map((c) => c.toLowerCase())),
    sprite: new Set(refs.sprite.map((c) => c.toLowerCase())),
  }
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

  // 取得対象カテゴリ: --only 優先。無指定で --scene なら voice/cg/sprite（シーンから決定的に絞れる）。
  const categories: Category[] = only ?? (scene ? ['voice', 'cg', 'sprite'] : [])
  if (categories.length === 0) {
    console.error('✗ --scene <code> か --only <categories> を指定してください。')
    process.exit(1)
  }

  console.log(`ASSET_SRC = ${ASSET_SRC}`)
  if (scene) console.log(`--scene   = ${scene}`)
  console.log(`categories = ${categories.join(', ')}\n`)

  // bg/sprite はシーンが参照するコードに絞る（cg/sprite を取得する場合のみ算出）。
  const wanted =
    scene && (categories.includes('cg') || categories.includes('sprite'))
      ? await sceneWantedCodes(scene)
      : null

  const manifest = await loadManifest()
  let copied = 0
  let reused = 0
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
        // ボイスはファイル名がシーンコードを含むため部分一致で絞る。
        const needle = scene.toLowerCase()
        targets = names.filter((n) => n.toLowerCase().includes(needle))
      } else if ((category === 'cg' || category === 'sprite') && wanted) {
        // parseScene が解決した bg/sprite コードに一致するファイルのみ（拡張子除く・大小文字無視）。
        const want = category === 'cg' ? wanted.cg : wanted.sprite
        targets = names.filter((n) => want.has(n.replace(/\.[^.]+$/, '').toLowerCase()))
      } else {
        // se/bgm はシーンから決定的に絞れない。--only se/bgm で全件取得する。
        console.warn(
          `  (${category}) --scene 別フィルタ非対応。全件取得は --only ${category} を使用。`,
        )
        skippedNoSceneFilter += names.length
        continue
      }
    }

    const destDir = join(PUBLIC_ASSETS, category)
    await mkdir(destDir, { recursive: true })
    let catCopied = 0
    let catReused = 0
    for (const name of targets) {
      const src = join(srcDir, name)
      const dest = join(destDir, name)
      const file = `${category}/${name}`
      const srcSize = (await stat(src)).size
      // 冪等化: 既に同サイズで配置済 & manifest にハッシュ記録済なら copy+sha256 を省略する。
      // ローカルの安定ソースからの同期前提で、size 一致を同一性の代理に使う（再実行を高速化）。
      const prev = manifest.get(file)
      if (
        prev?.sha256 &&
        prev.size === srcSize &&
        existsSync(dest) &&
        (await stat(dest)).size === srcSize
      ) {
        catReused++
        continue
      }
      await copyFile(src, dest)
      const { size } = await stat(dest)
      manifest.set(file, { category, file, size, sha256: await sha256(dest) })
      catCopied++
    }
    copied += catCopied
    reused += catReused
    console.log(
      `  (${category}) ${targets.length} 対象  新規/更新 ${catCopied} ・ 再利用 ${catReused}`,
    )
  }

  await mkdir(dirname(MANIFEST_PATH), { recursive: true })
  const entries = [...manifest.values()].sort((a, b) => a.file.localeCompare(b.file))
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify({ generatedFrom: ASSET_SRC, entries }, null, 2) + '\n',
    'utf8',
  )

  console.log(
    `\n✓ public/assets へ同期: 新規/更新 ${copied} ・ 再利用 ${reused}（size 一致スキップ）`,
  )
  console.log(`✓ manifest: ${MANIFEST_PATH}（計 ${entries.length} エントリ）`)
  if (skippedNoSceneFilter > 0) {
    console.log(
      `  ※ se/bgm はシーン別フィルタ非対応で ${skippedNoSceneFilter} 件スキップ（--only で全件取得）`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
