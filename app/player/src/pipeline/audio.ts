/**
 * audio — 効果音（se）と BGM のデータ解決ヘルパ（純関数）。
 *
 * ## se（効果音・ワンショット）
 * 原データのシーン脚本 bytecode は se を「再生命令（op 0x6c）＋自表文字列インデックス」で持ち、
 * その文字列は se コード（例 "8351A"）。同じ文字列はテキスト抽出の `[id]` マーカーにも現れる
 * ため、`parseScene` が `[id]` の se コード（`SE_RE`）を beat に取り込む（→ smain_flow_guide.md §4）。
 * se ファイルは小文字（`8351a.ogg`）なので manifest を真実の源に大小文字無視で照合する。
 *
 * ## BGM（ループ・シーン跨ぎ継続）
 * BGM のトラック選択（M01-M16）は **原データ `md_scr.med` に一切エンコードされていない**
 * （全 opcode/SMAIN/定義表を網羅確認済。`MUSIC:N` はタイトルメニュー専用で本編シーンに無い。
 * 恐らくゲーム実行ファイル側にハードコード）。よって BGM は **ルート（character）→ track の
 * curated 割当**とする（HU-28、ADR 0006）。`BGM_BY_CHARACTER` は編集可能な対応表で、
 * 正確な対応が判明したら差し替える。エンジンはシーンの bgm を跨いで継続し、track が変わる
 * シーン遷移でクロスフェードする（場面/ルート転換で適切に切替）。
 */
import type { BgmRef, Manifest, SeRef } from './types'

// se コード = 4 桁数字 ＋ 英字 1（例 "8351A" / "0001a"）。ボイス ID（`CHAR_..._NN`）や
// 選択肢 ID（`<scene>_NN_MM`）、制御マーカー（BG_BLACK 等）とは明確に別形式。
export const SE_RE = /^\d{4}[A-Za-z]$/

// シーン character（flow の character enum の scene 側サブセット）。
export type SceneCharacter = 'common' | 'ayan' | 'suzu' | 'tuba' | 'mako' | 'kaede' | 'omake'

// シーンコード接頭辞トークン → character（extract-flow.py の CHAR_BY_TOKEN を踏襲）。
const CHAR_BY_TOKEN: Record<string, SceneCharacter> = {
  PRO: 'common',
  MAIN: 'common',
  AYAN: 'ayan',
  SUBA: 'ayan',
  SUZU: 'suzu',
  FUTA: 'suzu',
  TUBA: 'tuba',
  SUBT: 'tuba',
  SUBTM: 'tuba', // 翼＋真琴 複合ルート（暫定 tuba レーン）
  MAKO: 'mako',
  KAED: 'kaede',
  NUKE: 'omake',
}

/** シーンコード（"002_AYAN001A"）→ character。未知トークンは common。 */
export function characterOfScene(code: string): SceneCharacter {
  const m = /^\d{3}_([A-Z]+?)\d/.exec(code)
  if (!m) return 'common'
  return CHAR_BY_TOKEN[m[1]] ?? 'common'
}

// character → BGM track（M01-M16）の curated 割当。**編集可能**（正確な対応が判明したら差し替え）。
// 同 character のシーンは同 track を共有 → エンジンが跨いで継続。別 character へ遷移でクロスフェード。
export const BGM_BY_CHARACTER: Record<SceneCharacter, string> = {
  common: 'M01',
  ayan: 'M02',
  suzu: 'M03',
  tuba: 'M04',
  mako: 'M05',
  kaede: 'M06',
  omake: 'M15',
}

/** シーンコード → BGM track 名（"M01"〜"M16"）。 */
export function bgmTrackForScene(code: string): string {
  return BGM_BY_CHARACTER[characterOfScene(code)]
}

/** manifest の se エントリを「小文字 basename（拡張子なし）→ 実パス」で索引。 */
export function buildSeIndex(manifest: Manifest): Map<string, string> {
  const index = new Map<string, string>()
  for (const e of manifest.entries) {
    if (e.category !== 'se') continue
    const base = e.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    index.set(base.toLowerCase(), e.file)
  }
  return index
}

/** manifest の bgm エントリを「basename（拡張子なし。"M01" など）→ 実パス」で索引。 */
export function buildBgmIndex(manifest: Manifest): Map<string, string> {
  const index = new Map<string, string>()
  for (const e of manifest.entries) {
    if (e.category !== 'bgm') continue
    const base = e.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    index.set(base, e.file)
  }
  return index
}

/** se コード → SeRef。manifest 未収録なら file=null（validate が検出）。大小文字無視で照合。 */
export function resolveSe(index: Map<string, string>, code: string): SeRef {
  return { code, file: index.get(code.toLowerCase()) ?? null }
}

/** BGM track → BgmRef。manifest 未収録なら file=null（validate が検出）。 */
export function resolveBgm(index: Map<string, string>, track: string): BgmRef {
  return { track, file: index.get(track) ?? null }
}
