import { describe, it, expect } from 'vitest'
import { parseScene } from './scene'
import { Scene } from './types'

// 全シーン回帰（HU-25）: 縦串 1 シーンから全編へスケールした際、parseScene が
// 002 以外の記法（複数話者・特殊 note・地の文のみ・長尺）でこけないことを担保する。
// data_extract/text は git 管理下（CI で参照可）。Vite の glob で jp 全 .txt を生取込し、
// 数字始まり（＝実シーン）だけを対象にする（_SPRSET/_DEF/SMAIN 等の定義・システムは除外）。
const raws = import.meta.glob('../../../../data_extract/text/md_scr_text_jp/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const scenes = Object.entries(raws)
  .map(([path, raw]) => ({
    code: path
      .split('/')
      .pop()!
      .replace(/\.txt$/, ''),
    raw,
  }))
  .filter((s) => /^[0-9]/.test(s.code))
  .sort((a, b) => a.code.localeCompare(b.code))

// 本文 [text] を持つ＝再生対象の「内容シーン」。持たず [id] 参照のみ＝「複合シーン」
// （例 006_TUBA010BC = 010B+010C を束ねる連結子。flow は構成アトムを参照し複合は辿らない）。
const hasText = (raw: string) => /\[text\]/.test(raw)

describe('parseScene — 全シーン invariant（全編化の回帰防止）', () => {
  it('コーパス構成: 実シーン数・内容/複合の内訳が一致する', () => {
    const content = scenes.filter((s) => hasText(s.raw))
    const composite = scenes.filter((s) => !hasText(s.raw))
    // 定義/システムファイル（_SPRSET 等）を除いた実シーン数。コーパス変化時はこの数を更新する。
    expect(scenes.length).toBe(319)
    expect(content.length).toBe(288) // build-scenes が data/scenes/*.json に出力する数
    expect(composite.length).toBe(31) // 0 beat の連結子（出力対象外）
  })

  it('全シーンが parse でき、スキーマ適合・基本不変条件を満たす', () => {
    const failures: string[] = []
    let beatTotal = 0
    for (const { code, raw } of scenes) {
      try {
        const scene = parseScene(raw, { code, locale: 'jp' })
        Scene.parse(scene) // zod スキーマ適合
        if (scene.code !== code) failures.push(`${code}: code 不一致 (${scene.code})`)
        if (scene.route.length === 0) failures.push(`${code}: route 空`)

        // beats 数と本文有無の対応を検証（スケール時の破綻番兵）:
        // 内容シーン([text]あり)は必ず beats>0、複合シーン([text]なし)は必ず beats=0。
        // 逆＝「[text] があるのに 0 beat」は parser 退行なので失敗させる。
        if (hasText(raw) && scene.beats.length === 0)
          failures.push(`${code}: [text] があるのに beats 空（parser 退行）`)
        if (!hasText(raw) && scene.beats.length > 0)
          failures.push(`${code}: [text] 無しなのに beats あり（複合判定の崩れ）`)

        for (const [i, b] of scene.beats.entries()) {
          if (b.kind === 'line' && b.who.trim().length === 0)
            failures.push(`${code} beat#${i}: line の who が空`)
        }
        beatTotal += scene.beats.length
      } catch (e) {
        failures.push(`${code}: parse 例外 ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
    // beats が一定規模あること（空振りで全件 0 beat になっていないかの番兵）。
    expect(beatTotal).toBeGreaterThan(10000)
  })
})
