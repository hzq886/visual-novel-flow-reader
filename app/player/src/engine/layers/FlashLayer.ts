/**
 * FlashLayer — 画面フラッシュ演出（EFFECT:FLASHn）。全画面の白矩形を一瞬最大不透明にして
 * フェードアウトする（催眠の「パンッ！」等のインパクト同期）。強度 n=1-3 で peak/継続を変える。
 * cg/sprite の上・字幕の下に置き、閃光中もセリフは読めるようにする（Stage のレイヤ順）。
 */
import { Container, Sprite, Texture, type Ticker } from 'pixi.js'
import { GAME_H, GAME_W } from '../assets'
import { tween } from '../tween'

// 強度別の最大不透明度と継続（index 1-3。0 は未使用のダミー）。
const PEAK = [0, 0.55, 0.78, 1.0]
const DURATION_MS = [0, 260, 360, 480]

export class FlashLayer extends Container {
  private rect: Sprite
  private cancel?: () => void
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    this.rect = new Sprite(Texture.WHITE)
    this.rect.width = GAME_W
    this.rect.height = GAME_H
    this.rect.tint = 0xffffff
    this.rect.alpha = 0
    this.addChild(this.rect)
  }

  /** 強度 level（1-3）でフラッシュ。即座に peak まで点灯し、継続時間でフェードアウトする。 */
  flash(level: number): void {
    const i = Math.max(1, Math.min(3, Math.round(level)))
    const peak = PEAK[i]
    this.cancel?.()
    this.rect.alpha = peak
    this.cancel = tween(
      this.ticker,
      DURATION_MS[i],
      (t) => {
        this.rect.alpha = peak * (1 - t)
      },
      () => {
        this.rect.alpha = 0
      },
    )
  }

  destroy(): void {
    this.cancel?.()
    super.destroy({ children: true })
  }
}
