/**
 * build-scenes — data_extract/text のシーンファイルに parseScene を適用し、
 * bg/sprite/voice を実ファイル参照へ解決して data/scenes/<code>.json を生成する。
 *
 * 使い方:
 *   npm run data:scenes                      # 全シーン（jp）
 *   npm run data:scenes -- --scene 002_AYAN001A
 *   npm run data:scenes -- --locale cn
 *
 * 解決には data/sprites.json・data/backgrounds.json（`npm run data:defs`）と
 * data/manifest.json（`npm run assets:fetch`）が要る。manifest 未収録の voice は file=null
 * （`npm run validate` が検出）。パース=src/pipeline/scene.ts、解決=src/pipeline/resolve.ts。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScene } from '../src/pipeline/scene.ts'
import { buildVoiceIndex, resolveScene } from '../src/pipeline/resolve.ts'
import { buildBgmIndex, buildSeIndex } from '../src/pipeline/audio.ts'
import { BgsetTable, Manifest, SprsetTable, type Locale } from '../src/pipeline/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const DATA_DIR = join(APP, 'data')
const SCENES_DIR = join(DATA_DIR, 'scenes')

function parseArgs(argv: string[]): { locale: Locale; scene: string | null } {
  let locale: Locale = 'jp'
  let scene: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--locale') locale = (argv[++i] as Locale) ?? 'jp'
    else if (argv[i] === '--scene') scene = argv[++i] ?? null
  }
  return { locale, scene }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function loadContext() {
  const spritesPath = join(DATA_DIR, 'sprites.json')
  const bgPath = join(DATA_DIR, 'backgrounds.json')
  if (!existsSync(spritesPath) || !existsSync(bgPath)) {
    console.error(
      '✗ sprites.json / backgrounds.json が未生成です。先に `npm run data:defs` を実行してください。',
    )
    process.exit(1)
  }
  const sprset = SprsetTable.parse(await readJson(spritesPath))
  const bgset = BgsetTable.parse(await readJson(bgPath))

  const manifestPath = join(DATA_DIR, 'manifest.json')
  let voiceIndex = new Map<string, string>()
  let seIndex: Map<string, string> | undefined
  let bgmIndex: Map<string, string> | undefined
  if (existsSync(manifestPath)) {
    const manifest = Manifest.parse(await readJson(manifestPath))
    voiceIndex = buildVoiceIndex(manifest)
    seIndex = buildSeIndex(manifest)
    bgmIndex = buildBgmIndex(manifest)
  } else {
    console.warn(
      '  ⚠ manifest.json 無し → voice は未解決・se/bgm は未付与（`npm run assets:fetch` 後に再生成）',
    )
  }
  return { sprset, bgset, voiceIndex, seIndex, bgmIndex }
}

async function main() {
  const { locale, scene } = parseArgs(process.argv.slice(2))
  const textDir = resolve(APP, '..', '..', 'data_extract', 'text', `md_scr_text_${locale}`)

  const all = (await readdir(textDir)).filter((f) => /^[0-9].*\.txt$/.test(f))
  const targets = scene ? all.filter((f) => f === `${scene}.txt`) : all
  if (targets.length === 0) {
    console.error(`✗ 対象シーンが見つかりません（--scene ${scene} / ${textDir}）`)
    process.exit(1)
  }

  const ctx = await loadContext()

  await rm(SCENES_DIR, { recursive: true, force: true })
  await mkdir(SCENES_DIR, { recursive: true })

  let ok = 0
  const skipped: string[] = []
  let beatTotal = 0
  for (const file of targets.sort()) {
    const code = file.replace(/\.txt$/, '')
    const parsed = parseScene(await readFile(join(textDir, file), 'utf8'), { code, locale })
    const resolved = resolveScene(parsed, ctx)
    // 本文 [text] を持たず [id] 参照のみの複合シーン（例 006_TUBA010BC = 010B+010C を束ねる連結子）は
    // beats=0 になる。flow は構成アトム（010B/010C）を参照し複合は辿らないため、再生対象外として出力しない。
    if (resolved.beats.length === 0) {
      skipped.push(code)
      continue
    }
    await writeFile(
      join(SCENES_DIR, `${code}.json`),
      JSON.stringify(resolved, null, 2) + '\n',
      'utf8',
    )
    ok++
    beatTotal += resolved.beats.length
  }

  console.log(`[build-scenes] locale=${locale}  source=${textDir}`)
  console.log(`  ✓ ${ok} シーン → data/scenes/  （計 ${beatTotal} beats、bg/sprite/voice 解決済）`)
  if (skipped.length > 0)
    console.log(
      `  ⏭ ${skipped.length} 件スキップ（複合シーン: 本文なし・[id] 参照のみ。flow は構成アトムを参照）`,
    )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
