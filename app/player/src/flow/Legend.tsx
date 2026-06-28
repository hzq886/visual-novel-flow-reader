/**
 * Legend — フロー図のカテゴリ凡例（丸ドット＋ラベルのチップ列を角丸ピル枠に収める）。
 * 配色・表示名は category.ts を単一の真実の源とする。FlowMap のオーバーレイとして表示。
 */
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from './category'

export function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 16px',
        padding: '8px 18px',
        background: 'rgba(20,24,31,.82)',
        border: '1px solid #2b3340',
        borderRadius: 999,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 18px rgba(0,0,0,.35)',
      }}
    >
      {CATEGORY_ORDER.map((c) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: '50%',
              background: CATEGORY_COLOR[c],
              boxShadow: `0 0 6px ${CATEGORY_COLOR[c]}66`,
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: '#d7dde6', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {CATEGORY_LABEL[c]}
          </span>
        </span>
      ))}
    </div>
  )
}
