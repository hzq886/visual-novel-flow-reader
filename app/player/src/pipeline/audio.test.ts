import { describe, it, expect } from 'vitest'
import manifestJson from '@data/manifest.json'
import {
  BGM_BY_CHARACTER,
  SE_RE,
  bgmTrackForScene,
  buildBgmIndex,
  buildSeIndex,
  characterOfScene,
  resolveBgm,
  resolveSe,
} from './audio'
import { Manifest } from './types'

const manifest = Manifest.parse(manifestJson)

describe('SE_RE — se コード判定', () => {
  it('4桁+英字1 を se として受理（大小文字とも）', () => {
    for (const c of ['8351A', '0001a', '0001D', '1201B', '9001A']) expect(SE_RE.test(c)).toBe(true)
  })
  it('ボイスID/選択肢ID/制御マーカーは弾く', () => {
    for (const c of ['AYAN_002_AYAN001A_001', '002_AYAN008A_01_01', 'BG_BLACK', 'MIX01', 'OFF'])
      expect(SE_RE.test(c)).toBe(false)
  })
})

describe('characterOfScene — シーンコード → character', () => {
  it('接頭辞トークンで character を判定', () => {
    expect(characterOfScene('001_PRO001A')).toBe('common')
    expect(characterOfScene('010_MAIN003A')).toBe('common')
    expect(characterOfScene('002_AYAN001A')).toBe('ayan')
    expect(characterOfScene('003_SUZU001C')).toBe('suzu')
    expect(characterOfScene('006_TUBA001B')).toBe('tuba')
    expect(characterOfScene('012_SUBTM005A')).toBe('tuba') // 複合ルートは tuba レーン
    expect(characterOfScene('005_MAKO001A')).toBe('mako')
    expect(characterOfScene('007_KAED001C')).toBe('kaede')
    expect(characterOfScene('009_NUKE002')).toBe('omake')
  })
  it('未知トークンは common', () => {
    expect(characterOfScene('999_XXXX001A')).toBe('common')
  })
})

describe('bgmTrackForScene — ルート別 BGM 割当', () => {
  it('character に対応する track を返す', () => {
    expect(bgmTrackForScene('002_AYAN001A')).toBe(BGM_BY_CHARACTER.ayan)
    expect(bgmTrackForScene('001_PRO001A')).toBe(BGM_BY_CHARACTER.common)
  })
  it('割当はすべて M01-M16 の範囲', () => {
    for (const track of Object.values(BGM_BY_CHARACTER)) expect(track).toMatch(/^M(0[1-9]|1[0-6])$/)
  })
})

describe('resolveSe / resolveBgm — manifest 照合', () => {
  const seIndex = buildSeIndex(manifest)
  const bgmIndex = buildBgmIndex(manifest)

  it('se コードは大小文字無視で実ファイルへ解決', () => {
    // 原データは大文字（8351A）、ファイルは小文字（8351a.ogg）。
    expect(resolveSe(seIndex, '8351A')).toEqual({ code: '8351A', file: 'se/8351a.ogg' })
    expect(resolveSe(seIndex, '0001D').file).toBe('se/0001d.ogg')
  })
  it('未収録 se は file=null', () => {
    expect(resolveSe(seIndex, '9999z').file).toBeNull()
  })
  it('bgm track は実ファイルへ解決', () => {
    expect(resolveBgm(bgmIndex, 'M02')).toEqual({ track: 'M02', file: 'bgm/M02.ogg' })
  })
  it('全 character の BGM track が manifest に存在（参照不整合 0）', () => {
    for (const track of Object.values(BGM_BY_CHARACTER))
      expect(resolveBgm(bgmIndex, track).file, track).not.toBeNull()
  })
})
