# ADR 0003: 素材パイプライン（gitignore + 外部保管 + manifest）

- ステータス: 採択（2026-06-22）

## コンテキスト
抽出済み素材は CG 1.7GB（背景/イベント 1,267＋立ち絵差分 2,267）＋音声 697MB（ボイス 7,309・SE 229・BGM 16）＝約2.4GB。元ゲーム `original_game/` は 6.1GB。これらを git で版管理するのは非現実的（抽出後ほぼ不変で版管理の利得が薄く、LFS は帯域/ストレージ課金が重い）。

## 決定
- **git 管理対象** = コード・`data_extract/text/`(12MB)・`data/*.json`・`docs/assets-manifest`（= `data/manifest.json`）のみ。
- **git 外**（`.gitignore`）= CG/音声/`original_game`/`*.med`/`app/player/public/assets/`。**Git LFS は使わない**。
- 素材実体は**ローカル/別ディレクトリ**（env `ASSET_SRC`、既定 `app/player/../../data_extract`）に置き、`npm run assets:fetch` で `public/assets/{cg,sprite,voice,se,bgm}/` へ同期する。
- `manifest.json` = `{ generatedFrom, entries:[{category,file,size,sha256}] }`。これを **ファイル名解決の真実の源**にする（`resolveVoice`/`resolveBg` の照合先）。manifest は git 管理。
- `--scene <code>` フィルタ: ボイスはファイル名がシーンコードを含むため決定的に絞れる。背景CG/立ち絵のシーン別フィルタは `parseScene`（VN-3）完成後に VN-5 で配線。

## 帰結
- リポジトリは軽量（約20MB）に保たれ、クラウド/CI でも扱いやすい。
- 素材が無い環境でもコード開発が可能（manifest と小さなサンプルで進められる）。
- `--scene` 以外の全カタログ hash 化（全 size+sha256）は重いので、現状は取得ファイルのみ hash。全カタログ化は必要時に拡張。
