/**
 * SpriteLayer — 立ち絵。body（全身）を下に置き、その上に face（表情差分）を body ローカル座標の
 * offset で重ねて合成する。複数スロット（多体・HU-77）を同時に描画し、表示体数に応じて水平方向へ
 * 均等配置する（1 体=中央 / 2 体=左右 / 3 体=左中右）。構成変更時はレイヤ全体をフェードで差し替える。
 */
import { Assets, Container, Sprite, type Texture, type Ticker } from 'pixi.js'
import { GAME_H, GAME_W } from '../assets'
import { tween } from '../tween'

const FADE_MS = 400

// 1 スロット分の描画指定（Stage が beat.sprites から解決した body/face URL と顔オフセット）。
export type SpriteSpec = { bodyUrl: string; faceUrl: string | null; offset?: [number, number] }

// body+face を 1 組にした描画ユニット。表示体数だけプールを確保して使い回す。
type Unit = {
  group: Container
  body: Sprite
  face: Sprite
  bodyUrl: string | null
  faceUrl: string | null
}

export class SpriteLayer extends Container {
  private units: Unit[] = []
  private cancelFade?: () => void
  private curKey: string | null = null
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    this.alpha = 0
  }

  private ensureUnit(i: number): Unit {
    while (this.units.length <= i) {
      const group = new Container()
      const body = new Sprite()
      body.anchor.set(0.5, 1) // 下中央基準
      const face = new Sprite()
      face.anchor.set(0, 0)
      group.addChild(body, face)
      this.addChild(group)
      this.units.push({ group, body, face, bodyUrl: null, faceUrl: null })
    }
    return this.units[i]
  }

  /**
   * 立ち絵の構成を差し替えて表示する。specs が前回と同一なら何もしない。空配列なら hide と同義。
   * n 体は x = GAME_W*(i+1)/(n+1) に均等配置（1=中央/2=左右/3=左中右）。
   */
  async show(specs: SpriteSpec[]): Promise<void> {
    const n = specs.length
    const key = specs
      .map((s, i) => `${s.bodyUrl}|${s.faceUrl ?? ''}|${s.offset?.join(',') ?? ''}@${i}/${n}`)
      .join(';')
    if (key === this.curKey) return
    this.curKey = key
    if (n === 0) {
      this.hide()
      return
    }

    const loaded = await Promise.all(
      specs.map(async (s) => ({
        spec: s,
        bodyTex: (await Assets.load(s.bodyUrl)) as Texture,
        faceTex: s.faceUrl ? ((await Assets.load(s.faceUrl)) as Texture) : null,
      })),
    )
    if (this.curKey !== key) return // ロード中に別構成へ差し替わっていたら破棄

    for (let i = 0; i < n; i++) {
      const u = this.ensureUnit(i)
      const { spec, bodyTex, faceTex } = loaded[i]
      const x = (GAME_W * (i + 1)) / (n + 1) // 均等配置
      u.bodyUrl = spec.bodyUrl
      u.faceUrl = spec.faceUrl
      u.body.texture = bodyTex
      u.body.position.set(x, GAME_H) // 下端・スロット x

      const bodyLeft = x - bodyTex.width / 2
      const bodyTop = GAME_H - bodyTex.height
      if (faceTex && spec.offset) {
        u.face.texture = faceTex
        u.face.position.set(bodyLeft + spec.offset[0], bodyTop + spec.offset[1])
        u.face.visible = true
      } else {
        u.face.visible = false
      }
      u.group.visible = true
    }
    // 余剰ユニットは隠す（前回より体数が減った場合）。
    for (let i = n; i < this.units.length; i++) {
      this.units[i].group.visible = false
      this.units[i].bodyUrl = null
      this.units[i].faceUrl = null
    }

    this.cancelFade?.()
    const from = this.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = from + (1 - from) * t
    })
  }

  /** 現在表示中の body/face テクスチャ URL（テクスチャ解放の除外集合に使う）。 */
  inUseUrls(): string[] {
    const out: string[] = []
    for (const u of this.units) {
      if (!u.group.visible) continue
      if (u.bodyUrl) out.push(u.bodyUrl)
      if (u.faceUrl) out.push(u.faceUrl)
    }
    return out
  }

  hide(): void {
    this.curKey = null
    this.cancelFade?.()
    const from = this.alpha
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = from * (1 - t)
    })
  }

  destroy(): void {
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
