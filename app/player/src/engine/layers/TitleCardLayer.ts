/**
 * TitleCardLayer — タイトルカード（`大見出し\N小見出し` 形式）を画面中央〜上部に題字表示する。
 * 2 用途を体裁を揃えて担う:
 *  - opening: シーン冒頭の `scene.title`（最初のページにオーバーレイ。前進でフェードアウト）。
 *  - section: 本文中の場面転換カード（narration 行に `\N` を含むページ。下部字幕の代わりに中央表示）。
 * `\N`(`\n`) は大見出し／小見出しの区切り＝改行。明朝・金の罫線で picturebook の題字体裁に寄せる。
 */
import { Container, Graphics, Text, type Ticker } from 'pixi.js'
import { GAME_H, GAME_W } from '../assets'
import { GOLD, UI_FONT } from '@/theme'
import { tween } from '../tween'

const FADE_MS = 420
// オーバーレイ（冒頭）は上部（背景CGの題字や立ち絵と干渉しにくい）、場面転換は画面中央に置く。
const CENTER_Y = { opening: GAME_H * 0.24, section: GAME_H * 0.42 } as const

export type TitleCardMode = keyof typeof CENTER_Y

export class TitleCardLayer extends Container {
  private category: Text // 大見出し（例「幼少回想」）= 小さめ・上
  private title: Text // 小見出し（例「三人」）= 大きめ・主役
  private rule = new Graphics()
  private cancelFade?: () => void
  private readonly ticker: Ticker
  private current: string | null = null

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    const shadow = { color: 0x000000, blur: 8, distance: 2, angle: Math.PI / 2, alpha: 0.9 }
    this.category = new Text({
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fill: 0xf3ead8,
        align: 'center',
        letterSpacing: 10,
        dropShadow: shadow,
      },
    })
    this.category.anchor.set(0.5, 1)
    this.title = new Text({
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 72,
        fill: 0xffffff,
        align: 'center',
        letterSpacing: 8,
        dropShadow: shadow,
      },
    })
    this.title.anchor.set(0.5, 0)
    this.addChild(this.rule, this.category, this.title)
    this.alpha = 0
  }

  /** raw = `大見出し\N小見出し`（null/空で隠す）。mode で表示位置を切り替える。 */
  show(raw: string | null, mode: TitleCardMode = 'section'): void {
    if (!raw) return this.hide()
    if (raw === this.current && this.alpha > 0) return
    this.current = raw

    const parts = raw.split(/\\[Nn]/).filter((s) => s.length > 0)
    const hasCategory = parts.length > 1
    const category = hasCategory ? parts[0] : ''
    const title = hasCategory ? parts.slice(1).join('　') : (parts[0] ?? '')
    const cy = CENTER_Y[mode]

    this.category.text = category
    this.category.visible = category !== ''
    this.category.position.set(GAME_W / 2, cy - 16)
    this.title.text = title
    this.title.position.set(GAME_W / 2, cy + 16)

    // 題字下の金罫線。
    const ruleW = Math.max(this.title.width * 0.7, 200)
    const ruleY = cy + 16 + this.title.height + 14
    this.rule.clear()
    this.rule.rect(GAME_W / 2 - ruleW / 2, ruleY, ruleW, 2).fill({ color: GOLD, alpha: 0.85 })

    const from = this.alpha
    this.cancelFade?.()
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = from + (1 - from) * t
    })
  }

  hide(): void {
    if (this.current === null && this.alpha === 0) return
    this.current = null
    const from = this.alpha
    this.cancelFade?.()
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = from * (1 - t)
    })
  }

  destroy(): void {
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
