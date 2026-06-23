# ADR 0004: ボイスID → ファイル名 解決規則（manifest 照合）

- ステータス: 採択（2026-06-23）
- 関連: [0002 データスキーマ](0002-data-schema.md) / [0003 素材パイプライン](0003-asset-pipeline.md)

## コンテキスト

シーン原データの `[id]` に現れるボイスIDは `<CHAR>_<sceneCode>_<serial>` 形式（例 `AYAN_002_AYAN001A_001`）。一方、抽出済みの実ファイル名は **大小文字が非自明** に混在する:

```
ID     : AYAN_002_AYAN001A_001
ファイル: ayan_002_ayan001A_001.ogg
```

- キャラ接頭辞・ルート埋め込みのアルファベット（`AYAN…` → `ayan…`）は小文字化されるが、
- シーン変種を表す**末尾の1文字（…001"A"）は大文字のまま**残る。

このため素朴な `id.toLowerCase()`（→ `ayan_002_ayan001a_001`、末尾 `a`）では実ファイル（`…001A`）に一致しない。元データ由来のこの綴り規則は将来のキャラ/シーンで揺れる可能性があり、規則をコードに固定化するのは脆い。

## 決定

**ファイル名の真実の源は `data/manifest.json`**（[ADR 0003](0003-asset-pipeline.md)）とし、変換ではなく **大小文字無視の照合** で解決する（`src/pipeline/resolve.ts`）。

- manifest の `category==='voice'` エントリを「`basename`（パス/拡張子除去）を小文字化したキー → 実パス」で索引する（`buildVoiceIndex`）。
- ボイスIDも小文字化して索引を引き、**ヒットした manifest の実ファイル名（正しい大小文字）をそのまま返す**（`resolveVoice`）。
- manifest 未収録なら `file=null`（未解決）。`npm run validate` が全 beat を走査して未解決を検出し exit 1。
- 背景（`bg`）・立ち絵（`sprite`）は manifest ではなく `backgrounds.json` / `sprites.json`（[ADR 0002](0002-data-schema.md)）でコードへ解決する（`code(+suffix)` がそのまま素材ファイル名の基底）。素材実体取得と manifest 登録は後続（fetch-assets のシーン別取得）で行うため、現段階の `bg.file`/`sprite.body|face` はコード値。

## 帰結

- 大小文字の綴り揺れに依存せず堅牢。変換規則をコードに埋め込まず、manifest を単一の真実とする。
- 新しいボイスを使うシーンは「`assets:fetch` で取得 → manifest 更新 → `data:scenes` 再生成」で解決される。取得前は `validate` が未解決として顕在化させる。
- 大小文字無視の照合のため、同一綴りで大小文字違いのみのファイルが衝突すると曖昧になるが、原データにそのような例は無い（必要時に再検討）。
