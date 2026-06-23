import { describe, it, expect } from 'vitest'
// フィクスチャ = 実データ data_extract/text/md_scr_text_jp/002_AYAN001A.txt（Vite ?raw で文字列取込）
import fixture from '../../../../data_extract/text/md_scr_text_jp/002_AYAN001A.txt?raw'
import { parseScene } from './scene'
import { Scene } from './types'

const scene = parseScene(fixture, { code: '002_AYAN001A', locale: 'jp' })

// 各 beat を「構造ゴールデン」に射影（kind / 話者 / voice / bg・sprite label / 行数）。
const skeleton = scene.beats.map((b) => ({
  kind: b.kind,
  who: b.kind === 'line' ? b.who : undefined,
  voice: b.kind === 'line' ? (b.voice?.id ?? null) : undefined,
  bg: b.bg?.label ?? null,
  sprite: b.sprite?.label ?? null,
  nLines: b.lines.length,
}))

const BG = '#背景・喫茶店（夕）'
const SP1 = '#綾菜（中）・通常１（夕）・私服０２・にっこり１'
const SP2 = '#綾菜（中）・通常１（夕）・私服０２・通常１'
const SP3 = '#綾菜（中）・通常１（夕）・私服０２・にっこり２'

describe('parseScene — 002_AYAN001A (golden)', () => {
  it('スキーマ適合・メタ情報', () => {
    expect(() => Scene.parse(scene)).not.toThrow()
    expect(scene.code).toBe('002_AYAN001A')
    expect(scene.route).toBe('002')
    expect(scene.locale).toBe('jp')
    expect(scene.title).toBe('古橋綾菜\\N喫茶店へ')
  })

  it('beats 構造ゴールデン（narration / line・話者・voice・bg/sprite label）', () => {
    expect(skeleton).toEqual([
      // 冒頭 narration（黒画面・注記前なので bg/sprite 無し）
      { kind: 'narration', who: undefined, voice: undefined, bg: null, sprite: null, nLines: 4 },
      // 綾菜（明示話者＋voice）
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_001',
        bg: BG,
        sprite: SP1,
        nLines: 1,
      },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprite: SP1, nLines: 4 },
      // 綾菜（話者欠落 → voice 接頭辞 AYAN から継承）。セリフは 2 行に跨る
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_002',
        bg: BG,
        sprite: SP2,
        nLines: 2,
      },
      // 和樹（明示話者・voice 無し）
      { kind: 'line', who: '古橋　和樹', voice: null, bg: BG, sprite: SP2, nLines: 1 },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprite: SP2, nLines: 2 },
      // 綾菜（話者欠落だが voice=AYAN → 綾菜。直前話者の和樹に引きずられない）
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_003',
        bg: BG,
        sprite: SP3,
        nLines: 1,
      },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprite: SP3, nLines: 2 },
    ])
  })

  it('本文（行内容）が正しく集約される', () => {
    expect(scene.beats[0].lines).toEqual([
      '……帰宅する途中、僕は綾姉が働く喫茶店に',
      '向かうことにした。',
      'あの郡山という男についての、姉さんの真意が',
      '知りたかったからだ。',
    ])
    expect(scene.beats[1].lines).toEqual(['「あら、お帰りなさい。和くん」'])
    // 「」が 2 行に跨るセリフ
    expect(scene.beats[3].lines).toEqual([
      '「もう時間だから、閉めるところだけど、なにか',
      '飲み物でも淹れる？」',
    ])
  })

  it('各 beat に bg/sprite/voice の label が付与される（受入条件）', () => {
    const line = scene.beats[1]
    expect(line.kind).toBe('line')
    if (line.kind !== 'line') return
    expect(line.bg).toEqual({ label: BG, file: null })
    expect(line.sprite).toEqual({ label: SP1, body: null, face: null })
    expect(line.voice).toEqual({ id: 'AYAN_002_AYAN001A_001', file: null })
  })

  it('完全スナップショット', () => {
    expect(scene).toMatchSnapshot()
  })
})
