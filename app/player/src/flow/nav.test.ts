import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import { Flow } from '@/pipeline/types'
import { FlowNav } from './nav'

const flow = Flow.parse(flowJson)
const nav = new FlowNav(flow)

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
