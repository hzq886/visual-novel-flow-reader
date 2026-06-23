/**
 * SubtitleLayer — 字幕。話者（who, 金色）＋本文（say）を下部中央に表示し、beat 変更で
 * フェードイン。地の文は明朝寄り・淡色、セリフは太字・白。下部に可読性のためのスクリム。
 * picturebook_v3.html の字幕体裁を移植。
 */
import { Container, Graphics, Text, type Ticker } from 'pixi.js'
import type { Beat } from '@/pipeline/types'
import { GAME_H, GAME_W } from '../assets'
import { tween } from '../tween'

const GOLD = 0xe9c07a
const FADE_MS = 360
const BASE_Y = GAME_H - 56 // 本文ベースライン

export class SubtitleLayer extends Container {
  private scrim = new Graphics()
  private whoText: Text
  private sayText: Text
  private cancelFade?: () => void
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker
    // 下部スクリム（読みやすさ用の暗幕）。
    this.scrim.rect(0, GAME_H * 0.6, GAME_W, GAME_H * 0.4).fill({ color: 0x000000, alpha: 0.55 })

    this.whoText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 22,
        fontWeight: '600',
        letterSpacing: 6,
        fill: GOLD,
        align: 'center',
        dropShadow: { color: 0x000000, blur: 6, distance: 2, angle: Math.PI / 2, alpha: 0.9 },
      },
    })
    this.whoText.anchor.set(0.5, 1)

    this.sayText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 34,
        fill: 0xffffff,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: GAME_W * 0.82,
        breakWords: true,
        lineHeight: 50,
        dropShadow: { color: 0x000000, blur: 8, distance: 2, angle: Math.PI / 2, alpha: 0.95 },
      },
    })
    this.sayText.anchor.set(0.5, 1)

    this.addChild(this.scrim, this.sayText, this.whoText)
    this.alpha = 0
  }

  show(beat: Beat): void {
    const isLine = beat.kind === 'line'
    this.sayText.text = beat.lines.join('\n')
    this.sayText.style.fontWeight = isLine ? '600' : '400'
    this.sayText.style.fontFamily = isLine
      ? 'system-ui, sans-serif'
      : '"Hiragino Mincho ProN", "Yu Mincho", serif'
    this.sayText.style.fill = isLine ? 0xffffff : 0xf3ead8
    this.sayText.position.set(GAME_W / 2, BASE_Y)

    if (isLine && beat.who) {
      this.whoText.text = `— ${beat.who} —`
      this.whoText.visible = true
      this.whoText.position.set(GAME_W / 2, this.sayText.y - this.sayText.height - 12)
    } else {
      this.whoText.visible = false
    }

    this.cancelFade?.()
    this.alpha = 0
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = t
    })
  }

  destroy(): void {
    this.cancelFade?.()
    super.destroy({ children: true })
  }
}
