import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import { Flow } from '@/pipeline/types'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryOfNode,
  categoryOfScene,
  type Category,
} from './category'

const flow = Flow.parse(flowJson)

describe('categoryOfScene — シーンコード接頭辞 → 表示カテゴリ（9分類）', () => {
  it.each<[string, Category]>([
    ['001_PRO001A', 'common'],
    ['010_MAIN002A', 'common'],
    ['009_NUKE001A', 'common'],
    ['002_AYAN001A', 'ayan'],
    ['011_SUBA001A', 'ayan'],
    ['003_SUZU006A', 'suzu'],
    ['006_TUBA001A', 'tuba'],
    ['011_SUBT001A', 'tuba'],
    ['005_MAKO001B', 'mako'],
    ['007_KAED003A', 'kaede'],
    ['004_FUTA001A', 'merge'],
    ['012_SUBTM001A', 'merge'],
  ])('%s → %s', (code, expected) => {
    expect(categoryOfScene(code)).toBe(expected)
  })

  it('合流(FUTA/SUBTM)は音声分類(suzu/tuba)から独立した merge へ', () => {
    expect(categoryOfScene('004_FUTA001A')).toBe('merge')
    expect(categoryOfScene('012_SUBTM001A')).toBe('merge')
  })

  it('未知トークン/非シーンコードは common', () => {
    expect(categoryOfScene('ZZZ_NONE001A')).toBe('common')
    expect(categoryOfScene('not-a-code')).toBe('common')
  })
})

describe('categoryOfNode — Flow ノード → 表示カテゴリ', () => {
  it('hub(branch)/end/start/omake は kind から決まる', () => {
    expect(categoryOfNode({ kind: 'branch', scenes: [] })).toBe('branch')
    expect(categoryOfNode({ kind: 'end', scenes: [] })).toBe('end')
    expect(categoryOfNode({ kind: 'start', scenes: [] })).toBe('common')
    expect(categoryOfNode({ kind: 'omake', scenes: [] })).toBe('common')
  })

  it('arc は内包シーンの多数決カテゴリ（タイは CATEGORY_ORDER 優先で決定的）', () => {
    expect(categoryOfNode({ kind: 'arc', scenes: ['002_AYAN001A', '002_AYAN001B'] })).toBe('ayan')
    // ayan 2 : suzu 1 → ayan
    expect(
      categoryOfNode({ kind: 'arc', scenes: ['002_AYAN001A', '002_AYAN001B', '003_SUZU006A'] }),
    ).toBe('ayan')
    expect(categoryOfNode({ kind: 'arc', scenes: [] })).toBe('common')
  })

  it('実 flow.json の全ノードが既知カテゴリに分類される', () => {
    for (const n of flow.nodes) {
      const c = categoryOfNode(n)
      expect(CATEGORY_ORDER).toContain(c)
    }
  })

  it('SMAIN_* hub は分岐、NORMAL_END/TRUE_END はエンド（受入）', () => {
    const byId = (id: string) => flow.nodes.find((n) => n.id === id)!
    expect(categoryOfNode(byId('SMAIN_MIX01'))).toBe('branch')
    expect(categoryOfNode(byId('NORMAL_END'))).toBe('end')
    expect(categoryOfNode(byId('TRUE_END'))).toBe('end')
  })
})

describe('配色・凡例テーブルの整合', () => {
  it('全カテゴリに色と表示名があり、順序が9件で重複なし', () => {
    expect(CATEGORY_ORDER).toHaveLength(9)
    expect(new Set(CATEGORY_ORDER).size).toBe(9)
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_COLOR[c]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0)
    }
  })

  it('色は全カテゴリで一意（凡例の識別性）', () => {
    const colors = CATEGORY_ORDER.map((c) => CATEGORY_COLOR[c])
    expect(new Set(colors).size).toBe(colors.length)
  })
})
