import { describe, it, expect } from 'vitest'
import { hasScene, loadScene } from './sceneLoader'

// sceneLoader は data/scenes/<locale>/*.json を glob し "<locale>/<code>" で索引する（HU-29）。
// 実生成物（committed）に対する結合テスト。jp/cn 両ロケールの動的ロードと jp フォールバックを担保。
const sceneFiles = import.meta.glob('../../data/scenes/*/*.json')
const codesOf = (locale: string) =>
  new Set(
    Object.keys(sceneFiles)
      .filter((p) => p.includes(`/scenes/${locale}/`))
      .map((p) =>
        p
          .split('/')
          .pop()!
          .replace(/\.json$/, ''),
      ),
  )

describe('sceneLoader — locale 別索引と jp フォールバック', () => {
  it('jp/cn 両ロケールで同一シーンを保持する', () => {
    expect(hasScene('002_AYAN001A', 'jp')).toBe(true)
    expect(hasScene('002_AYAN001A', 'cn')).toBe(true)
    expect(hasScene('002_AYAN001A')).toBe(true) // 既定 jp
  })

  it('複合シーン（[text] が制御残骸のみ）は jp/cn どちらにも生成されない（002_AYAN004AB）', () => {
    // 旧データは jp のみ junk から偽 beat を生成し cn と不整合だった。HU-31 の残骸除去で
    // jp/cn とも 0 beat＝未出力に揃った（複合連結子 004A+004B として flow が構成アトムを参照）。
    expect(hasScene('002_AYAN004AB', 'jp')).toBe(false)
    expect(hasScene('002_AYAN004AB', 'cn')).toBe(false)
  })

  it('jp/cn のシーン集合は一致する（cn 未収録の content シーンは無い）', () => {
    const jp = codesOf('jp')
    const cn = codesOf('cn')
    expect([...jp].filter((c) => !cn.has(c))).toEqual([])
    expect([...cn].filter((c) => !jp.has(c))).toEqual([])
  })

  it('loadScene(jp) / loadScene(cn) が当該ロケールの Scene を返す', async () => {
    const sj = await loadScene('002_AYAN001A', 'jp')
    const sc = await loadScene('002_AYAN001A', 'cn')
    expect(sj.locale).toBe('jp')
    expect(sc.locale).toBe('cn')
    expect(sc.code).toBe('002_AYAN001A')
  })

  it('jp/cn いずれにも無いシーンは throw する', async () => {
    await expect(loadScene('___NOPE___', 'jp')).rejects.toThrow(/scene not found/)
    await expect(loadScene('002_AYAN004AB', 'cn')).rejects.toThrow(/scene not found/)
  })
})
