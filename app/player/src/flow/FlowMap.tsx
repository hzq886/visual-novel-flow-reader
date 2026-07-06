/**
 * FlowMap — React Flow（@xyflow/react）でルート分岐図を描画する。
 * data/flow.json（arc 単位 CFG）を scenegraph で **1シーン=1ノード** に展開し、dagre で自動レイアウト、
 * カテゴリ別配色（category.ts の9分類）の SceneNode／ラベル付きエッジ＋凡例（Legend）を表示する。
 * 再生中シーン（usePlayer.scene）のノードを金枠でハイライトしてストーリー進行と連動させる。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import flowJson from '@data/flow.json'
import sceneIndexJson from '@data/scene-index.json'
import { Flow, SceneIndex } from '@/pipeline/types'
import { usePlayer } from '@/store/player'
import { useBookmarks } from '@/store/bookmarks'
import { CATEGORY_COLOR, type Category } from './category'
import { Legend } from './Legend'
import { SceneNode, type SceneNodeData } from './SceneNode'
import { GroupNode, type GroupNodeData } from './GroupNode'
import { SCENE_SIZE, HUB_SIZE, END_SIZE } from './nodeSize'
import {
  buildOmakeNodes,
  buildSceneGraph,
  groupScenes,
  OMAKE_GROUP_TITLE,
  type SceneGraph,
  type SceneGraphEdge,
  type SceneGraphNode,
} from './scenegraph'
import { layoutGraph, layoutOmakeBox, type GroupBox } from './layout'

const flow = Flow.parse(flowJson)
const sceneIndex = SceneIndex.parse(sceneIndexJson)

// ノード種別ごとの寸法（scene / end / それ以外）。layout と初期ビュー基点で共有。
const nodeSizeOf = (n: SceneGraphNode) =>
  n.kind === 'scene' ? SCENE_SIZE : n.kind === 'end' ? END_SIZE : HUB_SIZE

// 構造（ノード集合・エッジ・グループ）は locale 不変なので、レイアウトは一度だけ計算して使い回す。
// 見出し文字列のみ locale 依存（描画時に現 locale の題へ差し替える）。
const baseGraph = buildSceneGraph(flow, sceneIndex, 'jp')
const groups = groupScenes(baseGraph)
const { positions, groupBoxes } = layoutGraph(baseGraph, nodeSizeOf, {}, groups)
// おまけ（009_NUKE）枠（HU-57）: 本編と非接続の独立コンテンツを本編 bbox の右隣へ分離配置する。
// 構造・配置は locale 不変なので一度だけ計算し、共有 positions へ合流（題のみ描画時に locale 適用）。
// startCenterX は baseGraph.nodes 起点なので初期ビュー基点（HU-53）には影響しない。
const omakeLayout = layoutOmakeBox(baseGraph, positions, nodeSizeOf, buildOmakeNodes('jp'))
for (const [id, p] of omakeLayout.positions) positions.set(id, p)
// TB レイアウトの初期表示基点（HU-53）: 最上段ノードの中心。ここを画面上部に据え、
// zoom=1（等倍・可読）で表示 → ユーザは下方向へスクロール（パン）して残りを辿る。
// 全体 fitView はしない（縮小して全ノードを一望にしない）。
const startCenterX = (() => {
  let topY = Infinity
  let cx = 0
  for (const n of baseGraph.nodes) {
    const p = positions.get(n.id)
    if (!p) continue
    const s = nodeSizeOf(n)
    if (p.y < topY) {
      topY = p.y
      cx = p.x + s.width / 2
    }
  }
  return { cx, topY: topY === Infinity ? 0 : topY }
})()

// メンバー id → 属する群（コンテナ見出し差し替え・grouped フラグ用）。
const groupByMember = new Map<string, (typeof groups)[number]>()
for (const g of groups) for (const m of g.memberIds) groupByMember.set(m, g)
// 群 head の category（コンテナの配色）。
const headCategory = new Map(
  groups.map((g) => [g.id, baseGraph.nodes.find((n) => n.id === g.headId)?.category ?? 'common']),
)

// nodeTypes はモジュールレベルで安定参照にする（毎レンダー再生成すると React Flow が警告）。
const nodeTypes = { flowNode: SceneNode, groupBox: GroupNode }

// おまけ枠のコンテナノード（HU-57）。見出しは固定「おまけ」（Legend 同様 jp のみ）、枠色は中立の共通色
// （内側ノードが話者ルート色を持つため）。groups 由来ではないので rfGroupNodes とは別に生成する。
function rfOmakeGroupNode(): Node<GroupNodeData> {
  const b = omakeLayout.box
  return {
    id: b.id,
    type: 'groupBox',
    position: { x: b.x, y: b.y },
    width: b.width,
    height: b.height,
    draggable: false,
    selectable: false,
    zIndex: 0,
    data: { title: OMAKE_GROUP_TITLE, category: 'common' },
  }
}

// コンテナノードは最背面（配列先頭・低 zIndex）に置き、内側のシーンノードがクリックを受ける。
function rfGroupNodes(graph: SceneGraph): Node<GroupNodeData>[] {
  const titleById = new Map(graph.nodes.map((n) => [n.id, n.title]))
  return groupBoxes.map((b: GroupBox) => {
    const g = groups.find((gg) => gg.id === b.id)!
    return {
      id: b.id,
      type: 'groupBox',
      position: { x: b.x, y: b.y },
      width: b.width,
      height: b.height,
      draggable: false,
      selectable: false,
      zIndex: 0,
      data: {
        // 見出しは現 locale の head 題（cn 未抽出時は jp フォールバック済の graph.title）。
        title: titleById.get(g.headId) ?? g.title,
        category: headCategory.get(g.id) as Category,
      },
    }
  })
}

function rfNodes(
  graph: SceneGraph,
  liveCode: string | null,
  markedIds: ReadonlySet<string>,
): Node<SceneNodeData>[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    draggable: false,
    zIndex: 1,
    data: {
      kind: n.kind,
      category: n.category,
      title: n.title,
      live: n.id === liveCode,
      grouped: groupByMember.has(n.id),
      bookmarked: markedIds.has(n.id),
    },
  }))
}

// ズームバー（HU-58）: React Flow 既定の Controls を置き換えるピル型バー。
// [−] [現在%] [＋] [全体表示アイコン] の横並び。配置リセットは持たない（機能が無いため）。
// 全体表示アイコンは旧 Controls の fitview アイコン（@xyflow/react 同梱 SVG）を踏襲。
const zoomBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#232a37',
  border: '1px solid #38414f',
  borderRadius: 10,
  color: '#e7ecf3',
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
}

function FitViewIcon() {
  return (
    <svg width={13} height={12} viewBox="0 0 32 30" fill="#e7ecf3" aria-hidden>
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94a.919.919 0 01-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  )
}

function ZoomBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <Panel position="bottom-left">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          background: 'rgba(17,21,28,.92)',
          border: '1px solid #2a313e',
          borderRadius: 14,
          boxShadow: '0 4px 14px rgba(0,0,0,.35)',
        }}
      >
        <button
          style={zoomBtnStyle}
          onClick={() => void zoomOut({ duration: 200 })}
          aria-label="縮小"
        >
          −
        </button>
        <span
          style={{
            minWidth: 44,
            textAlign: 'center',
            color: '#9aa6b6',
            fontSize: 13,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          style={zoomBtnStyle}
          onClick={() => void zoomIn({ duration: 200 })}
          aria-label="拡大"
        >
          ＋
        </button>
        <button
          style={zoomBtnStyle}
          onClick={() => void fitView({ duration: 300 })}
          aria-label="全体表示"
        >
          <FitViewIcon />
        </button>
      </div>
    </Panel>
  )
}

// ブックマーク操作モーダル（HU-60）: アイコンのダブルクリックで開く。二択＝保存場所にジャンプ / 削除。
// 背景クリックで閉じる。ジャンプは保存位置（beat/行）へ復帰し物語ビューへ切り替える。
const modalBtnStyle: React.CSSProperties = {
  minWidth: 148,
  padding: '10px 18px',
  background: '#232a37',
  border: '1px solid #38414f',
  borderRadius: 10,
  color: '#e7ecf3',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}

function BookmarkModal({ onJump }: { onJump?: () => void }) {
  const modalCode = useBookmarks((s) => s.modalCode)
  const mark = useBookmarks((s) => (s.modalCode ? s.marks[s.modalCode] : undefined))
  // mark 不在は削除直後など（remove() が modalCode も掃除する）。描画しないだけでよい。
  if (!modalCode || !mark) return null
  const jump = () => {
    void usePlayer.getState().gotoPosition(mark.code, mark.index, mark.line)
    useBookmarks.getState().closeModal()
    onJump?.()
  }
  return (
    <div
      onClick={() => useBookmarks.getState().closeModal()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8,10,14,.6)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '20px 24px',
          background: 'rgba(17,21,28,.97)',
          border: '1px solid #2a313e',
          borderRadius: 14,
          boxShadow: '0 8px 30px rgba(0,0,0,.5)',
          minWidth: 320,
        }}
      >
        <div style={{ color: '#e7ecf3', fontSize: 15, fontWeight: 800 }}>
          🔖 {mark.code} のブックマーク
        </div>
        <div style={{ color: '#9aa6b6', fontSize: 12.5 }}>
          保存位置: {mark.index + 1}
          {mark.line > 0 ? `（頁 ${mark.line + 1}）` : ''} ・{' '}
          {new Date(mark.savedAt).toLocaleString()}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={modalBtnStyle} onClick={jump}>
            保存場所にジャンプ
          </button>
          <button
            style={{ ...modalBtnStyle, color: '#f2b8b8', borderColor: '#5a3a42' }}
            onClick={() => useBookmarks.getState().remove(mark.code)}
          >
            削除
          </button>
        </div>
      </div>
    </div>
  )
}

// エッジ意匠（Image #4）: 分岐辺＝着地先カテゴリ色で太く・ラベル強調、構造リンク＝中間グレー、
// arc 内連鎖＝淡いグレー。いずれも曲線（bezier）＋終点矢印で進行方向を示す。
function edgeStroke(e: SceneGraphEdge): string {
  // 分岐辺は着地先カテゴリ色（HU-45）。category 欠落時は共通色にフォールバック。
  if (e.branch) return CATEGORY_COLOR[e.category ?? 'common'] ?? CATEGORY_COLOR.common
  if (e.variant === 'structural') return '#46536b'
  return '#2b3340'
}

function rfEdges(graph: SceneGraph): Edge[] {
  return graph.edges.map((e) => {
    const stroke = edgeStroke(e)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      style: { stroke, strokeWidth: e.branch ? 2.4 : e.variant === 'structural' ? 2 : 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 15, height: 15 },
      labelStyle: {
        fill: e.branch ? '#fdf3df' : '#cfd6e0',
        fontSize: e.branch ? 12.5 : 11,
        fontWeight: 700,
      },
      labelBgStyle: { fill: 'rgba(12,15,21,.72)', fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      zIndex: e.branch ? 10 : 1,
    }
  })
}

export function FlowMap({ onJump }: { onJump?: () => void } = {}) {
  const sceneCode = usePlayer((s) => s.scene?.code ?? null)
  const locale = usePlayer((s) => s.locale)
  const marks = useBookmarks((s) => s.marks)

  // 見出しは locale 依存（ノード/エッジ構造は不変）。
  const graph = useMemo(() => buildSceneGraph(flow, sceneIndex, locale), [locale])
  // おまけノード（HU-57）。題（話者ベース curated）が locale 依存。エッジなし＝本編と非接続。
  const omakeGraph = useMemo<SceneGraph>(
    () => ({ nodes: buildOmakeNodes(locale), edges: [] }),
    [locale],
  )
  // ブックマーク保存済みシーン集合（HU-60。ノード右のアイコン表示用）。
  const markedIds = useMemo(() => new Set(Object.keys(marks)), [marks])

  // FlowMap コンテナの実寸参照。水平中央寄せは window ではなくこの幅基準で計算する
  // （HU-52 でアプリが 16:9 枠に収まると FlowMap 幅 < window 幅になるため）。
  const containerRef = useRef<HTMLDivElement>(null)

  // コンテナ（groupBox）を配列先頭＝最背面に、シーン/hub/おまけノードを前面に重ねる。
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([
    ...rfGroupNodes(graph),
    rfOmakeGroupNode(),
    ...rfNodes(graph, sceneCode, markedIds),
    ...rfNodes(omakeGraph, sceneCode, markedIds),
  ])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges(graph))

  // 再生中シーンの変化／言語切替／ブックマーク増減で、ノード（ハイライト・見出し・アイコン）と
  // エッジ（ラベル）を更新。
  useEffect(() => {
    setNodes([
      ...rfGroupNodes(graph),
      rfOmakeGroupNode(),
      ...rfNodes(graph, sceneCode, markedIds),
      ...rfNodes(omakeGraph, sceneCode, markedIds),
    ])
    setEdges(rfEdges(graph))
  }, [graph, omakeGraph, sceneCode, markedIds, setNodes, setEdges])

  // 再生中シーンのノードをビューポート中央へ据える（HU-59）。位置が引けなければ false。
  // positions は本編＋おまけ統合済みなので 009_NUKE でも動く。live になるのは scene ノードのみ
  // （end/hub は再生対象外）なので寸法は SCENE_SIZE 固定でよい。
  const centerOnLive = useCallback((rf: ReactFlowInstance<Node, Edge>, code: string): boolean => {
    const p = positions.get(code)
    if (!p) return false
    const ZOOM = 1
    const el = containerRef.current
    const width = el?.clientWidth ?? window.innerWidth
    const height = el?.clientHeight ?? window.innerHeight
    rf.setViewport({
      x: width / 2 - (p.x + SCENE_SIZE.width / 2) * ZOOM,
      y: height / 2 - (p.y + SCENE_SIZE.height / 2) * ZOOM,
      zoom: ZOOM,
    })
    return true
  }, [])

  // 初期ビュー: 再生中シーンがあればそのノードを中央に（HU-59＝物語から Tab で戻ったケース）。
  // 未再生なら最上段ノードをコンテナ上部・水平中央へ等倍で据える（HU-53）。以降はユーザが
  // 下へパン/スクロールして辿る。座標は明示ズーム基準（*INIT_ZOOM）で計算するのでどのタイミングで
  // 適用しても中央がずれない。水平中央は FlowMap コンテナ実幅基準（HU-52 の 16:9 枠内でも正しい）。
  const applyInitialView = useCallback(
    (rf: ReactFlowInstance<Node, Edge>) => {
      const live = usePlayer.getState().scene?.code ?? null
      if (live && centerOnLive(rf, live)) return
      const INIT_ZOOM = 1 // 等倍・可読サイズ。
      const topPad = 96 // 上端の見出し（Legend）下に最上段ノードを収める余白。
      const width = containerRef.current?.clientWidth ?? window.innerWidth
      rf.setViewport({
        x: width / 2 - startCenterX.cx * INIT_ZOOM,
        y: topPad - startCenterX.topY * INIT_ZOOM,
        zoom: INIT_ZOOM,
      })
    },
    [centerOnLive],
  )

  // onInit 直後の setViewport は React Flow の初期フィットに上書きされ得るため、描画確定後
  // （rAF 2 フレーム）に再適用して確実に定着させる。インスタンスは起動直後の中央寄せ直し
  // （下の effect・HU-59）でも使うため ref に保持する。
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const onInit = useCallback(
    (rf: ReactFlowInstance<Node, Edge>) => {
      rfRef.current = rf
      applyInitialView(rf)
      requestAnimationFrame(() => requestAnimationFrame(() => applyInitialView(rf)))
    },
    [applyInitialView],
  )

  // 起動直後（初期ビュー＝ルート図・HU-58）は開始シーンのロードが onInit より遅れ得る。
  // マウント時に未再生だった場合のみ、最初のシーン確定時に一度だけ中央へ寄せ直す
  // （以降のシーン変化ではユーザのパンを乱さないためビューポートを動かさない）。
  const liveCentered = useRef<boolean>(usePlayer.getState().scene !== null)
  useEffect(() => {
    if (liveCentered.current || !sceneCode || !rfRef.current) return
    liveCentered.current = true
    centerOnLive(rfRef.current, sceneCode)
  }, [sceneCode, centerOnLive])

  // シーンノードのクリックで物語をそのシーン先頭へスキップし、物語ビューへ戻す（HU-46）。
  // hub(分岐)/end/omake・コンテナは再生対象シーンが無いので無視する。
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if ((node.data as SceneNodeData).kind !== 'scene') return
      void usePlayer.getState().gotoScene(node.id)
      onJump?.()
    },
    [onJump],
  )

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 5,
          maxWidth: 'calc(100% - 28px)',
        }}
      >
        <Legend />
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onInit={onInit}
        nodesDraggable={false}
        minZoom={0.2}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        // ブックマークアイコンのダブルクリック（HU-60）が誤ってズームに化けないよう無効化。
        zoomOnDoubleClick={false}
        style={{ background: '#13161c' }}
      >
        <Background color="#222834" gap={26} />
        {/* MiniMap はダーク UI（bgColor＝盤面と同系の暗色・HU-58）。 */}
        <MiniMap
          pannable
          zoomable
          bgColor="#10141b"
          nodeColor={(n) =>
            n.type === 'groupBox'
              ? 'rgba(255,255,255,.06)'
              : (CATEGORY_COLOR[(n.data as SceneNodeData).category as Category] ??
                CATEGORY_COLOR.common)
          }
          maskColor="rgba(8,10,14,.65)"
          style={{ border: '1px solid #2a313e', borderRadius: 8, overflow: 'hidden' }}
        />
        <ZoomBar />
      </ReactFlow>
      {/* ブックマーク操作モーダル（HU-60）。アイコンのダブルクリックで開く。 */}
      <BookmarkModal onJump={onJump} />
    </div>
  )
}
