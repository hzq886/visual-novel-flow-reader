import { describe, it, expect } from 'vitest'
// 実データ（生成済み解決テーブル＋manifest）と 002 フィクスチャで統合的に検証。
import bgJson from '@data/backgrounds.json'
import manifestJson from '@data/manifest.json'
import spritesJson from '@data/sprites.json'
import jpEventsRaw from '@data/scene-events/jp.json'
import { buildVoiceIndex, resolveScene, resolveVoice, sceneAssetRefs } from './resolve'
import { buildBgmIndex, buildSeIndex } from './audio'
import { buildScene } from './scene'
import { BgsetTable, Manifest, SceneEventsBundle, SprsetTable, type SceneEvent } from './types'

const manifest = Manifest.parse(manifestJson)
const voiceIndex = buildVoiceIndex(manifest)
const seIndex = buildSeIndex(manifest)
const bgmIndex = buildBgmIndex(manifest)

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

  it('背景ボイス（BGV_*）も同じ索引で解決される（HU-37）', () => {
    // 実体は voice/BGV_ayan_f001a.ogg（BGV 接頭辞は大文字維持・残りは小文字）。
    expect(resolveVoice(voiceIndex, 'BGV_AYAN_F001A')).toEqual({
      id: 'BGV_AYAN_F001A',
      file: 'voice/BGV_ayan_f001a.ogg',
    })
  })
})

describe('resolveScene — 002_AYAN001A 全 beat 解決（受入）', () => {
  const sprset = SprsetTable.parse(spritesJson)
  const bgset = BgsetTable.parse(bgJson)
  const jp002 = SceneEventsBundle.parse(jpEventsRaw)['002_AYAN001A']
  const built = buildScene(
    { title: jp002.title, events: jp002.events as SceneEvent[] },
    { code: '002_AYAN001A', locale: 'jp' },
  )
  const scene = resolveScene(built, { sprset, bgset, voiceIndex, seIndex, bgmIndex })

  it('bg.file / sprite.body / sprite.face が全 beat・全スロットで非 null', () => {
    for (const beat of scene.beats) {
      if (beat.bg) expect(beat.bg.file, `bg ${beat.bg.label}`).not.toBeNull()
      for (const sp of beat.sprites ?? []) {
        expect(sp.body, `body ${sp.label}`).not.toBeNull()
        expect(sp.face, `face ${sp.label}`).not.toBeNull()
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
    expect(b.sprites?.[0]?.body).toBe('CH01B_01_02_003_02') // 私服０２
    expect(b.sprites?.[0]?.face).toBe('CH01B_01_02_102_01') // にっこり１
    expect(b.sprites?.[0]?.offset).toEqual([426, 73])
    if (b.kind === 'line')
      expect(b.voice).toEqual({
        id: 'AYAN_002_AYAN001A_001',
        file: 'voice/ayan_002_ayan001A_001.ogg',
      })
  })

  it('se が実ファイルへ解決され、scene.bgm がルート（ayan→M02）から付与される', () => {
    // 冒頭 narration の効果音 0001D → se/0001d.ogg（大小文字無視）。
    expect(scene.beats[0].se).toEqual([{ code: '0001D', file: 'se/0001d.ogg' }])
    // 002 は綾菜ルート → M02。
    expect(scene.bgm).toEqual({ track: 'M02', file: 'bgm/M02.ogg' })
    // 全 se 参照が解決済（参照不整合 0）。
    for (const beat of scene.beats)
      for (const s of beat.se ?? []) expect(s.file, s.code).not.toBeNull()
  })

  it('sceneAssetRefs が参照素材コードを重複なく収集（fetch-assets 用）', () => {
    const refs = sceneAssetRefs(scene)
    // BG_BLACK = 冒頭 [id] BG_BLACK（HU-35）、BG20_02_00 = 喫茶店（夕）。
    expect(refs.cg).toEqual(['BG_BLACK', 'BG20_02_00'])
    expect(refs.sprite.sort()).toEqual([
      'CH01B_01_02_003_02', // 私服０２（body・全 beat 共通）
      'CH01B_01_02_101_01', // 通常１
      'CH01B_01_02_102_01', // にっこり１
      'CH01B_01_02_102_02', // にっこり２
    ])
    expect(refs.voice).toEqual([
      'AYAN_002_AYAN001A_001',
      'AYAN_002_AYAN001A_002',
      'AYAN_002_AYAN001A_003',
    ])
  })
})
