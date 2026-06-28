import { describe, it, expect } from 'vitest'
import { parseScene } from './scene'
import { resolveBg, resolveSprite } from './defs'
import { BgsetTable, Scene, SprsetTable } from './types'
import sprsetJson from '@data/sprites.json'
import bgsetJson from '@data/backgrounds.json'

const sprset = SprsetTable.parse(sprsetJson)
const bgset = BgsetTable.parse(bgsetJson)

// cn ロケール回帰（HU-29）: 中国語版ソースは別タグ語彙（[cn]=本文 / [ascii]=id / [jp]=note）を使う。
// parseScene のタグ正規化で jp と同じ状態機械に載り、**構造メタ（kind/voice/bg/sprite ラベル）は
// jp と一致**（cn の note は日本語ラベルのまま＝jp 定義で解決可能）、**本文（who/lines）だけが翻訳**に
// なることを担保する。これが崩れると cn の bg/sprite/voice 解決が破綻する。
const cnRaws = import.meta.glob('../../../../data_extract/text/md_scr_text_cn/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const codeOf = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.txt$/, '')
const cn = new Map(
  Object.entries(cnRaws)
    .map(([p, raw]) => [codeOf(p), raw] as const)
    .filter(([code]) => /^[0-9]/.test(code)),
)
const hasText = (raw: string) => /\[(text|cn)\]/.test(raw)

describe('parseScene — cn ロケール（別タグ語彙の正規化）', () => {
  it('単一シーン 002_AYAN001A: 構造は jp と同形・本文は中国語', () => {
    const s = parseScene(cn.get('002_AYAN001A')!, { code: '002_AYAN001A', locale: 'cn' })
    expect(() => Scene.parse(s)).not.toThrow()
    expect(s.locale).toBe('cn')
    expect(s.title).toContain('绫菜') // 中国語タイトル（古桥绫菜\N去咖啡馆）
    // note は日本語のまま → 背景/立ち絵ラベルが jp と一致する（冒頭 beat は [id] BG_BLACK＝
    // #背景・黒一色 になるため、喫茶店の bg を持つ beat を明示的に探す）。
    const cafeBg = s.beats.find((b) => b.bg?.label === '#背景・喫茶店（夕）')
    expect(cafeBg).toBeDefined()
    // 台詞 beat の voice ID は jp と同一（音声は共用）。
    const line = s.beats.find((b) => b.kind === 'line' && b.voice)
    expect(line && line.kind === 'line' ? line.voice?.id : null).toBe('AYAN_002_AYAN001A_001')
    // 話者名・本文は中国語。
    expect(line && line.kind === 'line' ? line.who : '').toContain('绫菜')
  })

  it('全 cn コンテンツシーンが parse でき、スキーマ適合・beats>0', () => {
    const failures: string[] = []
    let content = 0
    for (const [code, raw] of cn) {
      if (!hasText(raw)) continue
      content++
      try {
        const s = parseScene(raw, { code, locale: 'cn' })
        Scene.parse(s)
        if (s.beats.length === 0) failures.push(`${code}: [cn] があるのに beats 空`)
      } catch (e) {
        failures.push(`${code}: ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
    // cn コンテンツシーン数（コーパス変化時に更新）。jp=288 に対し cn=287（002_AYAN004AB は cn 本文なし）。
    expect(content).toBe(287)
  })

  // cn の note（[jp] タグ）は日本語ラベルのまま＝jp 定義（backgrounds/sprites.json）で解決される。
  // 個々の beat 位置は翻訳の行マージで jp とずれ得る（位置維持はベストエフォート）が、cn が産む
  // bg/sprite ラベルは **必ず jp 定義テーブルで解決**できなければならない。これが cn 解決の本質的
  // 健全性条件（崩れると cn だけ bg/sprite が未解決になる）。CI は validate を走らせないため、この
  // 単体テストが cn 解決可能性の回帰ガードになる。
  // （voice はロケール非依存＝jp/cn 共用 manifest で解決。解決率は validate:cn で担保。cn は jp と
  //  beat 分割が異なるため voice 割当 beat の集合は一致しない＝ここでは検査しない。）
  it('cn の全 bg/sprite ラベルが jp 定義テーブルで解決する', () => {
    const unresolvedBg: string[] = []
    const unresolvedSprite: string[] = []
    for (const [code, raw] of cn) {
      if (!hasText(raw)) continue
      for (const b of parseScene(raw, { code, locale: 'cn' }).beats) {
        if (b.bg && resolveBg(bgset, b.bg.label).file === null)
          unresolvedBg.push(`${code}: ${b.bg.label}`)
        if (b.sprite && resolveSprite(sprset, b.sprite.label).body === null)
          unresolvedSprite.push(`${code}: ${b.sprite.label}`)
      }
    }
    expect(unresolvedBg).toEqual([])
    expect(unresolvedSprite).toEqual([])
  })
})
