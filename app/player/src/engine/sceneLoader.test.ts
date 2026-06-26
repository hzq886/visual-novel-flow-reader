import { describe, it, expect } from 'vitest'
import { hasScene, loadScene } from './sceneLoader'

// sceneLoader は data/scenes/<locale>/*.json を glob し "<locale>/<code>" で索引する（HU-29）。
// 実生成物（committed）に対する結合テスト。jp/cn 両ロケールの動的ロードと jp フォールバックを担保。
describe('sceneLoader — locale 別索引と jp フォールバック', () => {
  it('jp/cn 両ロケールで同一シーンを保持する', () => {
    expect(hasScene('002_AYAN001A', 'jp')).toBe(true)
    expect(hasScene('002_AYAN001A', 'cn')).toBe(true)
    expect(hasScene('002_AYAN001A')).toBe(true) // 既定 jp
  })

  it('cn 未収録シーンは cn には無いが jp には在る（002_AYAN004AB）', () => {
    expect(hasScene('002_AYAN004AB', 'jp')).toBe(true)
    expect(hasScene('002_AYAN004AB', 'cn')).toBe(false)
  })

  it('loadScene(jp) / loadScene(cn) が当該ロケールの Scene を返す', async () => {
    const sj = await loadScene('002_AYAN001A', 'jp')
    const sc = await loadScene('002_AYAN001A', 'cn')
    expect(sj.locale).toBe('jp')
    expect(sc.locale).toBe('cn')
    expect(sc.code).toBe('002_AYAN001A')
  })

  it('cn に無いシーンは jp へフォールバックして返す（クラッシュしない）', async () => {
    const s = await loadScene('002_AYAN004AB', 'cn')
    expect(s.code).toBe('002_AYAN004AB')
    expect(s.locale).toBe('jp') // フォールバック実体は jp
  })

  it('jp にも無いシーンは throw する', async () => {
    await expect(loadScene('___NOPE___', 'jp')).rejects.toThrow(/scene not found/)
  })
})
