/**
 * engine/sceneLoader — シーン JSON をコード指定で**動的ロード**する（全 288 を先読みしない）。
 * Vite の glob で data/scenes/*.json を遅延 import 化し、要求時に 1 本だけ取得して Scene へ検証する。
 * シーンが参照する cg/sprite の URL 集合も算出する（離脱シーンのテクスチャ解放＝メモリ管理用）。
 */
import { Scene } from '@/pipeline/types'
import { cgUrl, spriteUrl } from './assets'

// eager:false → 各値は () => Promise<{ default: unknown }>。バンドルは scene 単位に分割される。
const loaders = import.meta.glob('../../data/scenes/*.json')

const byCode = new Map<string, () => Promise<unknown>>()
for (const [path, loader] of Object.entries(loaders)) {
  const code = path
    .split('/')
    .pop()!
    .replace(/\.json$/, '')
  byCode.set(code, loader as () => Promise<unknown>)
}

export function hasScene(code: string): boolean {
  return byCode.has(code)
}

export async function loadScene(code: string): Promise<Scene> {
  const loader = byCode.get(code)
  if (!loader) throw new Error(`scene not found: ${code}（複合シーン/未生成の可能性）`)
  const mod = (await loader()) as { default: unknown }
  return Scene.parse(mod.default)
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
