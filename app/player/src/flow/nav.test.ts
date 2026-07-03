import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import sceneIndexJson from '@data/scene-index.json'
import { Flow, SceneIndex } from '@/pipeline/types'
import { FlowNav } from './nav'

const flow = Flow.parse(flowJson)
const nav = new FlowNav(flow, SceneIndex.parse(sceneIndexJson))

describe('FlowNav — flow 駆動のシーン遷移', () => {
  it('firstScene は start を辿って実在の開始シーンを返す', () => {
    const first = nav.firstScene()
    expect(first).toMatch(/^\d{3}_[A-Z]/)
    // start ノードは scenes 空なので、エッジ先の実シーンに解決されている。
    expect(flow.nodes.some((n) => n.scenes.includes(first!))).toBe(true)
  })

  it('ノード内に複数シーンがあれば逐次進行（005_MAKO003A → 003B）', () => {
    const node = flow.nodes.find((n) => n.scenes.includes('005_MAKO003A'))
    // 前提: 005_MAKO003A は分岐点ではなく、同一ノードに続きがある。
    expect(node?.scenes).toContain('005_MAKO003B')
    expect(nav.advance('005_MAKO003A')).toEqual({ kind: 'scene', code: '005_MAKO003B' })
  })

  it('分岐点シーンでは選択肢を返す（005_MAKO001A の軸2分岐）', () => {
    const step = nav.advance('005_MAKO001A')
    expect(step.kind).toBe('choice')
    if (step.kind !== 'choice') return
    expect(step.options.map((o) => o.label)).toEqual([
      '人のことは言えない',
      '血が出そうなほど、唇を強く噛む。',
    ])
    // '血が…' は 005_MAKO001B ノードへ → その先頭シーンに解決される。
    const toMako = step.options.find((o) => o.label.startsWith('血が'))
    expect(toMako?.target).toMatch(/^005_MAKO001B/)
    expect(toMako?.cn).toBe('咬紧嘴唇，几乎要出血了。')
  })

  it('未知シーンは end', () => {
    expect(nav.advance('ZZZ_NONE001A')).toEqual({ kind: 'end' })
  })

  it('おまけ（009_NUKE）は flow 外＝再生終了で end（単発・連鎖しない。HU-57）', () => {
    expect(nav.advance('009_NUKE001')).toEqual({ kind: 'end' })
    expect(nav.advance('009_NUKE006')).toEqual({ kind: 'end' })
  })

  it('文言なしエッジ分岐は解決先が同じものをまとめる（HU-62）', () => {
    // 006_TUBA018B: NORMAL_END / TRUE_END の 2 エッジ＝どちらも終端 → 選択肢を出さず end。
    expect(nav.advance('006_TUBA018B')).toEqual({ kind: 'end' })
    // 011_SUBT001A: 直行と旧 SMAIN_TUBAMAKO06 経由が同一シーンへ解決 → 自動進行。
    expect(nav.advance('011_SUBT001A')).toEqual({ kind: 'scene', code: '006_TUBA004A' })
    // 010_MAIN003A: 6 エッジ中 4 本が 006_TUBA003A へ収束 → 実質 3 択に集約される。
    const step = nav.advance('010_MAIN003A')
    expect(step.kind).toBe('choice')
    if (step.kind !== 'choice') return
    expect(step.options.map((o) => o.target).sort()).toEqual([
      '002_AYAN005A',
      '005_MAKO003A',
      '006_TUBA003A',
    ])
  })

  it('文言なしエッジ分岐のラベルは人間可読になる（HU-61）', () => {
    // 010_MAIN003A の大分岐は curated ルート名（cn 併記）。
    const dispatch = nav.advance('010_MAIN003A')
    if (dispatch.kind !== 'choice') throw new Error('choice expected')
    const byTarget = new Map(dispatch.options.map((o) => [o.target, o]))
    expect(byTarget.get('002_AYAN005A')).toMatchObject({ label: '姉妹ルートへ', cn: '姐妹路线' })
    expect(byTarget.get('005_MAKO003A')).toMatchObject({ label: '真琴ルートへ', cn: '真琴路线' })
    expect(byTarget.get('006_TUBA003A')).toMatchObject({ label: '翼ルートへ', cn: '翼路线' })

    // それ以外は行き先シーンの題（scene-index。jp/cn 自動対応）。
    const tuba = nav.advance('006_TUBA003B')
    if (tuba.kind !== 'choice') throw new Error('choice expected')
    expect(tuba.options.map((o) => o.label).sort()).toEqual(['下着姿で休憩', '虚ろ目性的開発１'])
    expect(tuba.options.find((o) => o.target === '006_TUBA003C')?.cn).toBe('穿着内衣休息')

    // 題なしの 012_SUBTM 挿入シーンは汎用ラベル。
    const ins = nav.advance('006_TUBA003E')
    if (ins.kind !== 'choice') throw new Error('choice expected')
    expect(ins.options.find((o) => o.target === '012_SUBTM001A')).toMatchObject({
      label: '挿入シーン（翼＆真琴）',
      cn: '插入场景（翼＆真琴）',
    })

    // 生 ID（SMAIN_* / NNN_XXX）がラベルに露出する分岐が 1 つも残っていない（全 18 箇所の番兵）。
    const rawLike = (s: string) => /^(SMAIN_|NORMAL_END|TRUE_END|STAFF_ROLL|\d{3}_)/.test(s)
    for (const code of flow.nodes.flatMap((n) => n.scenes)) {
      const step = nav.advance(code)
      if (step.kind !== 'choice') continue
      for (const o of step.options) expect(rawLike(o.label), `${code} -> ${o.label}`).toBe(false)
    }
  })

  it('全 advance の scene/option.target は実在シーンを指す（到達可能性の番兵）', () => {
    const realScenes = new Set(flow.nodes.flatMap((n) => n.scenes))
    for (const code of realScenes) {
      const step = nav.advance(code)
      if (step.kind === 'scene') expect(realScenes.has(step.code)).toBe(true)
      else if (step.kind === 'choice')
        for (const o of step.options)
          expect(o.target === null || realScenes.has(o.target)).toBe(true)
    }
  })
})
