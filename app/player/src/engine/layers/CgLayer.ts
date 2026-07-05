/**
 * CgLayer — 背景CG。A/B 2枚のスプライトで 1.4s クロスフェード、Ken Burns（緩い拡大ドリフト）、
 * grayscale 感情演出（ColorMatrixFilter）を担う。picturebook_v3.html の演出移植。
 *
 * 注: 現状の Scene には感情(gray)データが無いため setGray は機構のみ移植（既定 0）。
 */
import { Assets, ColorMatrixFilter, Container, Sprite, type Texture, type Ticker } from 'pixi.js'
import { coverScale, GAME_H, GAME_W } from '../assets'
import { tween } from '../tween'

const FADE_MS = 1400

export class CgLayer extends Container {
  private front: Sprite
  private back: Sprite
  private filter = new ColorMatrixFilter()
  private cancelFade?: () => void
  private kbElapsed = 0
  private curUrl: string | null = null
  // front/back スプライトに現在割り当て中のテクスチャ URL（解放対象から除外する＝表示中を unload しない）。
  private frontUrl: string | null = null
  private backUrl: string | null = null
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    this.front = this.makeSprite()
    this.back = this.makeSprite()
    this.ticker.add(this.kenBurns)
  }

  private makeSprite(): Sprite {
    const s = new Sprite()
    s.anchor.set(0.5)
    s.position.set(GAME_W / 2, GAME_H / 2)
    s.alpha = 0
    this.addChild(s)
    return s
  }

  /** 新しい背景へクロスフェード。同一URLなら何もしない。 */
  async show(url: string): Promise<void> {
    if (url === this.curUrl) return
    this.curUrl = url
    const tex: Texture = await Assets.load(url)
    if (this.curUrl !== url) return // 取得中に別の beat へ進んだ

    this.fit(this.back, tex)
    this.back.alpha = 0
    this.backUrl = url
    this.kbElapsed = 0

    this.cancelFade?.()
    this.cancelFade = tween(
      this.ticker,
      FADE_MS,
      (t) => {
        this.back.alpha = t
        this.front.alpha = 1 - t
      },
      () => {
        const tmp = this.front
        this.front = this.back
        this.back = tmp
        const tmpUrl = this.frontUrl
        this.frontUrl = this.backUrl
        this.backUrl = tmpUrl
      },
    )
  }

  /** 現在 front/back に割り当て中のテクスチャ URL（テクスチャ解放の除外集合に使う）。 */
  inUseUrls(): string[] {
    return [this.frontUrl, this.backUrl].filter((u): u is string => u !== null)
  }

  // 背景は cover 拡大（アイテムCGは本レイヤに来ない: ItemLayer が原寸窓で描く・HU-70）。
  private fit(sprite: Sprite, tex: Texture): void {
    sprite.texture = tex
    sprite.scale.set(coverScale(tex.width, tex.height))
  }

  /** grayscale 量 0..1（0=フィルタ無し）。感情演出用の機構。 */
  setGray(amount: number): void {
    if (amount <= 0) {
      this.filters = []
    } else {
      this.filter.grayscale(1 - amount, false)
      this.filters = [this.filter]
    }
  }

  private kenBurns = (): void => {
    this.kbElapsed += this.ticker.deltaMS
    // 1.0 → ~1.06 まで 18s かけて緩やかにズーム（front のみ）。
    const base = coverScale(this.front.texture.width || GAME_W, this.front.texture.height || GAME_H)
    const k = 1 + 0.06 * Math.min(1, this.kbElapsed / 18000)
    this.front.scale.set(base * k)
  }

  destroy(): void {
    this.ticker.remove(this.kenBurns)
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
