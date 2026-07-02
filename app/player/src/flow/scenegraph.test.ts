import { describe, expect, it } from 'vitest'
import flowJson from '@data/flow.json'
import sceneIndexJson from '@data/scene-index.json'
import { Flow, SceneIndex } from '@/pipeline/types'
import {
  buildOmakeNodes,
  buildSceneGraph,
  groupScenes,
  OMAKE_SCENES,
  sceneSummary,
  shortSceneCode,
  type SceneGraph,
  type SceneGraphNode,
} from './scenegraph'

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

  it('hub は畳まれ、ノーマルENDは分割・スタッフロールは削除（HU-55/56）', () => {
    expect(g.nodes.some((n) => n.id.startsWith('SMAIN_'))).toBe(false)
    expect(g.nodes.some((n) => n.kind === 'branch')).toBe(false)
    expect(g.nodes.some((n) => n.id === 'NORMAL_END')).toBe(false) // 個別エンドへ分割
    expect(g.nodes.some((n) => n.id === 'STAFF_ROLL')).toBe(false) // 削除
    expect(g.nodes.some((n) => n.kind === 'omake')).toBe(false)
    expect(g.nodes.find((n) => n.id === 'TRUE_END')).toMatchObject({ kind: 'end' })
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

  it('hub 宛/発のエッジは残らず、合流は継続先の実シーンへ張り替わる（HU-55 受入）', () => {
    expect(
      g.edges.some((e) => e.source.startsWith('SMAIN_') || e.target.startsWith('SMAIN_')),
    ).toBe(false)
    // TUBA03 合流: 002E 経路・002C 経路がともに実シーン 006_TUBA002F へ直結する。
    expect(g.edges.some((e) => e.source === '006_TUBA002E' && e.target === '006_TUBA002F')).toBe(
      true,
    )
    expect(g.edges.some((e) => e.source === '006_TUBA002C' && e.target === '006_TUBA002F')).toBe(
      true,
    )
  })

  it('選択肢の分岐ラベルは hub を畳んでも継続先の実シーンへの辺に移設される（HU-55 受入）', () => {
    // 002_AYAN008A（arc 002_AYAN007A 末尾）の選択肢「特に贔屓はしない」→ 旧 SMAIN_SUZU01 → 003_SUZU006A。
    const e = g.edges.find((x) => x.source === '002_AYAN008A' && x.target === '003_SUZU006A')!
    expect(e.label).toBe('特に贔屓はしない')
    expect(e.branch).toBe(true)
  })

  it('hub 直後の題なし arc 先頭シーンが単独の裸コードにならず群に吸収される（HU-55 受入）', () => {
    // 旧 SMAIN_TUBA03 直後の 006_TUBA002F は題なしだが、畳み込みで 002E/002C（題あり）と直結し
    // タイトル群に吸収される（どの群にも属さない単独状態にならない）。
    const groups = groupScenes(g)
    const owned = new Set(groups.flatMap((x) => x.memberIds))
    for (const code of ['006_TUBA002F', '006_TUBA002G', '005_MAKO001E', '003_SUZU006A']) {
      expect(owned.has(code)).toBe(true)
    }
  })

  it('ノーマルENDが攻略準拠の12個別エンドノードに分割される（HU-56）', () => {
    const ends = g.nodes.filter((n) => n.kind === 'end')
    // 12 分割エンド + TRUE_END = 13。
    expect(ends.length).toBe(13)
    const byArc = (arc: string) => g.nodes.find((n) => n.id === `END_${arc}`)
    expect(byArc('004_FUTA004A')).toMatchObject({
      kind: 'end',
      category: 'end',
      title: '綾菜＆涼菜 END【妊婦になった姉たち】',
    })
    expect(byArc('006_TUBA018A')?.title).toBe('翼 END3【喪失】')
    expect(byArc('012_SUBTM004A')?.title).toBe('翼 END1【ゲームの結果】')
    // 各ルート末尾から個別エンドへ辺が張られる（綾菜END1: 002_AYAN012B → END_002_AYAN010B）。
    expect(
      g.edges.some((e) => e.source === '002_AYAN012B' && e.target === 'END_002_AYAN010B'),
    ).toBe(true)
    // 006_TUBA018B は 翼END3 と TRUE_END の双方へ分岐する。
    expect(
      g.edges.some((e) => e.source === '006_TUBA018B' && e.target === 'END_006_TUBA018A'),
    ).toBe(true)
    expect(g.edges.some((e) => e.target === 'TRUE_END')).toBe(true)
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

  it('題ありシーンに titled=true、題なし継続シーンは false（フォールバック表示）', () => {
    expect(g.nodes.find((n) => n.id === '006_TUBA001B')!.titled).toBe(true)
    expect(g.nodes.find((n) => n.id === '006_TUBA001C')!.titled).toBe(false)
  })
})

describe('groupScenes — タイトル群（HU-51）', () => {
  const g = buildSceneGraph(flow, index, 'jp')
  const groups = groupScenes(g)

  it('虚ろ目キス群: head=006_TUBA001B に題なし継続 001C/001E/002A を取り込み、見出しは head の題', () => {
    const grp = groups.find((x) => x.headId === '006_TUBA001B')!
    expect(grp.title).toBe('虚ろ目キス')
    expect(grp.id).toBe('grp-006_TUBA001B')
    expect(grp.memberIds[0]).toBe('006_TUBA001B') // head が先頭
    expect(new Set(grp.memberIds)).toEqual(
      new Set(['006_TUBA001B', '006_TUBA001C', '006_TUBA001E', '006_TUBA002A']),
    )
  })

  it('自前の題を持つ 006_TUBA001B2（キスへの後悔）は群外（メンバーにならない）', () => {
    for (const grp of groups) expect(grp.memberIds).not.toContain('006_TUBA001B2')
  })

  it('全メンバーは一意（題なしシーンが複数群に二重所属しない）', () => {
    const all = groups.flatMap((x) => x.memberIds.slice(1)) // head 以外
    expect(new Set(all).size).toBe(all.length)
  })

  it('メンバーを持たない単独 head は群化しない', () => {
    expect(groups.every((x) => x.memberIds.length >= 2)).toBe(true)
  })

  // --- 合成グラフでアルゴリズム挙動を検証 ---
  const node = (id: string, titled: boolean): SceneGraphNode => ({
    id,
    kind: 'scene',
    category: 'common',
    title: titled ? id : '00',
    titled,
  })
  const hub = (id: string): SceneGraphNode => ({
    id,
    kind: 'branch',
    category: 'common',
    title: id,
  })
  const edge = (s: string, t: string): SceneGraph['edges'][number] => ({
    id: `${s}-${t}`,
    source: s,
    target: t,
    variant: 'structural',
    branch: false,
  })

  it('別題シーン・hub で停止する（題なしは直前の題 head に属し、hub 越えは取り込まない）', () => {
    const graph: SceneGraph = {
      nodes: [node('H', true), node('a', false), node('b', false), hub('HUB'), node('c', false)],
      edges: [edge('H', 'a'), edge('a', 'b'), edge('b', 'HUB'), edge('HUB', 'c')],
    }
    const grp = groupScenes(graph)
    expect(grp).toHaveLength(1)
    expect(new Set(grp[0].memberIds)).toEqual(new Set(['H', 'a', 'b']))
    // hub 越しの c はどの群にも属さない（単独）。
    expect(grp[0].memberIds).not.toContain('c')
  })

  it('合流する題なしは最近接 head に属する（距離が近い方が勝つ）', () => {
    // H1→x→t（距離2）と H2→t（距離1）。t は H2 に属する。
    const graph: SceneGraph = {
      nodes: [node('H1', true), node('H2', true), node('x', false), node('t', false)],
      edges: [edge('H1', 'x'), edge('x', 't'), edge('H2', 't')],
    }
    const grp = groupScenes(graph)
    const owner = grp.find((x) => x.memberIds.includes('t'))!
    expect(owner.headId).toBe('H2')
  })
})

describe('buildOmakeNodes — おまけ（009_NUKE）ノード合成（HU-57）', () => {
  it('6 シーン全てを kind=scene（クリック再生可）で返す', () => {
    const nodes = buildOmakeNodes('jp')
    expect(nodes.map((n) => n.id)).toEqual([
      '009_NUKE001',
      '009_NUKE002',
      '009_NUKE003',
      '009_NUKE004',
      '009_NUKE005',
      '009_NUKE006',
    ])
    for (const n of nodes) expect(n.kind).toBe('scene')
  })

  it('おまけシーンは本編 flow.json に現れない（SMAIN 非参照＝独立コンテンツの前提確認）', () => {
    const mainScenes = new Set(flow.nodes.flatMap((n) => n.scenes))
    for (const s of OMAKE_SCENES) expect(mainScenes.has(s.code)).toBe(false)
  })

  it('題は話者ベースの curated 題で locale 依存（jp/cn）', () => {
    const jp = buildOmakeNodes('jp')
    const cn = buildOmakeNodes('cn')
    expect(jp[0].title).toBe('綾菜＆涼菜')
    expect(cn[0].title).toBe('绫菜＆凉菜')
    expect(jp[3].title).toBe('翼＆和樹')
    expect(cn[3].title).toBe('翼＆和树')
  })

  it('配色は話者のルート色（綾菜＆涼菜ペアは FUTA と同じ merge）', () => {
    const cat = new Map(buildOmakeNodes('jp').map((n) => [n.id, n.category]))
    expect(cat.get('009_NUKE001')).toBe('merge')
    expect(cat.get('009_NUKE002')).toBe('mako')
    expect(cat.get('009_NUKE003')).toBe('mako')
    expect(cat.get('009_NUKE004')).toBe('tuba')
    expect(cat.get('009_NUKE005')).toBe('ayan')
    expect(cat.get('009_NUKE006')).toBe('suzu')
  })
})
