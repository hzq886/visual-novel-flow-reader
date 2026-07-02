/**
 * SceneNode — フロー図のシーンノード。
 * 左にカテゴリ色のアクセントバー、フルシーンコードのバッジ＋ひと言概要。
 * フル番号はノードの id（例 "001_PRO001A"）をそのまま表示する。
 * hub(分岐) / end(エンド) / omake はコードを持たないコンパクト表示。
 * ブックマーク保存済みノードは右端外にアイコンを出す（HU-60。ダブルクリックで操作モーダル）。
 */
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useBookmarks } from '@/store/bookmarks'
import { CATEGORY_COLOR, type Category } from './category'
import { SCENE_SIZE, HUB_SIZE, END_SIZE } from './nodeSize'

export type SceneNodeData = {
  kind: 'scene' | 'branch' | 'end' | 'omake'
  category: Category
  title: string
  live: boolean
  grouped?: boolean // タイトル群コンテナ内のシーンか。題は見出しに譲り、ノードはコード主体で表示（HU-51）
  bookmarked?: boolean // ブックマーク保存済みか（HU-60。右端外にアイコン表示）
}

const handleStyle = (color: string): React.CSSProperties => ({
  width: 9,
  height: 9,
  background: color,
  border: '2px solid #11141b',
})

// ブックマークアイコン（HU-60）。しおり型 SVG・金色。ノードの overflow:hidden の外に出すため
// カード外のラッパ直下に絶対配置する。シングルクリックはノードジャンプに化けないよう止め、
// ダブルクリックで操作モーダル（ジャンプ/削除）を開く。nopan/nodrag で React Flow の
// パン・ドラッグ開始も抑止する。
function BookmarkIcon({ code }: { code: string }) {
  return (
    <div
      className="nopan nodrag"
      title="ブックマーク（ダブルクリックで操作）"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        useBookmarks.getState().openModal(code)
      }}
      style={{
        position: 'absolute',
        right: -24,
        top: '50%',
        transform: 'translateY(-50%)',
        lineHeight: 0,
        cursor: 'pointer',
        zIndex: 2,
      }}
    >
      <svg width={17} height={21} viewBox="0 0 16 20">
        <path
          d="M2 1h12a1 1 0 0 1 1 1v17l-7-4.5L1 19V2a1 1 0 0 1 1-1z"
          fill="#ffd166"
          stroke="#11141b"
          strokeWidth={1.2}
        />
      </svg>
    </div>
  )
}

export function SceneNode({ id, data }: NodeProps) {
  const d = data as SceneNodeData
  const color = CATEGORY_COLOR[d.category] ?? CATEGORY_COLOR.common
  const isScene = d.kind === 'scene'
  const size = isScene ? SCENE_SIZE : d.kind === 'end' ? END_SIZE : HUB_SIZE
  const live = d.live

  // 再生中ハイライトは一律金色ではなくカテゴリ色（凡例と同色・HU-58）。
  const border = live ? color : '#2c3443'
  const shadow = live ? `0 0 0 2px ${color}, 0 0 22px 2px ${color}8c` : '0 2px 10px rgba(0,0,0,.35)'

  return (
    // 外側ラッパ: overflow を切らない（ハンドルとブックマークアイコンをカード外へ出すため）。
    <div style={{ position: 'relative', width: size.width, minHeight: size.height }}>
      {/* TB レイアウト（HU-53）: 辺は上から入り下から出る。 */}
      <Handle type="target" position={Position.Top} style={handleStyle(color)} />

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          minHeight: size.height,
          background: 'linear-gradient(180deg,#1d2433,#161b26)',
          border: `1px solid ${border}`,
          borderRadius: 12,
          boxShadow: shadow,
          overflow: 'hidden',
          // シーンノードはクリックで物語をそのシーンへスキップできる（HU-46）。
          cursor: isScene ? 'pointer' : 'default',
        }}
      >
        {/* カテゴリ色アクセントバー */}
        <div style={{ width: 5, background: color, flex: '0 0 auto' }} />

        {isScene ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 12px 8px 10px',
              minWidth: 0,
              flex: 1,
            }}
          >
            {/* フルシーンコード（ノードの id） */}
            <span
              style={{
                flex: '0 0 auto',
                padding: '2px 7px',
                borderRadius: 6,
                background: '#0f131b',
                color: '#9aa6b6',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: 0.3,
              }}
            >
              {id}
            </span>
            {/* ひと言概要（グループ内は見出しをコンテナに譲るので非表示） */}
            {!d.grouped && (
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: live ? '#ffffff' : '#e7ecf3',
                  fontSize: 13,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={d.title}
              >
                {d.title}
              </span>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 14px',
              flex: 1,
              color: live ? '#ffffff' : '#e7ecf3',
              fontSize: 12.5,
              fontWeight: 800,
              letterSpacing: 0.4,
              textAlign: 'center',
            }}
          >
            {d.title}
          </div>
        )}
      </div>

      {d.bookmarked && <BookmarkIcon code={id} />}

      <Handle type="source" position={Position.Bottom} style={handleStyle(color)} />
    </div>
  )
}
