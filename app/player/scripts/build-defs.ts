/**
 * build-defs — data_extract/text の _SPRSET.txt / _BGSET.txt をパースして
 * data/sprites.json（立ち絵）/ data/backgrounds.json（背景）の解決テーブルを生成する。
 *
 * 使い方:
 *   npm run data:defs            # jp（既定）
 *   npm run data:defs -- --locale cn
 *
 * テキストソースは git 管理下（data_extract/text/md_scr_text_<locale>/）。
 * パース本体は src/pipeline/defs.ts（純関数、Vitest 対象）。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSprset, parseBgset } from '../src/pipeline/defs.ts'
import { SprsetTable, BgsetTable } from '../src/pipeline/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const DATA_DIR = join(APP, 'data')

function parseArgs(argv: string[]): { locale: 'jp' | 'cn' } {
  let locale: 'jp' | 'cn' = 'jp'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--locale') locale = (argv[++i] as 'jp' | 'cn') ?? 'jp'
  }
  return { locale }
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

async function main() {
  const { locale } = parseArgs(process.argv.slice(2))
  const textDir = resolve(APP, '..', '..', 'data_extract', 'text', `md_scr_text_${locale}`)

  const sprites = SprsetTable.parse(
    parseSprset(await readFile(join(textDir, '_SPRSET.txt'), 'utf8')),
  )
  const backgrounds = BgsetTable.parse(
    parseBgset(await readFile(join(textDir, '_BGSET.txt'), 'utf8')),
  )

  await writeJson(join(DATA_DIR, 'sprites.json'), sprites)
  await writeJson(join(DATA_DIR, 'backgrounds.json'), backgrounds)

  console.log(`[build-defs] locale=${locale}  source=${textDir}`)
  console.log(`  ✓ sprites.json      ${Object.keys(sprites).length} prefix ブロック`)
  console.log(`  ✓ backgrounds.json  ${Object.keys(backgrounds).length} 背景ラベル`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
