/**
 * validate — data/scenes/*.json の全 beat で bg.file / sprite.body|face / voice.file の
 * 未解決（null）を集計し、flow.json があれば参照シーンコードが原テキストに実在するか相互照合する。
 *
 * 合否方針（HU-25）: bg/sprite 未解決と flow 不在は**解決規則/データの穴**なので常に失敗。
 * voice 未解決は **manifest に当該 voice が未収録**（＝素材未同期、HU-26 で解消）であることが大半のため、
 * 既定では「既知例外」として集計のみ（合否に含めない）。`--strict` 指定時のみ voice 未解決も失敗扱い
 * （HU-26 で voice を全同期した後の最終確認用）。
 *
 * 使い方: npm run validate [-- --locale cn] [-- --strict]
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

function parseArgs(argv: string[]): { locale: Locale; strict: boolean } {
  let locale: Locale = 'jp'
  let strict = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--locale') locale = (argv[++i] as Locale) ?? 'jp'
    else if (argv[i] === '--strict') strict = true
  }
  return { locale, strict }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

type Unresolved = { scene: string; beat: number; kind: string; ref: string; label: string }

async function main() {
  const { locale, strict } = parseArgs(process.argv.slice(2))
  const problems: Unresolved[] = []
  let voiceTotal = 0 // voice を持つ line beat の総数（解決率の分母）
  let seTotal = 0 // se 参照の総数（解決率の分母）
  // manifest があれば se/bgm の未解決＝参照不整合（不正コード/track）として hard fail 扱い。
  // 無い環境（素材未配置）では se/bgm は file=null/未付与になるため照合をスキップする。
  const manifestPresent = existsSync(join(DATA_DIR, 'manifest.json'))

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
      if (beat.kind === 'line' && beat.voice) {
        voiceTotal++
        if (beat.voice.file === null)
          problems.push({
            scene: scene.code,
            beat: i,
            kind: 'voice',
            ref: 'file',
            label: beat.voice.id,
          })
      }
      for (const s of beat.se ?? []) {
        seTotal++
        if (manifestPresent && s.file === null)
          problems.push({ scene: scene.code, beat: i, kind: 'se', ref: 'file', label: s.code })
      }
    })
    if (manifestPresent && scene.bgm && scene.bgm.file === null)
      problems.push({
        scene: scene.code,
        beat: -1,
        kind: 'bgm',
        ref: 'file',
        label: scene.bgm.track,
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

  // ---- 集計（カテゴリ別）----
  // bg/sprite は解決規則/データの穴 → 常に hard fail。se/bgm も manifest 照合の参照不整合なので
  // hard fail（manifest 不在環境では上で収集しないため 0）。voice は素材未同期（HU-26）→ 既定は既知例外。
  const hard = problems.filter(
    (p) => p.kind === 'bg' || p.kind === 'sprite' || p.kind === 'se' || p.kind === 'bgm',
  )
  const se = problems.filter((p) => p.kind === 'se')
  const bgm = problems.filter((p) => p.kind === 'bgm')
  const voice = problems.filter((p) => p.kind === 'voice')
  const voiceResolved = voiceTotal - voice.length
  const voicePct = voiceTotal === 0 ? 100 : (voiceResolved / voiceTotal) * 100

  // ---- レポート ----
  console.log(`[validate] locale=${locale}  scenes=${sceneFiles.length}  beats=${beatTotal}`)
  console.log(
    `  未解決内訳: bg/sprite ${hard.length - se.length - bgm.length}  /  se ${se.length}` +
      `（参照 ${seTotal}）  /  bgm ${bgm.length}  /  voice ${voice.length}` +
      `（voice 解決 ${voiceResolved}/${voiceTotal} = ${voicePct.toFixed(1)}%）`,
  )

  if (hard.length > 0) {
    console.error(`\n✗ bg/sprite/se/bgm 未解決 ${hard.length} 件（解決規則/データ/参照の穴）:`)
    for (const p of hard.slice(0, 50))
      console.error(`  ${p.scene} beat#${p.beat} ${p.kind}.${p.ref}  ← ${p.label}`)
    if (hard.length > 50) console.error(`  …他 ${hard.length - 50} 件`)
  }
  if (voice.length > 0) {
    const head = strict ? '✗' : '⚠'
    const note = strict
      ? '（--strict: 失敗扱い）'
      : '（既知例外。assets:fetch 未実行＝同期で解消 / 実行済＝欠落素材）'
    console.error(`\n${head} voice 未解決 ${voice.length} 件${note}:`)
    for (const p of voice.slice(0, 10))
      console.error(`  ${p.scene} beat#${p.beat} voice.file  ← ${p.label}`)
    if (voice.length > 10) console.error(`  …他 ${voice.length - 10} 件`)
  }
  if (missingFlowScenes.length > 0) {
    console.error(
      `\n✗ flow が参照する不在シーン ${missingFlowScenes.length} 件: ${missingFlowScenes.join(', ')}`,
    )
  }
  console.log(`  ${flowNote}`)

  const failed = hard.length > 0 || missingFlowScenes.length > 0 || (strict && voice.length > 0)
  if (failed) {
    console.error('\n✗ validate 失敗')
    process.exit(1)
  }
  if (voice.length > 0) {
    console.log(
      `\n✓ validate 緑（bg/sprite/flow 解決済。voice ${voice.length} 件未解決＝未同期 or 欠落素材。--strict で一覧）`,
    )
  } else {
    console.log('\n✓ validate 緑（未解決参照なし）')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
