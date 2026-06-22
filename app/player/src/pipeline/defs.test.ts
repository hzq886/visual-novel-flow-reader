import { describe, it, expect } from 'vitest'
import { parseSprset, parseBgset, resolveSprite, resolveBg } from './defs'
import { SprsetTable, BgsetTable } from './types'

// _SPRSET.txt の実フォーマットを縮約したフィクスチャ（綾菜（中）ブロック + 透明ブロック）。
const SPRSET = `[note] PREFIX:綾菜（中）・通常１（夕）,CH01B_01_02
[note] BODY:・私服０２,_003_02
[note] BODY:・裸０１,_001_01
[note] FACE:・にっこり１,_102_01,342,84
[note] FACE:・通常１,_101_01,342,84
[id] PARTS:
[id] PARTS2:
[note] PREFIX:透明,CH00A_01_01
[note] BODY:・,_001_01
[note] FACE:・,_101_01
[id] PARTS:
[id] PARTS2:
`

// _BGSET.txt の実フォーマットを縮約したフィクスチャ（先頭の note 無し [id] を含む）。
const BGSET = `[id] #DUMMY
[note] #背景・喫茶店（昼）
[id] BG20_01_00
[note] #背景・喫茶店（夕）
[id] BG20_02_00
`

describe('parseSprset', () => {
  it('PREFIX ブロックを code/body/face に構造化する', () => {
    const table = parseSprset(SPRSET)
    expect(SprsetTable.parse(table)).toEqual(table) // スキーマ適合
    expect(table['綾菜（中）・通常１（夕）']).toEqual({
      code: 'CH01B_01_02',
      body: { '・私服０２': '_003_02', '・裸０１': '_001_01' },
      face: { '・にっこり１': ['_102_01', 342, 84], '・通常１': ['_101_01', 342, 84] },
    })
  })

  it('座標を省略した FACE（透明ブロック）は [suffix, 0, 0] になる', () => {
    const table = parseSprset(SPRSET)
    expect(table['透明'].face['・']).toEqual(['_101_01', 0, 0])
  })
})

describe('parseBgset', () => {
  it('note → 直後の id の辞書を作り、先頭の #DUMMY は無視する', () => {
    const table = parseBgset(BGSET)
    expect(BgsetTable.parse(table)).toEqual(table)
    expect(table).toEqual({
      '#背景・喫茶店（昼）': 'BG20_01_00',
      '#背景・喫茶店（夕）': 'BG20_02_00',
    })
  })
})

// 受入: 「綾菜（中）私服02・にっこり1」と「喫茶店（夕）」が正しく解決される（HU-6 acceptance）。
describe('resolution (acceptance)', () => {
  it('立ち絵: 綾菜（中）私服02・にっこり1 → body/face コード + 顔オフセット', () => {
    const table = parseSprset(SPRSET)
    const ref = resolveSprite(table, '#綾菜（中）・通常１（夕）・私服０２・にっこり１')
    expect(ref).toEqual({
      label: '綾菜（中）・通常１（夕）・私服０２・にっこり１',
      body: 'CH01B_01_02_003_02', // 素材ファイル CH01B_01_02_003_02.png に一致
      face: 'CH01B_01_02_102_01',
      offset: [342, 84],
    })
  })

  it('背景: 喫茶店（夕） → BG20_02_00', () => {
    const table = parseBgset(BGSET)
    expect(resolveBg(table, '#背景・喫茶店（夕）')).toEqual({
      label: '#背景・喫茶店（夕）',
      file: 'BG20_02_00',
    })
  })

  it('未知ラベルは未解決（null）を返す', () => {
    expect(
      resolveSprite(parseSprset(SPRSET), '#存在しない・通常１（夕）・私服０２・にっこり１'),
    ).toEqual({ label: '存在しない・通常１（夕）・私服０２・にっこり１', body: null, face: null })
    expect(resolveBg(parseBgset(BGSET), '#背景・存在しない').file).toBeNull()
  })
})
