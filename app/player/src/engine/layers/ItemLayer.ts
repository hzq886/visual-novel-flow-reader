/**
 * ItemLayer — アイテムCG窓（HU-70 / ADR 0009）。原エンジンの専用オーバーレイ窓
 * （bytecode 0x3b 表示 / 0x3c 破棄）を再現する: 背景（CgLayer）・立ち絵（SpriteLayer）の上に、
 * シーン毎の論理座標 (x, y)＝窓左上へ**原寸**表示する独立レイヤ。下層はそのまま見え続ける。
 * イン/アウトは 150ms フェード（0x3d イン/アウト演出のパラメータ 0x96=150 に倣う）。
 */
import { Assets, Container, Sprite, type Texture, type Ticker } from 'pixi.js'
import { tween } from '../tween'

const FADE_MS = 150

export class ItemLayer extends Container {
  private sprite = new Sprite() // anchor 既定 (0,0) = 左上基準（原データ座標と同じ）
  private cancelFade?: () => void
  private curKey: string | null = null
  // 現在割り当て中のテクスチャ URL（解放対象から除外する＝表示中を unload しない）。
  private curUrl: string | null = null
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    this.sprite.alpha = 0
    this.addChild(this.sprite)
  }

  /** アイテムCGを (x, y) に原寸表示。同一 URL・座標なら何もしない。 */
  async show(url: string, x: number, y: number): Promise<void> {
    const key = `${url}|${x},${y}`
    if (key === this.curKey) return
    this.curKey = key
    const tex: Texture = await Assets.load(url)
    if (this.curKey !== key) return // 取得中に別の beat へ進んだ

    this.curUrl = url
    this.sprite.texture = tex
    this.sprite.position.set(x, y)

    this.cancelFade?.()
    const from = this.sprite.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.sprite.alpha = from + (1 - from) * t
    })
  }

  hide(): void {
    if (this.curKey === null) return
    this.curKey = null
    this.cancelFade?.()
    const from = this.sprite.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.sprite.alpha = from * (1 - t)
    })
  }

  /** 現在割り当て中のテクスチャ URL（テクスチャ解放の除外集合に使う）。 */
  inUseUrls(): string[] {
    return this.curUrl !== null ? [this.curUrl] : []
  }

  destroy(): void {
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
