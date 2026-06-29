import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import sceneIndexJson from '@data/scene-index.json'
import { Flow, SceneIndex } from '@/pipeline/types'
import { buildSceneGraph, sceneSummary, shortSceneCode } from './scenegraph'

const flow = Flow.parse(flowJson)
const index = SceneIndex.parse(sceneIndexJson)

describe('shortSceneCode — 短縮表示コード', () => {
  it.each([
    ['001_PRO001A', '001A'],
    ['002_AYAN001A', '001A'],
    ['006_TUBA001B2', '001B2'],
    ['012_SUBTM007C', '007C'],
    ['002_AYAN011A2', '011A2'],
  ])('%s → %s', (code, expected) => {
    expect(shortSceneCode(code)).toBe(expected)
  })
})

describe('sceneSummary — 生 title からひと言概要を抽出', () => {
  it('\\N 区切りは最後のセグメント（キャラ/章名の接頭辞を落とす）', () => {
    expect(sceneSummary('幼少回想\\N三人')).toBe('三人')
    expect(sceneSummary('古橋綾菜\\N喫茶店へ')).toBe('喫茶店へ')
  })
  it('\\N が無ければ全体、空なら空文字', () => {
    expect(sceneSummary('プロローグ')).toBe('プロローグ')
    expect(sceneSummary('')).toBe('')
    expect(sceneSummary('   ')).toBe('')
  })
})

describe('buildSceneGraph — arc CFG → シーン単位グラフ', () => {
  const g = buildSceneGraph(flow, index, 'jp')

  it('start ノードは生成されない（要件④）', () => {
    expect(g.nodes.some((n) => n.id === 'start')).toBe(false)
    expect(g.edges.some((e) => e.source === 'start' || e.target === 'start')).toBe(false)
  })

  it('arc の全シーンが1ノードずつ展開される（重複なし）', () => {
    const sceneNodes = g.nodes.filter((n) => n.kind === 'scene')
    const distinctScenes = new Set(
      flow.nodes.filter((n) => n.kind === 'arc').flatMap((n) => n.scenes),
    )
    expect(sceneNodes.length).toBe(distinctScenes.size)
    expect(new Set(sceneNodes.map((n) => n.id)).size).toBe(sceneNodes.length)
  })

  it('hub(分岐)/end ノードはノードとして残置し、カテゴリが付く', () => {
    const mix01 = g.nodes.find((n) => n.id === 'SMAIN_MIX01')
    expect(mix01).toMatchObject({ kind: 'branch', category: 'branch' })
    const end = g.nodes.find((n) => n.id === 'NORMAL_END')
    expect(end).toMatchObject({ kind: 'end', category: 'end' })
  })

  it('シーンノードはフルコード id と概要を持つ', () => {
    const first = g.nodes.find((n) => n.id === '001_PRO001A')!
    expect(first.id).toBe('001_PRO001A') // フル番号はノードの id
    expect(first.title).toBe('三人') // "幼少回想\\N三人" の概要
  })

  it('arc 内は連鎖エッジ s_i→s_{i+1} で繋がる（受入: 001_PRO001A の連鎖）', () => {
    const arc = flow.nodes.find((n) => n.id === '001_PRO001A')!
    for (let i = 1; i < arc.scenes.length; i++) {
      const prev = arc.scenes[i - 1]
      const cur = arc.scenes[i]
      expect(g.edges.some((e) => e.source === prev && e.target === cur)).toBe(true)
    }
  })

  it('構造エッジは arc 末尾発・先頭着に張り替わる（受入: 選択肢分岐が末尾シーン発）', () => {
    // node 001_PRO001A の末尾シーン 006_TUBA001B（選択肢シーン）から分岐先へラベル付きエッジ。
    const e1 = g.edges.find((e) => e.source === '006_TUBA001B' && e.target === '006_TUBA001B2')
    expect(e1?.label).toBe('後悔して、すぐに止める')
    const e2 = g.edges.find((e) => e.source === '006_TUBA001B' && e.target === '006_TUBA001C')
    expect(e2?.label).toBe('背徳に溺れて、このまま続ける')
  })

  it('hub への合流エッジが残る（受入: SMAIN_* を指すエッジが存在）', () => {
    expect(g.edges.some((e) => e.target.startsWith('SMAIN_'))).toBe(true)
  })

  it('全エッジの端点が実在ノードを指す', () => {
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  it('エッジ id は一意', () => {
    const ids = g.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('locale=cn でシーン見出しが中国語に切り替わる（構造は不変）', () => {
    const cn = buildSceneGraph(flow, index, 'cn')
    expect(cn.nodes.length).toBe(g.nodes.length)
    expect(cn.edges.length).toBe(g.edges.length)
    expect(cn.nodes.find((n) => n.id === '002_AYAN001A')!.title).toBe('去咖啡馆')
  })

  it('分岐辺は branch=true＋着地先カテゴリ／連鎖辺は continue で無印（要件③）', () => {
    const branchEdge = g.edges.find(
      (e) => e.source === '006_TUBA001B' && e.target === '006_TUBA001C',
    )!
    expect(branchEdge.branch).toBe(true)
    expect(branchEdge.variant).toBe('structural')
    expect(branchEdge.category).toBe('tuba') // 006_TUBA001C は翼
    const chain = g.edges.find((e) => e.variant === 'continue')!
    expect(chain.branch).toBe(false)
    expect(chain.label).toBeUndefined()
  })

  it('分岐辺ラベルが locale=cn で中国語に追従（受入）', () => {
    const cn = buildSceneGraph(flow, index, 'cn')
    const e = cn.edges.find((x) => x.source === '006_TUBA001B' && x.target === '006_TUBA001C')!
    expect(e.label).toBe('沉溺于背德，继续下去') // jp「背徳に溺れて、このまま続ける」の cn
  })
})
