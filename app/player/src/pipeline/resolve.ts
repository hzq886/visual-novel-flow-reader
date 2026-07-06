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
import { bgmTrackForScene, resolveBgm, resolveSe } from './audio'
import { resolveBg, resolveSprite } from './defs'
import type { BgsetTable, Manifest, Scene, SeRef, SprsetTable, VoiceRef } from './types'

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
  seIndex?: Map<string, string> // se コード（小文字）→ ファイル。未指定なら se は file=null のまま
  bgmIndex?: Map<string, string> // bgm track（"M01"）→ ファイル。未指定なら bgm 未付与
}

/**
 * 解決済み Scene が参照する素材コード/ID を重複なく収集する（fetch-assets のシーン別取得用）。
 * cg=背景コード（BG…）、sprite=立ち絵 body/face コード（CH…）、voice=ボイスID。
 */
export function sceneAssetRefs(scene: Scene): { cg: string[]; sprite: string[]; voice: string[] } {
  const cg = new Set<string>()
  const sprite = new Set<string>()
  const voice = new Set<string>()
  for (const beat of scene.beats) {
    if (beat.bg?.file) cg.add(beat.bg.file)
    if (beat.item?.file) cg.add(beat.item.file) // アイテムCG窓（HU-70）も cg 素材
    for (const sp of beat.sprites ?? []) {
      if (sp.body) sprite.add(sp.body)
      if (sp.face) sprite.add(sp.face)
    }
    if (beat.kind === 'line' && beat.voice?.id) voice.add(beat.voice.id)
    if (beat.bgv?.id) voice.add(beat.bgv.id) // 背景ボイスも voice 素材として収集（HU-37）
  }
  return { cg: [...cg], sprite: [...sprite], voice: [...voice] }
}

/** Scene の全 beat の bg/sprite/voice/se と、シーンの bgm を解決した新しい Scene を返す。 */
export function resolveScene(scene: Scene, ctx: ResolveContext): Scene {
  // se: seIndex があれば各コードを実ファイルへ解決、無ければ parseScene の値（file=null）のまま。
  const resolveSeList = (se: SeRef[] | undefined): { se?: SeRef[] } => {
    if (!se) return {}
    return { se: ctx.seIndex ? se.map((s) => resolveSe(ctx.seIndex!, s.code)) : se }
  }
  const bgm = ctx.bgmIndex ? { bgm: resolveBgm(ctx.bgmIndex, bgmTrackForScene(scene.code)) } : {}
  return {
    ...scene,
    ...bgm,
    beats: scene.beats.map((beat) => {
      const bg = beat.bg ? resolveBg(ctx.bgset, beat.bg.label) : undefined
      // 立ち絵スロット列（多体・HU-77）: 各スロットを個別に解決（label→body/face・顔オフセット）。
      const sprites = beat.sprites
        ? { sprites: beat.sprites.map((sp) => resolveSprite(ctx.sprset, sp.label)) }
        : {}
      // アイテムCG窓: code がそのまま CG ファイルコード（_BGSET を介さない直CG。HU-41/HU-70）。
      const item = beat.item ? { item: { ...beat.item, file: beat.item.code } } : {}
      // 背景ボイス（BGV）は voice と同じく manifest 索引で解決（id→実ファイル）。
      const bgv = beat.bgv ? { bgv: resolveVoice(ctx.voiceIndex, beat.bgv.id) } : {}
      if (beat.kind === 'line') {
        return {
          ...beat,
          ...(bg ? { bg } : {}),
          ...sprites,
          ...item,
          ...(beat.voice ? { voice: resolveVoice(ctx.voiceIndex, beat.voice.id) } : {}),
          ...resolveSeList(beat.se),
          ...bgv,
        }
      }
      return {
        ...beat,
        ...(bg ? { bg } : {}),
        ...sprites,
        ...item,
        ...resolveSeList(beat.se),
        ...bgv,
      }
    }),
  }
}
