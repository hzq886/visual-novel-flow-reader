/**
 * theme — アプリ全体で共有する見た目の定数。
 * フォントは locale 別に同梱フォントを使う（jp=Zen Kaku Gothic New / cn=Alibaba PuHuiTi 3。
 * 字形を正しく出すため和文と簡体字で書体を分ける）。@font-face は index.css、実体は public/fonts。
 * 同梱が読めない環境では system のゴシックにフォールバックする。
 */
const FALLBACK = "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', Meiryo, sans-serif"

/** 日本語（jp ロケール）用フォントスタック。 */
export const FONT_JP = `'Zen Kaku Gothic New', ${FALLBACK}`
/** 中国語簡体字（cn ロケール）用フォントスタック。 */
export const FONT_CN = `'Alibaba PuHuiTi 3', 'PingFang SC', 'Microsoft YaHei', ${FALLBACK}`
/** DOM クロム（カウンタ/ボタン等、jp/cn 混在）用。両書体を並べる。 */
export const UI_FONT = `'Zen Kaku Gothic New', 'Alibaba PuHuiTi 3', ${FALLBACK}`

/** locale に応じた本文フォントスタックを返す（字幕・題字で使用）。 */
export const fontFor = (locale: string): string => (locale === 'cn' ? FONT_CN : FONT_JP)

/** 話者名・題字のアクセント色（金）。 */
export const GOLD = 0xe9c07a
