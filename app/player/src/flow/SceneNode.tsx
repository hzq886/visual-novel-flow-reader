/**
 * SceneNode — フロー図のシーンノード。
 * 左にカテゴリ色のアクセントバー、フルシーンコードのバッジ＋ひと言概要。
 * フル番号はノードの id（例 "001_PRO001A"）をそのまま表示する。
 * hub(分岐) / end(エンド) / omake はコードを持たないコンパクト表示。
 */
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CATEGORY_COLOR, type Category } from './category'
import { SCENE_SIZE, HUB_SIZE } from './nodeSize'

export type SceneNodeData = {
  kind: 'scene' | 'branch' | 'end' | 'omake'
  category: Category
  title: string
  live: boolean
  grouped?: boolean // タイトル群コンテナ内のシーンか。題は見出しに譲り、ノードはコード主体で表示（HU-51）
}

const handleStyle = (color: string): React.CSSProperties => ({
  width: 9,
  height: 9,
  background: color,
  border: '2px solid #11141b',
})

export function SceneNode({ id, data }: NodeProps) {
  const d = data as SceneNodeData
  const color = CATEGORY_COLOR[d.category] ?? CATEGORY_COLOR.common
  const isScene = d.kind === 'scene'
  const live = d.live

  const border = live ? '#ffe6a6' : '#2c3443'
  const shadow = live
    ? '0 0 0 2px #ffd166, 0 0 22px 2px rgba(255,209,102,.55)'
    : '0 2px 10px rgba(0,0,0,.35)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        width: isScene ? SCENE_SIZE.width : HUB_SIZE.width,
        minHeight: isScene ? SCENE_SIZE.height : HUB_SIZE.height,
        background: 'linear-gradient(180deg,#1d2433,#161b26)',
        border: `1px solid ${border}`,
        borderRadius: 12,
        boxShadow: shadow,
        overflow: 'hidden',
        // シーンノードはクリックで物語をそのシーンへスキップできる（HU-46）。
        cursor: isScene ? 'pointer' : 'default',
      }}
    >
      {/* 折り返しグリッド（HU-54）: 行内は左→右に流れるので、辺は左から入り右から出る。 */}
      <Handle type="target" position={Position.Left} style={handleStyle(color)} />
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
          {/* ひと言概要（グループメンバーは head のエピソード題を継承表示・HU-54） */}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: live ? '#fff3d6' : d.grouped ? '#aeb8c6' : '#e7ecf3',
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
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 14px',
            flex: 1,
            color: live ? '#fff3d6' : '#e7ecf3',
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            textAlign: 'center',
          }}
        >
          {d.title}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={handleStyle(color)} />
    </div>
  )
}
