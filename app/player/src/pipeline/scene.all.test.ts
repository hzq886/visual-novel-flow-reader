import { describe, it, expect } from 'vitest'
import { buildScene } from './scene'
import { Scene, SceneEventsBundle, type SceneEvent } from './types'
// 全シーン回帰: bytecode 由来のイベント列（committed）を build して全編で破綻しないことを担保する。
import jpEventsRaw from '@data/scene-events/jp.json'

const jp = SceneEventsBundle.parse(jpEventsRaw)
const codes = Object.keys(jp).sort()
// 本文（text イベント）を持つ＝再生対象の「内容シーン」。持たず参照のみ＝「複合シーン」（0 beat・
// 例 006_TUBA010BC = 010B+010C を束ねる連結子。flow は構成アトムを参照し複合は辿らない）。
const hasText = (code: string) => jp[code].events.some((e) => e[0] === 'text')

describe('buildScene — 全シーン invariant（全編化の回帰防止）', () => {
  it('コーパス構成: 実シーン数・内容/複合の内訳', () => {
    const content = codes.filter(hasText)
    const composite = codes.filter((c) => !hasText(c))
    expect(codes.length).toBe(319) // scene-events の本編シーン総数
    expect(content.length).toBe(286) // text イベントを持つ内容シーン
    expect(composite.length).toBe(33) // text 無し＝0 beat の連結子（出力対象外）
  })

  it('全シーンが build でき、スキーマ適合・本文有無↔beats>0 の対応を満たす', () => {
    const failures: string[] = []
    let beatTotal = 0
    for (const code of codes) {
      try {
        const scene = buildScene(
          { title: jp[code].title, events: jp[code].events as SceneEvent[] },
          { code, locale: 'jp' },
        )
        Scene.parse(scene)
        if (scene.code !== code) failures.push(`${code}: code 不一致 (${scene.code})`)
        if (scene.route.length === 0) failures.push(`${code}: route 空`)
        // 内容シーンは必ず beats>0、複合は必ず beats=0。逆は退行。
        if (hasText(code) && scene.beats.length === 0)
          failures.push(`${code}: 内容シーンなのに beats 空（退行）`)
        if (!hasText(code) && scene.beats.length > 0)
          failures.push(`${code}: 複合シーンなのに beats あり`)
        for (const [i, b] of scene.beats.entries())
          if (b.kind === 'line' && b.who.trim().length === 0)
            failures.push(`${code} beat#${i}: line の who が空`)
        beatTotal += scene.beats.length
      } catch (e) {
        failures.push(`${code}: build 例外 ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
    expect(beatTotal).toBeGreaterThan(10000) // 空振り番兵（実測 17431）
  })
})
