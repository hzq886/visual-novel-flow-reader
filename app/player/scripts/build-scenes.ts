/**
 * build-scenes — data_extract/text のシーンファイルに parseScene を適用し、
 * data/scenes/<code>.json を生成する。
 *
 * 使い方:
 *   npm run data:scenes                      # 全シーン（jp）
 *   npm run data:scenes -- --scene 002_AYAN001A
 *   npm run data:scenes -- --locale cn
 *
 * この段階では bg/sprite/voice は label のみ（file=null）。素材実体の解決（resolve* +
 * manifest 照合）は validate/resolve 工程（VN-4）で行う。パース本体は src/pipeline/scene.ts。
 */
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseScene } from '../src/pipeline/scene.ts'
import type { Locale } from '../src/pipeline/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const SCENES_DIR = join(APP, 'data', 'scenes')

function parseArgs(argv: string[]): { locale: Locale; scene: string | null } {
  let locale: Locale = 'jp'
  let scene: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--locale') locale = (argv[++i] as Locale) ?? 'jp'
    else if (argv[i] === '--scene') scene = argv[++i] ?? null
  }
  return { locale, scene }
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

  await rm(SCENES_DIR, { recursive: true, force: true })
  await mkdir(SCENES_DIR, { recursive: true })

  let ok = 0
  let beatTotal = 0
  for (const file of targets.sort()) {
    const code = file.replace(/\.txt$/, '')
    const parsed = parseScene(await readFile(join(textDir, file), 'utf8'), { code, locale })
    await writeFile(
      join(SCENES_DIR, `${code}.json`),
      JSON.stringify(parsed, null, 2) + '\n',
      'utf8',
    )
    ok++
    beatTotal += parsed.beats.length
  }

  console.log(`[build-scenes] locale=${locale}  source=${textDir}`)
  console.log(`  ✓ ${ok} シーン → data/scenes/  （計 ${beatTotal} beats）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
