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

// 立ち絵スロット列 → ラベル配列（占有スロットのみ・左→右）。空なら null。
const spLabels = (b: Scene['beats'][number]): string[] | null =>
  b.sprites?.map((sp) => sp.label) ?? null

const proj = (s: Scene) =>
  s.beats.map((b) => ({
    kind: b.kind,
    bg: b.bg?.label ?? null,
    sprites: spLabels(b),
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
    // size = 送り段数（narration はページ数・HU-78 / line は発話行数）。
    const skeleton = scene.beats.map((b) => ({
      kind: b.kind,
      who: b.kind === 'line' ? b.who : undefined,
      voice: b.kind === 'line' ? (b.voice?.id ?? null) : undefined,
      bg: b.bg?.label ?? null,
      sprites: spLabels(b),
      size: b.kind === 'narration' ? b.pages.length : b.lines.length,
    }))
    expect(skeleton).toEqual([
      {
        kind: 'narration',
        who: undefined,
        voice: undefined,
        bg: '#背景・黒一色',
        sprites: null,
        size: 2, // 4 行 → 2 ページ（2+2）
      },
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_001',
        bg: BG,
        sprites: [SP1],
        size: 1,
      },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprites: [SP1], size: 2 },
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_002',
        bg: BG,
        sprites: [SP2],
        size: 2,
      },
      { kind: 'line', who: '古橋　和樹', voice: null, bg: BG, sprites: [SP2], size: 1 },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprites: [SP2], size: 1 },
      {
        kind: 'line',
        who: '古橋　綾菜',
        voice: 'AYAN_002_AYAN001A_003',
        bg: BG,
        sprites: [SP3],
        size: 1,
      },
      { kind: 'narration', who: undefined, voice: undefined, bg: BG, sprites: [SP3], size: 2 },
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
  it('連続する text は 1 narration beat・page 無しなら 1 ページに集約', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['text', '地の文Ａ。'],
      ['text', '地の文Ｂ。'],
    ])
    expect(s.beats).toHaveLength(1)
    const b = s.beats[0]
    expect(b.kind).toBe('narration')
    if (b.kind !== 'narration') return
    expect(b.pages).toEqual([['地の文Ａ。', '地の文Ｂ。']])
  })

  it('page（0x04）で narration を複数ページへ分割する（1 beat のまま・HU-78）', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['text', 'Ａ１。'],
      ['text', 'Ａ２。'],
      ['page'],
      ['text', 'Ｂ１。'],
      ['page'], // 末尾の空ページは詰められる
    ])
    expect(s.beats).toHaveLength(1)
    const b = s.beats[0]
    expect(b.kind).toBe('narration')
    if (b.kind !== 'narration') return
    expect(b.pages).toEqual([['Ａ１。', 'Ａ２。'], ['Ｂ１。']])
  })

  it('page はセリフ（line）beat を分割しない（1 発話まるごと表示）', () => {
    const s = build([
      ['speaker', '古橋　綾菜'],
      ['text', '「なにか'],
      ['page'], // セリフ途中の改ページは無視
      ['text', '飲み物でも淹れる？」'],
    ])
    expect(s.beats).toHaveLength(1)
    const b = s.beats[0]
    expect(b.kind).toBe('line')
    if (b.kind !== 'line') return
    expect(b.lines).toEqual(['「なにか', '飲み物でも淹れる？」'])
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
    expect(proj(s).map((p) => ({ bg: p.bg, sprites: p.sprites }))).toEqual([
      { bg: '#背景・教室（夕）', sprites: ['#翼・催眠１'] },
      { bg: '#EV011・横向き', sprites: null },
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
    expect(s.beats.map((b) => spLabels(b))).toEqual([['#綾菜・通常'], null, ['#綾菜・通常']])
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
    expect(proj(s).map((p) => ({ bg: p.bg, sprites: p.sprites }))).toEqual([
      { bg: '#背景・部屋', sprites: ['#綾菜・通常'] },
      { bg: '#背景・黒一色', sprites: null },
      { bg: '#背景・部屋', sprites: ['#綾菜・通常'] },
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

describe('buildScene — 立ち絵（多体スロット / per-slot sticky / reset / off・HU-77）', () => {
  it('地の文途中の立ち絵変更で beat を分割', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常']],
      ['text', 'Ａ。'],
      ['sprite', ['#綾菜・笑顔']],
      ['text', 'Ｂ。'],
    ])
    expect(
      s.beats.map((b) => ({
        sprites: spLabels(b),
        n: b.kind === 'narration' ? b.pages.length : b.lines.length,
      })),
    ).toEqual([
      { sprites: ['#綾菜・通常'], n: 1 },
      { sprites: ['#綾菜・笑顔'], n: 1 },
    ])
  })

  it('多体スロットを同時保持・null=変更なし / "-"=当該スロットのみクリア（per-slot sticky）', () => {
    const s = build([
      ['sprite', ['#綾菜・通常', '#涼菜・通常']], // slot0=綾菜, slot1=涼菜（2体並び）
      ['text', 'Ａ。'],
      ['sprite', [null, '#涼菜・驚き']], // slot0 変更なし → [綾菜, 涼菜・驚き]
      ['text', 'Ｂ。'],
      ['sprite', ['-', null]], // slot0 のみクリア → [涼菜・驚き]（slot1 保持）
      ['text', 'Ｃ。'],
      ['sprite', ['#楓・通常']], // slot0 のみ差替（slot1 は addressed 外＝保持） → [楓, 涼菜・驚き]
      ['text', 'Ｄ。'],
    ])
    expect(s.beats.map((b) => spLabels(b))).toEqual([
      ['#綾菜・通常', '#涼菜・通常'],
      ['#綾菜・通常', '#涼菜・驚き'],
      ['#涼菜・驚き'],
      ['#楓・通常', '#涼菜・驚き'],
    ])
  })

  it('reset=true は適用前に全スロットをクリア（establishing shot・残留スロットを消す）', () => {
    const s = build([
      ['sprite', ['#綾菜・通常', '#涼菜・通常', '#楓・通常']], // 3体
      ['text', 'Ａ。'],
      ['sprite', ['#真琴・通常'], true], // reset → 残留 slot1/2 を消し slot0=真琴 のみ
      ['text', 'Ｂ。'],
    ])
    expect(s.beats.map((b) => spLabels(b))).toEqual([
      ['#綾菜・通常', '#涼菜・通常', '#楓・通常'],
      ['#真琴・通常'],
    ])
  })

  it('reset なしの少数スロットは上位スロットを保持（増分更新）', () => {
    const s = build([
      ['sprite', ['#綾菜・通常', '#涼菜・通常']], // [綾菜, 涼菜]
      ['text', 'Ａ。'],
      ['sprite', ['#楓・通常']], // reset 無し・1体指定 → slot1(涼菜) 保持 → [楓, 涼菜]
      ['text', 'Ｂ。'],
    ])
    expect(s.beats.map((b) => spLabels(b))).toEqual([
      ['#綾菜・通常', '#涼菜・通常'],
      ['#楓・通常', '#涼菜・通常'],
    ])
  })

  it('off で全スロットの立ち絵を消す（bg には触れない）', () => {
    const s = build([
      ['bg', '#背景・部屋'],
      ['sprite', ['#綾菜・通常', '#涼菜・通常']],
      ['text', 'Ａ。'],
      ['off'],
      ['text', 'Ｂ。'],
    ])
    expect(s.beats.map((b) => ({ bg: b.bg?.label, sprites: spLabels(b) }))).toEqual([
      { bg: '#背景・部屋', sprites: ['#綾菜・通常', '#涼菜・通常'] },
      { bg: '#背景・部屋', sprites: null },
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
      { kind: 'narration', bg: '#背景・部屋', sprites: ['#綾菜・通常'], item: null },
      { kind: 'narration', bg: '#背景・部屋', sprites: ['#綾菜・通常'], item: 'ITEM_03_01' },
      { kind: 'narration', bg: '#背景・部屋', sprites: ['#綾菜・驚き'], item: 'ITEM_03_01' },
      { kind: 'narration', bg: '#背景・部屋', sprites: ['#綾菜・驚き'], item: null },
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
    const nLines = (b: Scene['beats'][number]) =>
      b.kind === 'narration' ? b.pages.flat().length : b.lines.length
    expect(s.beats.map((b) => ({ bgv: b.bgv?.id ?? null, n: nLines(b) }))).toEqual([
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

  it('中盤の \\N text はセクションカード＝独立ページの narration として流す（描画側が判定・HU-78）', () => {
    const s = build([
      ['text', '前夜の地の文。'],
      ['text', '朝の風景\\N年頃の男子の性欲'], // 0x2c 由来のセクションカード
      ['text', '朝の地の文。'],
    ])
    // \N 行は独立ページとして存在する（Stage の isSectionCard が描画時に題字化）
    const pages = s.beats.flatMap((b) => (b.kind === 'narration' ? b.pages : []))
    expect(pages).toContainEqual(['朝の風景\\N年頃の男子の性欲'])
  })
})
