/**
 * SpriteLayer — 立ち絵。body（全身）を下中央に置き、その上に face（表情差分）を
 * body ローカル座標の offset で重ねて合成する。beat 変更時はフェードで差し替え。
 */
import { Assets, Container, Sprite, type Texture, type Ticker } from 'pixi.js'
import { GAME_H, GAME_W } from '../assets'
import { tween } from '../tween'

const FADE_MS = 400

export class SpriteLayer extends Container {
  private group = new Container()
  private body = new Sprite()
  private face = new Sprite()
  private cancelFade?: () => void
  private curKey: string | null = null
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    this.body.anchor.set(0.5, 1) // 下中央基準
    this.face.anchor.set(0, 0)
    this.group.addChild(this.body, this.face)
    this.group.alpha = 0
    this.addChild(this.group)
  }

  /** body/face を差し替えて表示。bodyUrl/faceUrl が前回と同一なら何もしない。 */
  async show(bodyUrl: string, faceUrl: string | null, offset?: [number, number]): Promise<void> {
    const key = `${bodyUrl}|${faceUrl ?? ''}|${offset?.join(',') ?? ''}`
    if (key === this.curKey) return
    this.curKey = key

    const bodyTex: Texture = await Assets.load(bodyUrl)
    const faceTex: Texture | null = faceUrl ? await Assets.load(faceUrl) : null
    if (this.curKey !== key) return

    this.body.texture = bodyTex
    this.body.position.set(GAME_W / 2, GAME_H) // 下中央

    const bodyLeft = GAME_W / 2 - bodyTex.width / 2
    const bodyTop = GAME_H - bodyTex.height
    if (faceTex && offset) {
      this.face.texture = faceTex
      this.face.position.set(bodyLeft + offset[0], bodyTop + offset[1])
      this.face.visible = true
    } else {
      this.face.visible = false
    }

    this.cancelFade?.()
    const from = this.group.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.group.alpha = from + (1 - from) * t
    })
  }

  hide(): void {
    this.curKey = null
    this.cancelFade?.()
    const from = this.group.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.group.alpha = from * (1 - t)
    })
  }

  destroy(): void {
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
