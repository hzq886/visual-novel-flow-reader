/**
 * engine/sceneLoader — シーン JSON を (code, locale) 指定で**動的ロード**する（全件を先読みしない）。
 * Vite の glob で data/scenes/<locale>/*.json を遅延 import 化し、要求時に 1 本だけ取得して Scene へ検証する。
 * 要求 locale に当該シーンが無い場合は jp へフォールバックする（cn 未収録シーンは jp 本文で再生継続）。
 * シーンが参照する cg/sprite の URL 集合も算出する（離脱シーンのテクスチャ解放＝メモリ管理用）。
 */
import { Scene, type BgRef, type Locale } from '@/pipeline/types'
import { cgUrl, spriteUrl } from './assets'

// おまけ（009_NUKE・HU-57）は原データに bg 指定が一切無く、直前に表示していたシーンの背景が
// そのまま残ってしまうため、タイトル画面絵 TITLE02 を curated 背景として先頭 beat に注入する
// （bg は sticky なので全編持続）。将来の再生成で bg が付いた場合は注入しない（no-bg guard）。
const OMAKE_BG_SCENE = /^009_NUKE/
const OMAKE_BG: BgRef = { label: '#背景・おまけ', file: 'TITLE02' }

// eager:false → 各値は () => Promise<{ default: unknown }>。バンドルは scene 単位に分割される。
const loaders = import.meta.glob('../../data/scenes/*/*.json')

// キーは "<locale>/<code>"（例 "cn/002_AYAN001A"）。
const byKey = new Map<string, () => Promise<unknown>>()
for (const [path, loader] of Object.entries(loaders)) {
  const parts = path.split('/')
  const code = parts.pop()!.replace(/\.json$/, '')
  const locale = parts.pop()! // .../scenes/<locale>/<code>.json
  byKey.set(`${locale}/${code}`, loader as () => Promise<unknown>)
}

export function hasScene(code: string, locale: Locale = 'jp'): boolean {
  return byKey.has(`${locale}/${code}`)
}

export async function loadScene(code: string, locale: Locale = 'jp'): Promise<Scene> {
  // 要求 locale に無ければ jp へフォールバック（cn 未訳シーンを jp 本文で再生継続する安全網。
  // 現状 jp/cn のシーン集合は一致＝発火しないが、将来 cn が不完全な場合の保険として残す）。
  let loader = byKey.get(`${locale}/${code}`)
  if (!loader && locale !== 'jp') {
    if (import.meta.env?.DEV)
      console.warn(`[sceneLoader] ${locale}/${code} 不在 → jp フォールバック`)
    loader = byKey.get(`jp/${code}`)
  }
  if (!loader) throw new Error(`scene not found: ${locale}/${code}（複合シーン/未生成の可能性）`)
  const mod = (await loader()) as { default: unknown }
  const scene = Scene.parse(mod.default)
  if (OMAKE_BG_SCENE.test(scene.code) && scene.beats.length && !scene.beats.some((b) => b.bg)) {
    scene.beats[0] = { ...scene.beats[0], bg: OMAKE_BG }
  }
  return scene
}

/** シーンが参照する背景CG/立ち絵の URL 集合（重複排除）。Assets.unload に渡す。 */
export function sceneAssetUrls(scene: Scene): string[] {
  const urls = new Set<string>()
  for (const beat of scene.beats) {
    if (beat.bg?.file) urls.add(cgUrl(beat.bg.file))
    if (beat.sprite?.body) urls.add(spriteUrl(beat.sprite.body))
    if (beat.sprite?.face) urls.add(spriteUrl(beat.sprite.face))
  }
  return [...urls]
}
