/**
 * engine/tween — Pixi Ticker 上で動く最小のトゥイーン（0→1 の正規化時間で onUpdate を呼ぶ）。
 * 返り値で途中キャンセル可能（連打で beat が変わったとき前のフェードを止める）。
 */
import type { Ticker } from 'pixi.js'

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function tween(
  ticker: Ticker,
  durationMs: number,
  onUpdate: (t: number) => void,
  onDone?: () => void,
): () => void {
  let elapsed = 0
  const step = () => {
    elapsed += ticker.deltaMS
    const t = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs)
    onUpdate(t)
    if (t >= 1) {
      ticker.remove(step)
      onDone?.()
    }
  }
  ticker.add(step)
  return () => ticker.remove(step)
}
