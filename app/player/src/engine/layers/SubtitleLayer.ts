/**
 * SubtitleLayer — 字幕。地の文（narration）もセリフ（line）も画面下部中央に配置する
 * （プロトタイプ `#sub { text-align:center }` 準拠・HU-66）。セリフはブロック内左揃え＋
 * 鉤括弧ぶら下げのまま、ブロック全体を中央へ置き、話者名 `【名前】` はブロック左端に追従。
 * 背景スクリムは置かず、文字自身のアウトライン（stroke）＋ドロップシャドウで任意背景でも
 * 読めるようにする（HU-33）。beat 変更でフェードイン。フォントは locale 別
 * （show の font 引数で jp/cn を出し分け）。
 */
import { Container, Text, type Ticker } from 'pixi.js'
import type { Beat } from '@/pipeline/types'
import { GAME_H, GAME_W } from '../assets'
import { FONT_JP, GOLD } from '@/theme'
import { tween } from '../tween'

const FADE_MS = 360
const BASE_Y = GAME_H - 56 // 本文ベースライン（下端）
const WRAP_W = GAME_W * 0.82
// 任意背景での可読性: 黒アウトライン＋柔らかい影（スクリムの代わり）。
const STROKE = { color: 0x000000, width: 4 }
const SHADOW = { color: 0x000000, blur: 5, distance: 2, angle: Math.PI / 2, alpha: 0.6 }

export class SubtitleLayer extends Container {
  private whoText: Text
  private sayText: Text
  private cancelFade?: () => void
  private readonly ticker: Ticker

  constructor(ticker: Ticker) {
    super()
    this.ticker = ticker

    this.whoText = new Text({
      text: '',
      style: {
        fontFamily: FONT_JP,
        fontSize: 28,
        fontWeight: '700',
        fill: GOLD,
        align: 'left',
        stroke: STROKE,
        dropShadow: SHADOW,
      },
    })
    this.whoText.anchor.set(0, 1)

    this.sayText = new Text({
      text: '',
      style: {
        fontFamily: FONT_JP,
        fontSize: 34,
        fontWeight: '400',
        fill: 0xffffff,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: WRAP_W,
        breakWords: true,
        lineHeight: 50,
        stroke: STROKE,
        dropShadow: SHADOW,
      },
    })

    this.addChild(this.sayText, this.whoText)
    this.alpha = 0
  }

  // line = beat 内のサブインデックス。地の文は原作の改ページで区切られたページ（1〜2 行）を
  // まとめて中央表示し（HU-78）、セリフは集約した 1 発話をブロック内左揃えのままブロックごと中央に
  // 置いて全文表示する（話者名 `【名前】` をブロック左端の上に表示）。font = locale 別フォント（jp/cn）。
  show(beat: Beat, line = 0, font: string = FONT_JP): void {
    this.sayText.style.fontFamily = font
    this.whoText.style.fontFamily = font
    if (beat.kind === 'line') {
      // 鉤括弧で始まる発話は継続行を全角 1 字下げ、「の後ろの文字（本文）に揃える（ぶら下げ）。
      const lines = beat.lines
      const opensBracket = /^[「『（《【〈“]/.test(lines[0] ?? '')
      const INDENT = '\u3000' // 全角スペース＝「1 文字分の字下げ
      this.sayText.text =
        opensBracket && lines.length > 1
          ? lines[0] +
            '\n' +
            lines
              .slice(1)
              .map((l) => INDENT + l)
              .join('\n')
          : lines.join('\n')
      this.sayText.style.fontWeight = '400'
      // 行揃えはブロック内左揃え（ぶら下げ字下げを保持）のまま、ブロック全体を画面中央へ。
      this.sayText.style.align = 'left'
      this.sayText.anchor.set(0.5, 1)
      this.sayText.position.set(GAME_W / 2, BASE_Y)
      if (beat.who) {
        this.whoText.text = `【${beat.who}】`
        this.whoText.visible = true
        // 話者名はセリフブロックの左端（= 中央 − 幅/2）に追従させる。
        this.whoText.position.set(
          Math.round(this.sayText.x - this.sayText.width / 2),
          this.sayText.y - this.sayText.height - 8,
        )
      } else {
        this.whoText.visible = false
      }
    } else {
      // 地の文はページ（1〜2 行）をまとめて中央表示（HU-78）。改行で複数行を積む。
      const page = beat.pages[line] ?? beat.pages[beat.pages.length - 1] ?? []
      this.sayText.text = page.join('\n')
      this.sayText.style.fontWeight = '400'
      this.sayText.style.align = 'center'
      this.sayText.anchor.set(0.5, 1)
      this.sayText.position.set(GAME_W / 2, BASE_Y)
      this.whoText.visible = false
    }

    this.cancelFade?.()
    this.alpha = 0
    this.cancelFade = tween(this.ticker, FADE_MS, (t) => {
      this.alpha = t
    })
  }

  /** 字幕を隠す（場面転換カードのページでは下部字幕の代わりに TitleCardLayer が題字を出す）。 */
  hide(): void {
    const from = this.alpha
    if (from === 0) return
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
