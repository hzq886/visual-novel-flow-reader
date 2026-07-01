/**
 * GroupNode — タイトル群のコンテナ（HU-51）。題を持つ head シーンと、そこに連なる題なし継続
 * シーンを囲む半透明の角丸枠。左上にエピソード見出し（head の題）を表示する。
 * 背景として最背面に置く非対話ノード（クリックは内側のシーンノードが受ける）。
 */
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CATEGORY_COLOR, type Category } from './category'

export type GroupNodeData = {
  title: string
  category: Category
}

export function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData
  const color = CATEGORY_COLOR[d.category] ?? CATEGORY_COLOR.common
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 16,
        border: `1.5px solid ${color}66`,
        background: `${color}0f`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.02)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 14,
          color: `${color}`,
          fontSize: 12.5,
          fontWeight: 800,
          letterSpacing: 0.3,
          textShadow: '0 1px 3px rgba(0,0,0,.6)',
          maxWidth: 'calc(100% - 28px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {d.title}
      </div>
      {/* React Flow が type 付きノードに要求する最小限のハンドル（非表示・接続なし）。TB では上下。 */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} isConnectable={false} />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
    </div>
  )
}
