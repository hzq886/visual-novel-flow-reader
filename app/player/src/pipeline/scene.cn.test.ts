import { describe, it, expect } from 'vitest'
import { buildScene } from './scene'
import { resolveBg, resolveSprite } from './defs'
import { BgsetTable, Scene, SceneEventsBundle, SprsetTable, type SceneEvent } from './types'
import sprsetJson from '@data/sprites.json'
import bgsetJson from '@data/backgrounds.json'
import cnEventsRaw from '@data/scene-events/cn.json'
import jpEventsRaw from '@data/scene-events/jp.json'

const sprset = SprsetTable.parse(sprsetJson)
const bgset = BgsetTable.parse(bgsetJson)
const cn = SceneEventsBundle.parse(cnEventsRaw)
const jp = SceneEventsBundle.parse(jpEventsRaw)

// cn ロケール回帰（HU-29 / HU-74）: cn は bytecode で本文・話者・タイトルのみ中国語、bg/sprite の
// note ラベルは日本語のまま（Shift-JIS 格納）。build 結果の構造メタ（bg/sprite ラベル）は jp と一致し、
// 本文だけ翻訳になることを担保する。これが崩れると cn の bg/sprite/voice 解決が破綻する。
const buildCn = (code: string) =>
  buildScene(
    { title: cn[code].title, events: cn[code].events as SceneEvent[] },
    { code, locale: 'cn' },
  )
const hasText = (code: string) => cn[code].events.some((e) => e[0] === 'text')

describe('buildScene — cn ロケール（bytecode 一次・言語別復号）', () => {
  it('単一シーン 002_AYAN001A: 構造は jp と同形・本文は中国語', () => {
    const s = buildCn('002_AYAN001A')
    expect(() => Scene.parse(s)).not.toThrow()
    expect(s.locale).toBe('cn')
    expect(s.title).toContain('绫菜') // 中国語タイトル
    // bg/sprite ラベルは日本語のまま（jp 定義で解決）。
    expect(s.beats.find((b) => b.bg?.label === '#背景・喫茶店（夕）')).toBeDefined()
    // 台詞 beat の voice ID は jp と同一（音声共用）。
    const line = s.beats.find((b) => b.kind === 'line' && b.voice)
    expect(line && line.kind === 'line' ? line.voice?.id : null).toBe('AYAN_002_AYAN001A_001')
    // 話者名・本文は中国語。
    expect(line && line.kind === 'line' ? line.who : '').toContain('绫菜')
  })

  it('全 cn 内容シーンが build でき、スキーマ適合・beats>0', () => {
    const failures: string[] = []
    let content = 0
    for (const code of Object.keys(cn).sort()) {
      if (!hasText(code)) continue
      content++
      try {
        const s = buildCn(code)
        Scene.parse(s)
        if (s.beats.length === 0) failures.push(`${code}: text ありなのに beats 空`)
      } catch (e) {
        failures.push(`${code}: ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
    expect(content).toBe(286) // cn 内容シーン数（jp と一致）
  })

  it('cn の bg/sprite 構造は jp と一致（text/speaker 以外のイベントが言語非依存）', () => {
    // bytecode 抽出時に jp/cn 構造一致は検証済（extract-scenes）。build 後の bg/sprite ラベル列でも確認。
    const mism: string[] = []
    for (const code of Object.keys(cn).sort()) {
      if (!(code in jp)) continue
      const labels = (b: SceneEvent[]) =>
        b.filter((e) => e[0] === 'bg' || e[0] === 'sprite').map((e) => JSON.stringify(e))
      const j = labels(jp[code].events as SceneEvent[])
      const c = labels(cn[code].events as SceneEvent[])
      if (JSON.stringify(j) !== JSON.stringify(c)) mism.push(code)
    }
    expect(mism).toEqual([])
  })

  it('cn の全 bg/sprite ラベルが jp 定義テーブルで解決する', () => {
    const unresolvedBg: string[] = []
    const unresolvedSprite: string[] = []
    for (const code of Object.keys(cn).sort()) {
      if (!hasText(code)) continue
      for (const b of buildCn(code).beats) {
        if (b.bg && resolveBg(bgset, b.bg.label).file === null)
          unresolvedBg.push(`${code}: ${b.bg.label}`)
        for (const sp of b.sprites ?? []) {
          if (resolveSprite(sprset, sp.label).body === null)
            unresolvedSprite.push(`${code}: ${sp.label}`)
        }
      }
    }
    expect(unresolvedBg).toEqual([])
    expect(unresolvedSprite).toEqual([])
  })
})
