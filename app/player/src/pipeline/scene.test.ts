import { describe, it, expect } from 'vitest'
import { buildScene } from './scene'
import { Scene, SceneEventsBundle, type SceneEvent } from './types'
// golden = 実データ（extract-scenes.py 生成の committed イベント列）から 002_AYAN001A を build。
import jpEventsRaw from '@data/scene-events/jp.json'

const jpEvents = SceneEventsBundle.parse(jpEventsRaw)

// テスト用ショートハンド: イベント列 → Scene（既定 code/locale）。
const build = (
  events: SceneEvent[],
  opts: { title?: string; code?: string; locale?: 'jp' | 'cn' } = {},
) =>
  buildScene(
    { title: opts.title, events },
    { code: opts.code ?? '999_TEST001A', locale: opts.locale ?? 'jp' },
  )

const proj = (s: Scene) =>
  s.beats.map((b) => ({
    kind: b.kind,
    bg: b.bg?.label ?? null,
    sprite: b.sprite?.label ?? null,
    item: b.item?.code ?? null,
  }))

describe('buildScene — 002_AYAN001A (golden・実データ)', () => {
  const entry = jpEvents['002_AYAN001A']
  const scene = buildScene(
    { title: entry.title, events: entry.events as SceneEvent[] },
    { code: '002_AYAN001A', locale: 'jp' },
  )

  it('スキーマ適合・メタ情報', () => {
    expect(() => Scene.parse(scene)).not.toThrow()
    expect(scene.code).toBe('002_AYAN001A')
    expect(scene.route).toBe('002')
    expect(scene.locale).toBe('jp')
    expect(scene.title).toBe('古橋綾菜\\N喫茶店へ')
  })

  it('beats 構造ゴールデン（narration / line・話者・voice・bg/sprite label）', () => {
    const BG = '#背景・喫茶店（夕）'
    const SP1 = '#綾菜（中）・通常１（夕）・私服０２・にっこり１'
    const SP2 = '#綾菜（中）・通常１（夕）・私服０２・通常１'
    const SP3 = '#綾菜（中）・通常１（夕）・私服０２・にっこり２'
    const skeleton = scene.beats.map((b) => ({
      kind: b.kind,
      who: b.kind === 'line' ? b.who : undefined,
      voice: b.kind === 'line' ? (b.voice?.id ?? null) : undefined,
      bg: b.bg?.label ?? null,
      sprite: b.sprite?.label ?? null,
      nLines: b.lines.length,
    }))
    expect(skeleton).toEqual([
      {
        kind: 'narration',
        who: undefined,
        voice: undefined,
        bg: '#背景・黒一色',
        sprite: null,
        nLines: 4,
      },
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_001',
        bg: BG,
        sprite: SP1,
        nLines: 1,
      },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprite: SP1, nLines: 4 },
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_002',
        bg: BG,
        sprite: SP2,
        nLines: 2,
      },
      { kind: 'line', who: '古橋　和樹', voice: null, bg: BG, sprite: SP2, nLines: 1 },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprite: SP2, nLines: 2 },
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

  it('冒頭 narration に se（0001D）が載る（beat 先頭で 1 回）', () => {
    expect(scene.beats[0].se).toEqual([{ code: '0001D', file: null }])
  })

  it('完全スナップショット', () => {
    expect(scene).toMatchSnapshot()
  })
})

describe('buildScene — 本文の集約（narration / セリフ）', () => {
  it('連続する text はひとつの narration beat に集約される', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['text', '地の文Ａ。'],
      ['text', '地の文Ｂ。'],
    ])
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].kind).toBe('narration')
    expect(s.beats[0].lines).toEqual(['地の文Ａ。', '地の文Ｂ。'])
  })

  it('「」が複数行に跨るセリフを 1 line beat に集約する', () => {
    const s = build([
      ['speaker', '古橋　綾菜'],
      ['voice', 'AYAN_002_AYAN001A_002'],
      ['text', '「もう時間だから、閉めるところだけど、なにか'],
      ['text', '飲み物でも淹れる？」'],
    ])
    expect(s.beats).toHaveLength(1)
    const b = s.beats[0]
    expect(b.kind).toBe('line')
    if (b.kind !== 'line') return
    expect(b.who).toBe('古橋　綾菜')
    expect(b.voice?.id).toBe('AYAN_002_AYAN001A_002')
    expect(b.lines).toEqual([
      '「もう時間だから、閉めるところだけど、なにか',
      '飲み物でも淹れる？」',
    ])
  })
})

describe('buildScene — 話者の解決（0x0d 一次・HU-67 フォールバック）', () => {
  it('speaker イベントを話者に採用する（主人公含む）', () => {
    const s = build([
      ['speaker', '古橋　和樹'],
      ['text', '「片付けを手伝うよ」'],
    ])
    expect(s.beats[0].kind === 'line' && s.beats[0].who).toBe('古橋　和樹')
  })

  it('speaker 無し・有声は接頭辞学習/直前話者へフォールバック（HU-67）', () => {
    const s = build([
      ['speaker', '古橋　綾菜'],
      ['voice', 'AYAN_002_AYAN001A_001'],
      ['text', '「おかえり」'], // ここで AYAN→綾菜 を学習
      ['voice', 'AYAN_002_AYAN001A_009'],
      ['text', '「ただいま」'], // speaker 無しだが AYAN 接頭辞→綾菜
    ])
    expect(s.beats.map((b) => (b.kind === 'line' ? b.who : null))).toEqual([
      '古橋　綾菜',
      '古橋　綾菜',
    ])
  })

  it('speaker 無し・無声・無記名は主人公（未収録 KAZU）', () => {
    const s = build([['text', '「……そうだね」']])
    expect(s.beats[0].kind === 'line' && s.beats[0].who).toBe('古橋　和樹')
    const cn = build([['text', '「……嗯」']], { locale: 'cn' })
    expect(cn.beats[0].kind === 'line' && cn.beats[0].who).toBe('古桥和树')
  })
})

describe('buildScene — 被せ CG レイヤモデル（EV/黒。HU-63）', () => {
  it('EV 表示中は sprite を出さない（下レイヤの立ち絵は隠れる）', () => {
    const s = build([
      ['bg', '#背景・教室（夕）'],
      ['sprite', ['#翼・催眠１']],
      ['text', '立ち絵ありの地の文。'],
      ['bg', '#EV011・横向き'],
      ['text', 'イベントCGの地の文。'],
    ])
    expect(proj(s).map((p) => ({ bg: p.bg, sprite: p.sprite }))).toEqual([
      { bg: '#背景・教室（夕）', sprite: '#翼・催眠１' },
      { bg: '#EV011・横向き', sprite: null },
    ])
  })

  it('EV → #背景 復帰で下レイヤの立ち絵 sticky が再表示される', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', 'Ａ。'],
      ['bg', '#EV002・回想'],
      ['text', 'Ｂ。'],
      ['bg', '#背景・部屋'],
      ['text', 'Ｃ。'],
    ])
    expect(s.beats.map((b) => b.sprite?.label ?? null)).toEqual([
      '#綾菜・通常',
      null,
      '#綾菜・通常',
    ])
  })

  it('黒一色（BG_BLACK / #背景・黒一色）は被せ扱い＝立ち絵を隠す', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', 'Ａ。'],
      ['bg', 'BG_BLACK'],
      ['text', 'Ｂ。'],
      ['bg', '#背景・部屋'],
      ['text', 'Ｃ。'],
    ])
    expect(proj(s).map((p) => ({ bg: p.bg, sprite: p.sprite }))).toEqual([
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
      { bg: '#背景・黒一色', sprite: null },
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
    ])
  })

  it('BG_BLACK の再出現がそれぞれ beat になる（txt デデュープで失われていた再暗転・HU-71）', () => {
    const s = build([
      ['bg', '#背景・A'],
      ['text', 'Ａ。'],
      ['bg', 'BG_BLACK'],
      ['text', '暗転1。'],
      ['bg', '#背景・B'],
      ['text', 'Ｂ。'],
      ['bg', 'BG_BLACK'],
      ['text', '暗転2。'],
    ])
    const blk = s.beats.filter((b) => b.bg?.label === '#背景・黒一色').length
    expect(blk).toBe(2)
  })
})

describe('buildScene — 立ち絵（sprite スロット / off）', () => {
  it('地の文途中の立ち絵変更で beat を分割', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', 'Ａ。'],
      ['sprite', ['#綾菜・笑顔']],
      ['text', 'Ｂ。'],
    ])
    expect(s.beats.map((b) => ({ sprite: b.sprite?.label ?? null, n: b.lines.length }))).toEqual([
      { sprite: '#綾菜・通常', n: 1 },
      { sprite: '#綾菜・笑顔', n: 1 },
    ])
  })

  it('多体スロットは実ラベル（最後）を単一 sprite へ投影・"-"/null は空き/変更なし', () => {
    const s = build([
      ['sprite', ['#綾菜・通常', '#涼菜・通常']], // 2体 → 最後(涼菜)を採用
      ['text', 'Ａ。'],
      ['sprite', [null, '#涼菜・驚き']], // slot0 変更なし → 涼菜・驚き
      ['text', 'Ｂ。'],
      ['sprite', ['-', '-']], // 全スロット空き → クリア
      ['text', 'Ｃ。'],
    ])
    expect(s.beats.map((b) => b.sprite?.label ?? null)).toEqual([
      '#涼菜・通常',
      '#涼菜・驚き',
      null,
    ])
  })

  it('off で立ち絵を消す（bg には触れない）', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', 'Ａ。'],
      ['off'],
      ['text', 'Ｂ。'],
    ])
    expect(s.beats.map((b) => ({ bg: b.bg?.label, sprite: b.sprite?.label ?? null }))).toEqual([
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
      { bg: '#背景・部屋', sprite: null },
    ])
  })
})

describe('buildScene — アイテムCG窓（独立オーバーレイ・HU-70）', () => {
  it('item〜itemclose の間だけ item が載り、下層 bg/立ち絵は保持', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', '直前の地の文。'],
      ['item', 'ITEM_03_01', 700, 120],
      ['text', 'アイテム説明1。'],
      ['sprite', ['#綾菜・驚き']], // 窓表示中の立ち絵差分（窓は閉じない）
      ['text', 'アイテム説明2。'],
      ['itemclose'],
      ['text', '窓が閉じた後。'],
    ])
    expect(proj(s)).toEqual([
      { kind: 'narration', bg: '#背景・部屋', sprite: '#綾菜・通常', item: null },
      { kind: 'narration', bg: '#背景・部屋', sprite: '#綾菜・通常', item: 'ITEM_03_01' },
      { kind: 'narration', bg: '#背景・部屋', sprite: '#綾菜・驚き', item: 'ITEM_03_01' },
      { kind: 'narration', bg: '#背景・部屋', sprite: '#綾菜・驚き', item: null },
    ])
    expect(s.beats[1].item).toEqual({ code: 'ITEM_03_01', file: null, x: 700, y: 120 })
  })
})

describe('buildScene — 背景ボイス bgv（sticky ループ・HU-37）', () => {
  it('BGV 開始以降の beat に載り、次 BGV で切替', () => {
    const s = build([
      ['bg', '#EV001・通常'],
      ['text', '開始前。'],
      ['bgv', 'BGV_AYAN_H001A'],
      ['text', '喘ぎ開始。'],
      ['text', '続く。'],
      ['bgv', 'BGV_AYAN_H002A'],
      ['text', '強くなる。'],
    ])
    expect(s.beats.map((b) => ({ bgv: b.bgv?.id ?? null, n: b.lines.length }))).toEqual([
      { bgv: null, n: 1 },
      { bgv: 'BGV_AYAN_H001A', n: 2 },
      { bgv: 'BGV_AYAN_H002A', n: 1 },
    ])
  })

  it('同一 BGV の重複指定では分割しない（no-op）', () => {
    const s = build([
      ['bgv', 'BGV_SUZU_H001A'],
      ['text', 'Ａ。'],
      ['bgv', 'BGV_SUZU_H001A'],
      ['text', 'Ｂ。'],
    ])
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].bgv).toEqual({ id: 'BGV_SUZU_H001A', file: null })
  })
})

describe('buildScene — 画面フラッシュ flash（HU-38）', () => {
  it('flash は直後の beat（インパクト行）に強度を付与する', () => {
    const s = build([
      ['speaker', '古橋　和樹'],
      ['text', '「１つ、２つ、３つ！」'],
      ['flash', 1],
      ['text', 'パンッ！！'],
    ])
    expect(s.beats.map((b) => ({ kind: b.kind, flash: b.flash ?? null }))).toEqual([
      { kind: 'line', flash: null },
      { kind: 'narration', flash: 1 },
    ])
  })
})

describe('buildScene — se の beat 割当', () => {
  it('生成前の se は最初の beat へ持ち越し、beat 中の se は同 beat へ', () => {
    const s = build([
      ['se', '0001a'], // beat 生成前 → 最初の beat へ
      ['text', '地の文です。'],
      ['speaker', '話者'],
      ['se', '8201B'], // speaker で flush 済 → 次のセリフ beat へ
      ['text', '「セリフだよ」'],
      ['se', '9001A'], // セリフ beat が active → 同 beat へ
      ['text', '続く地の文。'],
    ])
    expect(s.beats[0].se).toEqual([{ code: '0001a', file: null }])
    expect(s.beats[1].se).toEqual([
      { code: '8201B', file: null },
      { code: '9001A', file: null },
    ])
    expect(s.beats[2].se).toBeUndefined()
  })
})

describe('buildScene — タイトル / セクションカード', () => {
  it('title はバンドル値をそのまま採用（\\N 生形式を維持）', () => {
    const s = build([['text', '本編。']], { title: '幼少回想\\N三人' })
    expect(s.title).toBe('幼少回想\\N三人')
  })

  it('中盤の \\N text はセクションカード＝narration 行として流す（描画側が判定）', () => {
    const s = build([
      ['text', '前夜の地の文。'],
      ['text', '朝の風景\\N年頃の男子の性欲'], // 0x2c 由来のセクションカード
      ['text', '朝の地の文。'],
    ])
    // \N 行も narration に含まれる（Stage の isSectionCard が描画時に判定）
    const allLines = s.beats.flatMap((b) => b.lines)
    expect(allLines).toContain('朝の風景\\N年頃の男子の性欲')
  })
})
