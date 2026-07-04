import { describe, it, expect } from 'vitest'
import {
  assetUrl,
  cgUrl,
  containFit,
  coverScale,
  isItemCg,
  GAME_H,
  GAME_W,
  spriteUrl,
} from './assets'

describe('asset URL 組み立て', () => {
  it('bg コード → /assets/cg/<code>.png', () => {
    expect(cgUrl('BG20_02_00')).toBe('/assets/cg/BG20_02_00.png')
  })
  it('sprite コード → /assets/sprite/<code>.png', () => {
    expect(spriteUrl('CH01B_01_02_003_02')).toBe('/assets/sprite/CH01B_01_02_003_02.png')
  })
  it('manifest 相対パス → /assets/<path>（voice）', () => {
    expect(assetUrl('voice/ayan_002_ayan001A_001.ogg')).toBe(
      '/assets/voice/ayan_002_ayan001A_001.ogg',
    )
  })
})

describe('レイアウト計算', () => {
  it('containFit: 同アスペクト(2560×1440)はちょうど 2倍・letterbox 無し', () => {
    expect(containFit(GAME_W * 2, GAME_H * 2)).toEqual({ scale: 2, x: 0, y: 0 })
  })
  it('containFit: 横長ビューは縦基準でフィットし左右に余白', () => {
    const { scale, x, y } = containFit(2000, 720)
    expect(scale).toBe(1) // min(2000/1280, 720/720)=1
    expect(y).toBe(0)
    expect(x).toBe((2000 - GAME_W) / 2)
  })
  it('coverScale: 背景(1280×720)は等倍で覆える', () => {
    expect(coverScale(GAME_W, GAME_H)).toBe(1)
  })
  it('coverScale: 小さめテクスチャは拡大して覆う', () => {
    expect(coverScale(640, 360)).toBe(2)
  })
})

describe('isItemCg（HU-69: アイテムCGは原寸・中央表示）', () => {
  it('ITEM_* コードはアイテムCG', () => {
    expect(isItemCg('ITEM_03_01')).toBe(true)
  })
  it('URL 形式（/assets/cg/ITEM_*.png）でも判定できる', () => {
    expect(isItemCg('/assets/cg/ITEM_03_01.png')).toBe(true)
  })
  it('通常背景コードは対象外', () => {
    expect(isItemCg('BG08_11_00')).toBe(false)
    expect(isItemCg('/assets/cg/BG08_11_00.png')).toBe(false)
  })
  it('CHARVIEW_ITEM など前置き付きコードは対象外', () => {
    expect(isItemCg('CHARVIEW_ITEM')).toBe(false)
    expect(isItemCg('/assets/cg/CHARVIEW_ITEM_ON.png')).toBe(false)
  })
})
