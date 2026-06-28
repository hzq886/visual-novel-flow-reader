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
      // 冒頭 narration（[id] BG_BLACK = 黒一色背景。HU-35 で bg として反映。sprite はまだ無し）
      {
        kind: 'narration',
        who: undefined,
        voice: undefined,
        bg: '#背景・黒一色',
        sprite: null,
        nLines: 4,
      },
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

  it('se [id] マーカー（4桁+英字）を beat に取り込む', () => {
    // 冒頭 narration に効果音 0001D（ボイスIDではないため voice にはならない）。
    expect(scene.beats[0].se).toEqual([{ code: '0001D', file: null }])
  })

  it('完全スナップショット', () => {
    expect(scene).toMatchSnapshot()
  })
})

describe('parseScene — se の beat への割当（pending/current）', () => {
  const text = [
    '[id] 0001a', // beat 生成前 → 持ち越して最初の beat へ
    '[text] 地の文です。',
    '[text] 【話者】',
    '[id] 8201B', // 話者マーカーで flush 済 → 持ち越して次のセリフ beat へ
    '[text] 「セリフだよ」',
    '[id] 9001A', // セリフ beat が active → その beat へ追加
    '[text] 続く地の文。',
  ].join('\n')
  const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })

  it('生成前の se は最初の beat へ持ち越す', () => {
    expect(s.beats[0].kind).toBe('narration')
    expect(s.beats[0].se).toEqual([{ code: '0001a', file: null }])
  })
  it('話者直後の se は次のセリフ beat へ、active 中の se は同 beat へ追加', () => {
    expect(s.beats[1].kind).toBe('line')
    expect(s.beats[1].se).toEqual([
      { code: '8201B', file: null },
      { code: '9001A', file: null },
    ])
  })
  it('se の無い beat は se を持たない', () => {
    expect(s.beats[2].se).toBeUndefined()
  })
})

describe('parseScene — ナレーション途中の背景/立ち絵切替で beat を分割（HU-34）', () => {
  it('地の文の途中で背景 note が変わると、その行から新 beat（新背景）になる', () => {
    // 001_PRO001A 相当: モノトーン（回想）→ 通常（現在）の切替がナレーション中に起きる。
    const text = [
      '[note] #背景・プロローグＡ',
      '[text] 冒頭の地の文。',
      '[note] #EV003・モノトーン',
      '[text] 両親を失った記憶。',
      '[text] 恐ろしさに震えていた。',
      '[note] #EV003・通常',
      '[text] 姉さんが抱き支えてくれた。',
    ].join('\n')
    const s = parseScene(text, { code: '001_PRO001A', locale: 'jp' })
    const proj = s.beats.map((b) => ({ kind: b.kind, bg: b.bg?.label ?? null, n: b.lines.length }))
    expect(proj).toEqual([
      { kind: 'narration', bg: '#背景・プロローグＡ', n: 1 },
      { kind: 'narration', bg: '#EV003・モノトーン', n: 2 },
      { kind: 'narration', bg: '#EV003・通常', n: 1 },
    ])
  })

  it('地の文の途中で立ち絵 note が変わっても beat を分割する', () => {
    const text = [
      '[note] #背景・部屋',
      '[note] #綾菜・通常',
      '[text] 地の文Ａ。',
      '[note] #綾菜・笑顔',
      '[text] 地の文Ｂ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats.map((b) => ({ sprite: b.sprite?.label ?? null, n: b.lines.length }))).toEqual([
      { sprite: '#綾菜・通常', n: 1 },
      { sprite: '#綾菜・笑顔', n: 1 },
    ])
  })

  it('同一ラベルの重複 note では分割しない（無駄な beat を作らない）', () => {
    const text = [
      '[note] #背景・部屋',
      '[text] 地の文Ａ。',
      '[note] #背景・部屋',
      '[text] 地の文Ｂ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].lines).toEqual(['地の文Ａ。', '地の文Ｂ。'])
  })

  it('note 直後がセリフのとき（従来動作）はナレーションが余計に分割されない', () => {
    const text = [
      '[note] #背景・部屋',
      '[text] 地の文。',
      '[note] #EV001・通常',
      '[text] 【話者】',
      '[text] 「セリフ」',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats.map((b) => ({ kind: b.kind, bg: b.bg?.label ?? null }))).toEqual([
      { kind: 'narration', bg: '#背景・部屋' },
      { kind: 'line', bg: '#EV001・通常' },
    ])
  })
})

describe('parseScene — [id] BG_BLACK を黒一色背景として反映（HU-35）', () => {
  it('冒頭の [id] BG_BLACK で先頭 narration の bg が #背景・黒一色 になる', () => {
    const text = ['[id] BG_BLACK', '[text] 黒画面の地の文。'].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats[0].bg).toEqual({ label: '#背景・黒一色', file: null })
  })

  it('ナレーション途中の [id] BG_BLACK は beat を分割して黒画面へ切替', () => {
    // 004_FUTA005B 相当: CG 表示中 → 黒画面 → 回想 という流れ。
    const text = [
      '[note] #EV068・制服',
      '[text] 制服の地の文。',
      '[id] BG_BLACK',
      '[text] 黒画面で回想に入る。',
    ].join('\n')
    const s = parseScene(text, { code: '004_FUTA005B', locale: 'jp' })
    expect(s.beats.map((b) => ({ bg: b.bg?.label ?? null, n: b.lines.length }))).toEqual([
      { bg: '#EV068・制服', n: 1 },
      { bg: '#背景・黒一色', n: 1 },
    ])
  })

  it('連続する BG_BLACK では分割しない（同一ラベル）', () => {
    const text = ['[id] BG_BLACK', '[text] 地の文Ａ。', '[id] BG_BLACK', '[text] 地の文Ｂ。'].join(
      '\n',
    )
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].bg).toEqual({ label: '#背景・黒一色', file: null })
  })
})

describe('parseScene — 制御残骸（PUA/デコード失敗）の除去とタイトルカード復元', () => {
  const PUA = '\uf8f3' // U+F8F3「⬚」= 原データ抽出時のゴミ文字
  it('冒頭のゴミヘッダ（PUA＋単独文字）を捨て、直後のタイトルカードを title にする', () => {
    // 001_PRO001A 相当: "⬚G" が title カード "幼少回想\N三人" の直前に居座る。
    const text = [
      `[text] ${PUA}G`,
      '[text] 幼少回想\\N三人',
      '[text] ……子供の頃のことを、思い出す。',
      '[text] 何かを『失う』というのは、恐ろしいことだ。',
    ].join('\n')
    const s = parseScene(text, { code: '001_PRO001A', locale: 'jp' })
    expect(s.title).toBe('幼少回想\\N三人')
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].lines).toEqual([
      '……子供の頃のことを、思い出す。',
      '何かを『失う』というのは、恐ろしいことだ。',
    ])
  })

  it('連続するゴミヘッダ（複数 PUA・複数行）も全て捨てる', () => {
    // 001_PRO001K 相当: "⬚⬚E" / "⬚⬚e" の 2 行が title の前にある。
    const text = [
      `[text] ${PUA}${PUA}E`,
      `[text] ${PUA}${PUA}e`,
      '[text] 幼少回想\\N喫茶店',
      '[text] 本文。',
    ].join('\n')
    const s = parseScene(text, { code: '001_PRO001K', locale: 'jp' })
    expect(s.title).toBe('幼少回想\\N喫茶店')
    expect(s.beats[0].lines).toEqual(['本文。'])
  })

  it('残骸を含んでも本文が残る行は本文として保持（残骸のみ除去）', () => {
    const text = `[text] ${PUA}本文が続く。`
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats[0].lines).toEqual(['本文が続く。'])
  })

  it('デコード失敗(U+FFFD)のみ・PUA のみの行も捨てる', () => {
    const text = ['[text] \ufffd', `[text] ${PUA}`, '[text] 本文。'].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats[0].lines).toEqual(['本文。'])
  })
})
