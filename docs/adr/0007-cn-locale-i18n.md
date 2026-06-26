# ADR 0007: cn ロケールの生成と i18n リアルタイム切替

- ステータス: 採択（2026-06-27）
- 関連: [0002 データスキーマ](0002-data-schema.md) / [0003 アセットパイプライン](0003-asset-pipeline.md) / [0004 ボイス解決](0004-voice-resolution.md)（HU-29）

## コンテキスト

jp 全編再生が達成済み（HU-24〜28）。スキーマは当初から `locale: 'jp' | 'cn'` を持つが、
`build-scenes` は jp のみ生成し、エンジンも単一ロケール前提だった（Sprint 0/1 方針＝jp 先行）。
HU-29 で中国語版を全編再生可能にし、ビューア上で jp⇄cn をリアルタイム切替する。

調査で判明した前提:

- **cn ソースは別タグ語彙**を使う。`md_scr_text_cn/<code>.txt` は `[cn]`＝本文 / `[ascii]`＝id
  （voice ID・se コード・制御マーカー。jp の `[id]` と件数完全一致 9611）/ `[jp]`＝note
  （立ち絵・背景ラベルは**日本語のまま**。# 始まり 2605 件が jp `[note]` と完全一致）。
- jp（`text/id/note`）と cn（`cn/ascii/jp`）の語彙は**相互排他**。
- CG/cv/se/bgm は jp/cn で**バイト同一**。cn 専用音声は存在せず、オリジナル日本語 cv を共用する。
- 翻訳の行マージにより、cn は jp より本文行が少ない（[cn] 36705 < [text] 44411）。シーン単位の
  beat 数は 287/287 中 269（94%）で一致するが、残り 18 シーンは相違する。
- `002_AYAN004AB` は cn 側に本文が無く（[cn] 0 行）cn では生成されない。ただし flow からは参照され
  ないため通常ナビでは到達しない。

## 決定

### パイプライン（parseScene / build-scenes / validate）

- **タグ正規化**: `parseScene` に `TAG_ALIAS = {cn:'text', ascii:'id', jp:'note'}` を追加し、cn の
  タグ語彙を正準タグへ写像。状態機械本体はロケール非依存のまま。cn の note は日本語ラベルなので
  **jp 定義（`sprites.json`/`backgrounds.json`）でそのまま解決**できる（再生成不要・共用）。voice ID・
  se コードも jp と同一形式なので **manifest をそのまま共用**して解決する。
- **出力レイアウト**: `data/scenes/<code>.json`（flat）→ `data/scenes/<locale>/<code>.json` に変更。
  `build-scenes` は locale 別ディレクトリのみ作り直す（jp/cn を相互に上書きしない）。`validate` も
  `data/scenes/<locale>/` を読む。`npm run data:scenes:cn` / `validate:cn` を追加、`data:all` は
  jp+cn 両方を生成。defs/manifest は jp 用を共用（cn 専用生成は不要）。

### エンジン（sceneLoader / store / 描画）

- `sceneLoader` は `data/scenes/*/*.json` を glob し `"<locale>/<code>"` で索引。`loadScene(code, locale)`。
  要求 locale に当該シーンが無ければ **jp へフォールバック**（cn 未収録シーンは jp 本文で再生継続）。
- store に `locale` 状態と `setLocale(locale)` を追加。`start`/`advance`/`choose` は現 locale でロード。
  `setLocale` は現在シーンを別ロケールで読み直し、**再生位置（index）を維持**（beat 数が異なるシーンは
  末尾へクランプ）。選択肢は `NavOption` が jp/cn 両文言を保持するため描画側が locale で出し分ける。
- ビューアに**言語トグル UI**（ボタン＋`L` キー）。再生中の切替は字幕のみ差し替え、再生中の
  voice/se/bgm・テクスチャは乱さない（`renderBeat(beat, {silent:true})`）。FlowMap の選択肢ラベルも
  locale 連動（ノード見出しは flow.json に cn が無いため jp のまま）。

## 帰結

- jp/cn を全編で再生でき、ワンクリック（または `L`）で本文・選択肢・フロー図ラベルが切り替わる。
- **再生位置の維持はベストエフォート**。beat 数が一致する 94% のシーンでは行単位で維持されるが、翻訳の
  行マージで beat 分割が異なるシーンでは切替時に行がずれ得る（クランプで安全側に倒す）。
- cn の bg/sprite が jp 定義で解決すること・cn の beats 健全性は `scene.cn.test.ts` が回帰ガード
  （CI は validate を走らせないため）。voice 解決はロケール非依存で `validate:cn` が担保（未解決 14 件＝
  jp と同じ主人公 KAZU の未収録ボイス＝欠落素材）。
- jp/cn の 2 言語に限定。3 言語目以降の追加・cn 専用音声・ホスティングは非ゴール。
