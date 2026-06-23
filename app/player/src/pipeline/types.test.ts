import { describe, it, expect } from 'vitest'
import { Scene, Flow } from './types'

describe('Scene schema', () => {
  it('accepts a minimal valid scene', () => {
    const sample = {
      code: '002_AYAN001A',
      route: '002',
      locale: 'jp',
      beats: [
        { kind: 'narration', lines: ['……帰宅する途中、僕は。'] },
        {
          kind: 'line',
          who: '古橋 綾菜',
          lines: ['「あら、お帰りなさい。和くん」'],
          voice: { id: 'AYAN_002_AYAN001A_001', file: null },
        },
      ],
    }
    const parsed = Scene.parse(sample)
    expect(parsed.beats).toHaveLength(2)
    expect(parsed.beats[1]).toMatchObject({ kind: 'line', who: '古橋 綾菜' })
  })

  it('rejects an unknown beat kind', () => {
    expect(() =>
      Scene.parse({ code: 'x', route: '0', locale: 'jp', beats: [{ kind: 'bogus' }] }),
    ).toThrow()
  })
})

describe('Flow schema', () => {
  it('accepts a minimal graph', () => {
    const parsed = Flow.parse({
      nodes: [
        {
          id: 'prologue',
          kind: 'arc',
          character: 'common',
          title: 'プロローグ',
          scenes: ['001_PRO001A'],
        },
      ],
      edges: [{ source: 'prologue', target: 'hub', label: '共通ルート' }],
    })
    expect(parsed.nodes[0].id).toBe('prologue')
  })
})
