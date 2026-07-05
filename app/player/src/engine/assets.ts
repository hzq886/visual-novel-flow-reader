/**
 * engine/assets — 解決済みコード/パスから public/assets の URL を組み立てる純関数。
 *
 * 解決規則（HU-8/ADR 0004）:
 *  - bg     : backgrounds.json のコード（例 "BG20_02_00"）→ /assets/cg/<code>.png
 *  - sprite : sprites.json の body/face コード（例 "CH01B_01_02_003_02"）→ /assets/sprite/<code>.png
 *  - voice  : manifest の相対パス（例 "voice/ayan_002_ayan001A_001.ogg"）→ /assets/<path>
 */

/** 原ゲームの論理解像度（16:9）。Stage はこの空間に描画して画面へ contain フィットする。 */
export const GAME_W = 1280
export const GAME_H = 720

/** Vite が public/ を配信するベース。 */
const ASSET_BASE = '/assets'

export function cgUrl(code: string): string {
  return `${ASSET_BASE}/cg/${code}.png`
}

export function spriteUrl(code: string): string {
  return `${ASSET_BASE}/sprite/${code}.png`
}

/** voice/se/bgm は manifest の相対パス（カテゴリ＋拡張子込み）をそのまま使う。 */
export function assetUrl(manifestFile: string): string {
  return `${ASSET_BASE}/${manifestFile}`
}

/** contain フィット: 論理 GAME 空間を (w,h) ビューに収める scale と中央寄せ位置。 */
export function containFit(viewW: number, viewH: number): { scale: number; x: number; y: number } {
  const scale = Math.min(viewW / GAME_W, viewH / GAME_H)
  return { scale, x: (viewW - GAME_W * scale) / 2, y: (viewH - GAME_H * scale) / 2 }
}

/** cover スケール: テクスチャ (tw,th) を論理 GAME 空間全体を覆うよう拡大する倍率。 */
export function coverScale(tw: number, th: number): number {
  return Math.max(GAME_W / tw, GAME_H / th)
}
