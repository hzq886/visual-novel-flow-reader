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

describe('parseScene — [id] OFF で立ち絵をオフにする（HU-36）', () => {
  it('OFF 以降の narration beat は sprite が無くなる（bg は維持）', () => {
    const text = [
      '[note] #背景・部屋',
      '[note] #綾菜・通常',
      '[text] 立ち絵ありの地の文。',
      '[id] OFF',
      '[text] 立ち絵オフの地の文。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(
      s.beats.map((b) => ({ bg: b.bg?.label ?? null, sprite: b.sprite?.label ?? null })),
    ).toEqual([
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
      { bg: '#背景・部屋', sprite: null }, // OFF で立ち絵オフ・bg は維持
    ])
  })

  it('OFF 後に新しい立ち絵 note が来れば再設定される', () => {
    const text = [
      '[note] #綾菜・通常',
      '[text] Ａ。',
      '[id] OFF',
      '[text] Ｂ。',
      '[note] #涼菜・通常',
      '[text] Ｃ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats.map((b) => b.sprite?.label ?? null)).toEqual([
      '#綾菜・通常',
      null,
      '#涼菜・通常',
    ])
  })

  it('立ち絵が無い状態の OFF は余計な beat 分割をしない（no-op）', () => {
    const text = ['[note] #背景・部屋', '[text] Ａ。', '[id] OFF', '[text] Ｂ。'].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].lines).toEqual(['Ａ。', 'Ｂ。'])
  })
})

describe('parseScene — 被せ CG（EV/ITEM/黒一色）のレイヤモデル（HU-63）', () => {
  it('EV 表示中の beat には sprite を出力しない（下レイヤの立ち絵は隠れる）', () => {
    // 006_TUBA002B 相当: 立ち絵表示中に EV へ切替 → EV beat に立ち絵が重なっていた不具合。
    const text = [
      '[note] #背景・教室（夕）',
      '[note] #翼・催眠１',
      '[text] 立ち絵ありの地の文。',
      '[note] #EV011・横向き',
      '[text] イベントCGの地の文。',
    ].join('\n')
    const s = parseScene(text, { code: '006_TUBA002B', locale: 'jp' })
    expect(
      s.beats.map((b) => ({ bg: b.bg?.label ?? null, sprite: b.sprite?.label ?? null })),
    ).toEqual([
      { bg: '#背景・教室（夕）', sprite: '#翼・催眠１' },
      { bg: '#EV011・横向き', sprite: null }, // EV 中は立ち絵を隠す
    ])
  })

  it('EV 中の立ち絵 note は被せ CG を閉じ、通常背景＋立ち絵へ復帰する', () => {
    // 001_PRO002B2 相当: 朝食イベント CG → 日常へ戻り綾菜の立ち絵 note。
    const text = [
      '[note] #背景・リビング（昼）',
      '[text] 朝食前の地の文。',
      '[note] #EV001・朝食',
      '[text] 朝食イベントの地の文。',
      '[note] #綾菜・通常',
      '[text] 日常へ戻った地の文。',
    ].join('\n')
    const s = parseScene(text, { code: '001_PRO002B2', locale: 'jp' })
    expect(
      s.beats.map((b) => ({ bg: b.bg?.label ?? null, sprite: b.sprite?.label ?? null })),
    ).toEqual([
      { bg: '#背景・リビング（昼）', sprite: null },
      { bg: '#EV001・朝食', sprite: null },
      { bg: '#背景・リビング（昼）', sprite: '#綾菜・通常' }, // EV が閉じて下レイヤ復帰
    ])
  })

  it('EV → #背景 復帰時、下レイヤの立ち絵 sticky が再表示される（note 再指定なし）', () => {
    const text = [
      '[note] #背景・部屋',
      '[note] #綾菜・通常',
      '[text] Ａ。',
      '[note] #EV002・回想',
      '[text] Ｂ。',
      '[note] #背景・部屋',
      '[text] Ｃ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats.map((b) => b.sprite?.label ?? null)).toEqual([
      '#綾菜・通常',
      null, // EV 中は隠れる
      '#綾菜・通常', // 復帰で再表示（sticky 保持）
    ])
  })

  it('黒一色（暗転）・ITEM も被せ扱い＝表示中は立ち絵を出さない', () => {
    const text = [
      '[note] #背景・部屋',
      '[note] #綾菜・通常',
      '[text] Ａ。',
      '[id] BG_BLACK',
      '[text] Ｂ。',
      '[id] ITEM_03_01',
      '[text] Ｃ。',
      '[note] #背景・部屋',
      '[text] Ｄ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(
      s.beats.map((b) => ({ bg: b.bg?.label ?? null, sprite: b.sprite?.label ?? null })),
    ).toEqual([
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
      { bg: '#背景・黒一色', sprite: null },
      { bg: 'ITEM_03_01', sprite: null },
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
    ])
  })

  it('EV 中の [id] OFF は下レイヤの立ち絵を消す（復帰後も出ない・beat 分割なし）', () => {
    const text = [
      '[note] #背景・部屋',
      '[note] #綾菜・通常',
      '[text] Ａ。',
      '[note] #EV002・回想',
      '[text] Ｂ。',
      '[id] OFF',
      '[text] Ｃ。',
      '[note] #背景・部屋',
      '[text] Ｄ。',
    ].join('\n')
    const s = parseScene(text, { code: '999_TEST001A', locale: 'jp' })
    expect(
      s.beats.map((b) => ({ bg: b.bg?.label ?? null, sprite: b.sprite?.label ?? null })),
    ).toEqual([
      { bg: '#背景・部屋', sprite: '#綾菜・通常' },
      { bg: '#EV002・回想', sprite: null }, // OFF は見た目不変＝分割なし（Ｂ/Ｃ が同 beat）
      { bg: '#背景・部屋', sprite: null }, // 復帰しても立ち絵は OFF 済み
    ])
  })
})

describe('parseScene — [id] ITEM_* をアイテムCG（背景）として反映（HU-41）', () => {
  it('[id] ITEM_xx_yy で bg ラベルが当該 CG コードになる', () => {
    // 001_PRO001B 相当: ITEM の直後に説明の地の文が続く。
    const text = [
      '[note] #背景・部屋',
      '[text] 直前の地の文。',
      '[id] ITEM_03_01',
      '[text] そうして渡そうとしたのは、赤い傘だった。',
    ].join('\n')
    const s = parseScene(text, { code: '001_PRO001B', locale: 'jp' })
    expect(s.beats.map((b) => ({ bg: b.bg?.label ?? null, n: b.lines.length }))).toEqual([
      { bg: '#背景・部屋', n: 1 },
      { bg: 'ITEM_03_01', n: 1 }, // アイテムCGへ切替（次 bg まで持続）
    ])
  })

  it('ITEM コードはパース時 file=null（解決は resolveBg のフォールバックが担う）', () => {
    const s = parseScene('[id] ITEM_11_02\n[text] 壁の器具。', {
      code: '005_MAKO013C',
      locale: 'jp',
    })
    expect(s.beats[0].bg).toEqual({ label: 'ITEM_11_02', file: null })
  })
})

describe('parseScene — [id] BGV_* を背景ボイス（sticky ループ）として反映（HU-37）', () => {
  it('BGV 開始以降の beat に bgv が載り、次 BGV で切替（sticky）', () => {
    const text = [
      '[note] #EV001・通常',
      '[text] 開始前の地の文。',
      '[id] BGV_AYAN_H001A',
      '[text] 喘ぎ開始。',
      '[text] 続く。',
      '[id] BGV_AYAN_H002A',
      '[text] 強くなる。',
    ].join('\n')
    const s = parseScene(text, { code: '004_FUTA005B', locale: 'jp' })
    expect(s.beats.map((b) => ({ bgv: b.bgv?.id ?? null, n: b.lines.length }))).toEqual([
      { bgv: null, n: 1 }, // BGV 前
      { bgv: 'BGV_AYAN_H001A', n: 2 }, // 2行とも H001A（sticky・flush で開始行から）
      { bgv: 'BGV_AYAN_H002A', n: 1 }, // H002A へ切替
    ])
  })

  it('同一 BGV の重複指定では分割しない（no-op）', () => {
    const text = ['[id] BGV_SUZU_H001A', '[text] Ａ。', '[id] BGV_SUZU_H001A', '[text] Ｂ。'].join(
      '\n',
    )
    const s = parseScene(text, { code: '003_SUZU005B', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].bgv).toEqual({ id: 'BGV_SUZU_H001A', file: null })
  })
})

describe('parseScene — [id] EFFECT:FLASHn を画面フラッシュとして反映（HU-38）', () => {
  it('FLASHn は直後の beat（インパクト行）に flash 強度を付与する', () => {
    // 001_PRO002F 相当: 「…３つ！」→ FLASH1 →「パンッ！！」。
    const text = ['[text] 「１つ、２つ、３つ！」', '[id] EFFECT:FLASH1', '[text] パンッ！！'].join(
      '\n',
    )
    const s = parseScene(text, { code: '001_PRO002F', locale: 'jp' })
    // セリフ beat には付かず、次の地の文（パンッ）に flash=1 が載る。
    expect(s.beats.map((b) => ({ kind: b.kind, flash: b.flash ?? null }))).toEqual([
      { kind: 'line', flash: null },
      { kind: 'narration', flash: 1 },
    ])
  })

  it('FLASH2/3 の強度がそのまま入る', () => {
    const s = parseScene('[id] EFFECT:FLASH3\n[text] 衝撃。', {
      code: '999_TEST001A',
      locale: 'jp',
    })
    expect(s.beats[0].flash).toBe(3)
  })

  it('MIX01 は取り込まない（既定クロスフェードでカバー＝flash も bg も付与しない）', () => {
    const s = parseScene('[id] MIX01\n[text] 場面転換後。', { code: '999_TEST001A', locale: 'jp' })
    expect(s.beats[0].flash).toBeUndefined()
    expect(s.beats[0].bg).toBeUndefined()
  })
})

describe('parseScene — メタ系 [id] マーカーは無視（HU-40 仕分けの回帰ガード）', () => {
  it('_VIEW / _START / 後続 CG コード / コロン命令は beat の bg/sprite/se/bgv/flash を変えない', () => {
    const text = [
      '[note] #背景・部屋',
      '[text] 本文。',
      '[id] _VIEW', // CG ギャラリー登録メタ
      '[id] 002_ayan004B_01_02', // _VIEW 後続のギャラリー CG コード
      '[id] _START', // 複合シーン開始印
      '[id] GRA:BG_RED', // 演出マクロ表専用（本来本編には来ないが来ても無害）
      '[id] MUSIC:3', // 同上
      '[text] 続く本文。',
    ].join('\n')
    const s = parseScene(text, { code: '002_AYAN004B', locale: 'jp' })
    // 全行が同一 narration beat に集約され、bg は #背景・部屋 のまま。余計な beat/参照は生まれない。
    expect(s.beats).toHaveLength(1)
    const b = s.beats[0]
    expect(b.kind).toBe('narration')
    expect(b.bg?.label).toBe('#背景・部屋')
    expect(b.lines).toEqual(['本文。', '続く本文。'])
    expect(b.sprite).toBeUndefined()
    expect(b.se).toBeUndefined()
    expect(b.bgv).toBeUndefined()
    expect(b.flash).toBeUndefined()
  })

  it('MIX01 は無視（既定クロスフェードで表現）＝ bg を設定しない', () => {
    const s = parseScene('[note] #背景・部屋\n[text] Ａ。\n[id] MIX01\n[text] Ｂ。', {
      code: '002_AYAN004B',
      locale: 'jp',
    })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].bg?.label).toBe('#背景・部屋')
  })
})

describe('parseScene — 未クローズ「」がボイスID境界で区切られる（HU-42）', () => {
  it('閉じ「」」欠落のセリフは次のボイスIDで打ち切られ、後続行を吸収しない', () => {
    // 006_TUBA016B 相当: 「…んひぃんっ！（閉じなし）→ 地の文 → 次ボイス「…」
    const text = [
      '[id] CHAR_006_TUBA016B_001',
      '[text] 「ズボズボぉ、もっと、はげしくぅ！　んひぃんっ！', // 未クローズ「
      '[text] イッたばかりだからか、激しい喘ぎ声に。', // 本来は地の文（壊れたセリフに吸収されるが…）
      '[id] CHAR_006_TUBA016B_002', // ← 新ボイスID で quoteDepth リセット
      '[text] 「ううっ、あっ！　しゅごいぃ～！」', // 新しい独立したセリフ beat
      '[text] 快感が強すぎるのか。', // 独立した地の文
    ].join('\n')
    const s = parseScene(text, { code: '006_TUBA016B', locale: 'jp' })
    // 暴走せず、2つ目のセリフと地の文が独立して取れる。
    const proj = s.beats.map((b) => ({ kind: b.kind, n: b.lines.length }))
    expect(proj).toEqual([
      { kind: 'line', n: 2 }, // 壊れたセリフ＋吸収された地の文1行（次ボイスIDで打ち切り）
      { kind: 'line', n: 1 }, // 「ううっ…」＝独立
      { kind: 'narration', n: 1 }, // 快感が… ＝独立
    ])
    // 2つ目のセリフが正しく1発話として取れている（暴走時はここが巨大化していた）。
    expect(s.beats[1].lines).toEqual(['「ううっ、あっ！　しゅごいぃ～！」'])
  })

  it('正規の複数行セリフ（voice-id を跨がない）は従来どおり1 beat に集約（no-op）', () => {
    const text = [
      '[id] CHAR_002_AYAN001A_001',
      '[text] 「もう時間だから、閉めるところだけど、なにか',
      '[text] 飲み物でも淹れる？」',
    ].join('\n')
    const s = parseScene(text, { code: '002_AYAN001A', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].kind).toBe('line')
    expect(s.beats[0].lines).toHaveLength(2)
  })
})

describe('parseScene — 他シーン流用ボイスIDの取り込み（HU-67）', () => {
  it('中間部が現在のシーンコードと異なるボイスIDも beat.voice に取り込む', () => {
    // 010_MAIN001A 相当: 001_PRO003A/B 収録の音声を流用（原ゲームは録音を別シーンで使い回す）。
    const text = [
      '[text] 【古橋　綾菜】',
      '[id] AYAN_001_PRO003A_003',
      '[text] 「おはよう。あら、眠そうね……大丈夫？」',
      '[text] 【古橋　涼菜】',
      '[id] SUZU_001_PRO003B_003',
      '[text] 「ちゃんと寝たの？　夜ふかしは良くないわよ？」',
    ].join('\n')
    const s = parseScene(text, { code: '010_MAIN001A', locale: 'jp' })
    expect(s.beats.map((b) => (b.kind === 'line' ? b.voice?.id : null))).toEqual([
      'AYAN_001_PRO003A_003',
      'SUZU_001_PRO003B_003',
    ])
  })

  it('変則連番 _SUB のボイスIDも取り込む（003_SUZU005B の SUZU_003_SUZU005A_SUB）', () => {
    const text = ['[id] SUZU_003_SUZU005A_SUB', '[text] 「……ん……」'].join('\n')
    const s = parseScene(text, { code: '003_SUZU005B', locale: 'jp' })
    expect(s.beats[0].kind).toBe('line')
    expect(s.beats[0].kind === 'line' && s.beats[0].voice?.id).toBe('SUZU_003_SUZU005A_SUB')
  })

  it('流用ボイスIDでも接頭辞→話者の解決が効く（話者欠落行）', () => {
    // 先に 【綾菜】＋AYAN_* で対応を学習 → 後段の話者欠落行を流用 AYAN_* から綾菜と解決。
    const text = [
      '[text] 【古橋　綾菜】',
      '[id] AYAN_001_PRO003A_003',
      '[text] 「おはよう」',
      '[text] 地の文。',
      '[id] AYAN_009_NUKE001_001',
      '[text] 「話者表記の無いセリフ」',
    ].join('\n')
    const s = parseScene(text, { code: '010_MAIN001A', locale: 'jp' })
    const last = s.beats[s.beats.length - 1]
    expect(last.kind === 'line' && last.who).toBe('古橋　綾菜')
  })

  it('無声・無記名の発話は主人公に帰属（直前の女性話者を引き継がない）', () => {
    // 002_AYAN005B 相当: 綾菜の有声セリフに挟まれた和樹の未収録応答。
    const text = [
      '[text] 【古橋　綾菜】',
      '[id] AYAN_002_AYAN005A_005',
      '[text] 「ふふっ、恥ずかしがらなくてもいいじゃない」',
      '[text] 「この歳で、姉さんとお風呂だなんて……」', // 無声・無記名 = 和樹
      '[id] AYAN_002_AYAN005A_006',
      '[text] 「はーい、もう脱いじゃいました！」',
    ].join('\n')
    const s = parseScene(text, { code: '002_AYAN005B', locale: 'jp' })
    expect(s.beats.map((b) => (b.kind === 'line' ? b.who : null))).toEqual([
      '古橋　綾菜',
      '古橋　和樹',
      '古橋　綾菜',
    ])
  })

  it('cn ロケールでは無声・無記名の発話が中国語の主人公名になる', () => {
    const text = [
      '[cn] 【古桥绫菜】',
      '[ascii] AYAN_002_AYAN005A_005',
      '[cn] 「呵呵，不用害羞嘛」',
      '[cn] 「这个年纪还和姐姐一起洗澡……」',
    ].join('\n')
    const s = parseScene(text, { code: '002_AYAN005B', locale: 'cn' })
    const last = s.beats[s.beats.length - 1]
    expect(last.kind === 'line' && last.who).toBe('古桥和树')
  })

  it('BGV_* / se コード / ITEM_* / BG_BLACK はボイスIDとして誤認しない（既存分岐を維持）', () => {
    const text = [
      '[id] BGV_AYAN_H001A',
      '[id] 8351A',
      '[id] ITEM_01_02',
      '[id] BG_BLACK',
      '[text] 地の文。',
    ].join('\n')
    const s = parseScene(text, { code: '010_MAIN001A', locale: 'jp' })
    expect(s.beats).toHaveLength(1)
    expect(s.beats[0].kind).toBe('narration')
    // voice ではなく bgv / se / 背景として取り込まれている
    expect(s.beats[0].bgv?.id).toBe('BGV_AYAN_H001A')
    expect(s.beats[0].se?.map((x) => x.code)).toEqual(['8351A'])
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

  it('本編 beat の後に現れるアイキャッチ・タイトルカードも title にする（HU-49）', () => {
    // 011_SUBT003A 相当: 前夜の回想（地の文）の後に `朝の風景\N…` のタイトルカードが置かれる。
    // タイトルカードはセクション境界として開いている beat を flush するので、前後の地の文は
    // 同一 beat に混ざらない。
    const text = [
      '[text] ……夜、僕は自分の部屋で思い出す。',
      '[text] 激しいオナニーをしていた。',
      '[text] 朝の風景\\N年頃の男子の性欲',
      '[text] ……朝になり、僕は目を覚ます。',
    ].join('\n')
    const s = parseScene(text, { code: '011_SUBT003A', locale: 'jp' })
    expect(s.title).toBe('朝の風景\\N年頃の男子の性欲')
    expect(s.beats).toHaveLength(2)
    expect(s.beats[0].lines).toEqual([
      '……夜、僕は自分の部屋で思い出す。',
      '激しいオナニーをしていた。',
    ])
    expect(s.beats[1].lines).toEqual(['……朝になり、僕は目を覚ます。'])
  })

  it('タイトルカードが複数あっても最初の 1 つだけを採用（先頭優先・HU-49 無回帰）', () => {
    // 011_SUBT004A 相当: 先頭 `古橋和樹\N次の準備を` と本編後の `朝の風景\N悶々として`。
    // 後者は title にせず地の文として残す（既存挙動を維持）。
    const text = [
      '[text] 古橋和樹\\N次の準備を',
      '[text] ……翌朝の支度をする。',
      '[text] 朝の風景\\N悶々として',
      '[text] ……悶々としてしまう。',
    ].join('\n')
    const s = parseScene(text, { code: '011_SUBT004A', locale: 'jp' })
    expect(s.title).toBe('古橋和樹\\N次の準備を')
    expect(s.beats.flatMap((b) => b.lines)).toContain('朝の風景\\N悶々として')
  })
})
