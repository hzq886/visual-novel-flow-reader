import { describe, it, expect } from 'vitest'
// 実データ（生成済み解決テーブル＋manifest）と 002 フィクスチャで統合的に検証。
import bgJson from '@data/backgrounds.json'
import manifestJson from '@data/manifest.json'
import spritesJson from '@data/sprites.json'
import fixture from '../../../../data_extract/text/md_scr_text_jp/002_AYAN001A.txt?raw'
import { buildVoiceIndex, resolveScene, resolveVoice } from './resolve'
import { parseScene } from './scene'
import { BgsetTable, Manifest, SprsetTable } from './types'

const manifest = Manifest.parse(manifestJson)
const voiceIndex = buildVoiceIndex(manifest)

describe('resolveVoice — manifest 照合', () => {
  it('大小文字が不確実でも manifest の実ファイル名へ解決（末尾 A は大文字維持）', () => {
    // ID は全大文字。実体は char/route 小文字＋末尾変種文字 A 大文字。
    expect(resolveVoice(voiceIndex, 'AYAN_002_AYAN001A_001')).toEqual({
      id: 'AYAN_002_AYAN001A_001',
      file: 'voice/ayan_002_ayan001A_001.ogg',
    })
  })

  it('単純 toLowerCase では作れない綴り（…001a）でも一致する', () => {
    // 仮に小文字化規則を素朴に適用すると ayan_002_ayan001a_001（末尾 a）。
    // それでも index は小文字キーで引くため、正しい実体名を返す。
    expect(resolveVoice(voiceIndex, 'AYAN_002_AYAN001A_003').file).toBe(
      'voice/ayan_002_ayan001A_003.ogg',
    )
  })

  it('manifest 未収録は file=null', () => {
    expect(resolveVoice(voiceIndex, 'ZZZZ_999_NONE001A_001').file).toBeNull()
  })
})

describe('resolveScene — 002_AYAN001A 全 beat 解決（受入）', () => {
  const sprset = SprsetTable.parse(spritesJson)
  const bgset = BgsetTable.parse(bgJson)
  const scene = resolveScene(parseScene(fixture, { code: '002_AYAN001A', locale: 'jp' }), {
    sprset,
    bgset,
    voiceIndex,
  })

  it('bg.file / sprite.body / sprite.face が全 beat で非 null', () => {
    for (const beat of scene.beats) {
      if (beat.bg) expect(beat.bg.file, `bg ${beat.bg.label}`).not.toBeNull()
      if (beat.sprite) {
        expect(beat.sprite.body, `body ${beat.sprite.label}`).not.toBeNull()
        expect(beat.sprite.face, `face ${beat.sprite.label}`).not.toBeNull()
      }
    }
  })

  it('line beat の voice.file が全て非 null', () => {
    const voiced = scene.beats.filter((b) => b.kind === 'line' && b.voice)
    expect(voiced.length).toBe(3)
    for (const beat of voiced) {
      if (beat.kind === 'line' && beat.voice) expect(beat.voice.file, beat.voice.id).not.toBeNull()
    }
  })

  it('具体値: 喫茶店（夕）と綾菜立ち絵・ボイスが正しく解決', () => {
    const b = scene.beats[1] // 最初の綾菜セリフ
    expect(b.bg).toEqual({ label: '#背景・喫茶店（夕）', file: 'BG20_02_00' })
    expect(b.sprite?.body).toBe('CH01B_01_02_003_02') // 私服０２
    expect(b.sprite?.face).toBe('CH01B_01_02_102_01') // にっこり１
    expect(b.sprite?.offset).toEqual([426, 73])
    if (b.kind === 'line')
      expect(b.voice).toEqual({
        id: 'AYAN_002_AYAN001A_001',
        file: 'voice/ayan_002_ayan001A_001.ogg',
      })
  })
})
