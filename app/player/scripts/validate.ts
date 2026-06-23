/**
 * validate — data/scenes/*.json の全 beat で bg.file / sprite.body|face / voice.file の
 * 未解決（null）を集計し、flow.json があれば参照シーンコードが原テキストに実在するか相互照合する。
 * 未解決・不整合があれば exit 1。
 *
 * 使い方: npm run validate [-- --locale cn]
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Flow, Scene, type Locale } from '../src/pipeline/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url)) // app/player/scripts
const APP = resolve(HERE, '..') // app/player
const DATA_DIR = join(APP, 'data')
const SCENES_DIR = join(DATA_DIR, 'scenes')

function parseArgs(argv: string[]): { locale: Locale } {
  let locale: Locale = 'jp'
  for (let i = 0; i < argv.length; i++)
    if (argv[i] === '--locale') locale = (argv[++i] as Locale) ?? 'jp'
  return { locale }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

type Unresolved = { scene: string; beat: number; kind: string; ref: string; label: string }

async function main() {
  const { locale } = parseArgs(process.argv.slice(2))
  const problems: Unresolved[] = []

  if (!existsSync(SCENES_DIR)) {
    console.error('✗ data/scenes/ が無い。先に `npm run data:scenes` を実行してください。')
    process.exit(1)
  }
  const sceneFiles = (await readdir(SCENES_DIR)).filter((f) => f.endsWith('.json')).sort()
  if (sceneFiles.length === 0) {
    console.error('✗ data/scenes/ が空。`npm run data:scenes` でシーンを生成してください。')
    process.exit(1)
  }

  let beatTotal = 0
  for (const file of sceneFiles) {
    const scene = Scene.parse(await readJson(join(SCENES_DIR, file)))
    scene.beats.forEach((beat, i) => {
      beatTotal++
      if (beat.bg && beat.bg.file === null)
        problems.push({ scene: scene.code, beat: i, kind: 'bg', ref: 'file', label: beat.bg.label })
      if (beat.sprite && beat.sprite.body === null)
        problems.push({
          scene: scene.code,
          beat: i,
          kind: 'sprite',
          ref: 'body',
          label: beat.sprite.label,
        })
      if (beat.sprite && beat.sprite.face === null)
        problems.push({
          scene: scene.code,
          beat: i,
          kind: 'sprite',
          ref: 'face',
          label: beat.sprite.label,
        })
      if (beat.kind === 'line' && beat.voice && beat.voice.file === null)
        problems.push({
          scene: scene.code,
          beat: i,
          kind: 'voice',
          ref: 'file',
          label: beat.voice.id,
        })
    })
  }

  // flow ↔ シーンコード 相互照合（flow.json があれば）。
  let flowNote = 'flow.json 無し → 相互照合スキップ'
  const flowPath = join(DATA_DIR, 'flow.json')
  const missingFlowScenes: string[] = []
  if (existsSync(flowPath)) {
    const flow = Flow.parse(await readJson(flowPath))
    const textDir = resolve(APP, '..', '..', 'data_extract', 'text', `md_scr_text_${locale}`)
    const realCodes = new Set(
      (await readdir(textDir))
        .filter((f) => /^[0-9].*\.txt$/.test(f))
        .map((f) => f.replace(/\.txt$/, '')),
    )
    const flowCodes = new Set(flow.nodes.flatMap((n) => n.scenes))
    for (const code of flowCodes) if (!realCodes.has(code)) missingFlowScenes.push(code)
    flowNote = `flow ${flowCodes.size} シーン参照、原テキスト不在 ${missingFlowScenes.length}`
  }

  // ---- レポート ----
  console.log(`[validate] locale=${locale}  scenes=${sceneFiles.length}  beats=${beatTotal}`)
  if (problems.length > 0) {
    console.error(`\n✗ 未解決参照 ${problems.length} 件:`)
    for (const p of problems.slice(0, 50))
      console.error(`  ${p.scene} beat#${p.beat} ${p.kind}.${p.ref}  ← ${p.label}`)
    if (problems.length > 50) console.error(`  …他 ${problems.length - 50} 件`)
  }
  if (missingFlowScenes.length > 0) {
    console.error(
      `\n✗ flow が参照する不在シーン ${missingFlowScenes.length} 件: ${missingFlowScenes.join(', ')}`,
    )
  }
  console.log(`  ${flowNote}`)

  if (problems.length > 0 || missingFlowScenes.length > 0) {
    console.error('\n✗ validate 失敗')
    process.exit(1)
  }
  console.log('\n✓ validate 緑（未解決参照なし）')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
