/**
 * resolve — parseScene が付けた label/id を実ファイル参照へ解決する純関数。
 *
 * - bg     : backgrounds.json（#背景/#EV ラベル → BGコード）。resolveBg（defs.ts）。
 * - sprite : sprites.json（prefix→body/face suffix。code+suffix が素材コード）。resolveSprite（defs.ts）。
 * - voice  : **manifest を真実の源**に大小文字無視で照合（候補変換は不確実なため）。
 *
 * voice の大小文字問題: ボイスID `AYAN_002_AYAN001A_001` の実ファイルは
 * `ayan_002_ayan001A_001.ogg`。char/route 部は小文字だが末尾のシーン変種文字（…001"A"）は
 * 大文字のまま、という非自明な規則のため単純 toLowerCase() では一致しない。よって
 * manifest のファイル名を小文字化キーで索引し、ID も小文字化して引く（実体の正規名を返す）。
 * 規則は docs/adr/0004-voice-resolution.md 参照。
 */
import { resolveBg, resolveSprite } from './defs'
import type { BgsetTable, Manifest, Scene, SprsetTable, VoiceRef } from './types'

/** manifest の voice エントリを「小文字 basename（拡張子なし）→ 実パス」で索引。 */
export function buildVoiceIndex(manifest: Manifest): Map<string, string> {
  const index = new Map<string, string>()
  for (const e of manifest.entries) {
    if (e.category !== 'voice') continue
    const base = e.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '') // "ayan_002_ayan001A_001"
    index.set(base.toLowerCase(), e.file)
  }
  return index
}

/** ボイスID → VoiceRef。manifest 未収録なら file=null（validate が検出）。 */
export function resolveVoice(index: Map<string, string>, id: string): VoiceRef {
  return { id, file: index.get(id.toLowerCase()) ?? null }
}

export type ResolveContext = {
  sprset: SprsetTable
  bgset: BgsetTable
  voiceIndex: Map<string, string>
}

/** Scene の全 beat の bg/sprite/voice を解決した新しい Scene を返す。 */
export function resolveScene(scene: Scene, ctx: ResolveContext): Scene {
  return {
    ...scene,
    beats: scene.beats.map((beat) => {
      const bg = beat.bg ? resolveBg(ctx.bgset, beat.bg.label) : undefined
      const sprite = beat.sprite ? resolveSprite(ctx.sprset, beat.sprite.label) : undefined
      if (beat.kind === 'line') {
        return {
          ...beat,
          ...(bg ? { bg } : {}),
          ...(sprite ? { sprite } : {}),
          ...(beat.voice ? { voice: resolveVoice(ctx.voiceIndex, beat.voice.id) } : {}),
        }
      }
      return { ...beat, ...(bg ? { bg } : {}), ...(sprite ? { sprite } : {}) }
    }),
  }
}
