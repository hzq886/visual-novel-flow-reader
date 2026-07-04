# ADR 0008: Electron 化の方式（手組み esbuild ＋ app:// プロトコル ＋ アセット同梱）

- ステータス: 採択（2026-07-03）
- 関連: [0001 技術スタック](0001-tech-stack.md) / [0003 アセットパイプライン](0003-asset-pipeline.md)（HU-64）

## コンテキスト

`app/player`（Vite + React の静的SPA）をローカルデスクトップアプリ化する（Sprint 5）。
前提条件:

- ゲーム素材 2.4GB（約11,000件）は git 外・`public/assets/` 配置で、レンダラは絶対URL
  `/assets/...` で参照する（`src/engine/assets.ts` の `ASSET_BASE`）。
- HU-52 で「Electron 化時はウィンドウ自体を 16:9 ロック」という積み残しがある。
- CI（typecheck/lint/format/test/build）は非回帰が必須。CI 環境に素材は存在しない。

## 決定

1. **統合ツール（electron-vite / electron-forge）は使わない**。レンダラは既存の `vite build`
   を無改造で使い、main/preload（`electron/`）だけ esbuild で `dist-electron/*.cjs` へバンドル
   （`scripts/electron-build.ts`）。パッケージングは electron-builder（`electron-builder.yml`）。
   - 理由: 統合ツールは自前の Vite に依存し本リポの Vite 8（rolldown 系）と二重管理になる。
     main+preload は小規模で、既存 scripts・CI を壊さない手組みの方が見通しがよい。
2. **本番ロードはカスタムプロトコル `app://bundle/`** で dist と素材を同一オリジン配信
   （`protocol.handle` + `net.fetch(file://...)`＝Range/MIME 委譲）。`file://` 直ロードは絶対
   パス `/assets/...` が壊れるため不採用。パス解決は純関数 `electron/serve.ts`（Vitest 対象）。
   - **PixiJS の URL 誤解決への対処**: pixi の `path.isUrl` は `https?:` 限定のため、絶対パス
     `/assets/…` を `rootname='app://'` と誤結合し `app://assets/…`（先頭セグメントの host 化）
     を要求する。レンダラ無改造の原則を守り、Electron 側で host を先頭パスセグメントとして
     復元（`resolveAppRequest`）＋ scheme `corsEnabled` ＋ `Access-Control-Allow-Origin: *` で
     クロスオリジン扱いの fetch を許可する。
3. **Vite の `build.assetsDir` を `static` に変更**。既定 `assets` のままだと `vite build` が
   `public/assets`（2.4GB）を `dist/assets` へコピーした結果とバンドル出力が同居し、パッケージ
   から素材だけを除外できない。`dist/static`＝コード、`dist/assets`＝素材コピー（パッケージ対象外）。
4. **素材はパッケージ同梱（自己完結 .app）**: electron-builder の `extraResources` で
   `public/assets` → `<Resources>/assets`。asar にはコード（dist ＋ dist-electron）のみ。
   非パッケージ実行時（`npx electron .`）はリポジトリの `public/assets` へフォールバック。
5. **レンダラ依存を含む全依存を devDependencies に置く**。レンダラ依存は Vite がバンドルするため
   実行時 node_modules は不要で、electron-builder が production deps を自動同梱するのを防ぐ。
6. **対象は macOS arm64 のみ・署名なし**（個人利用）。`dist:electron` はローカル実行のみで
   **CI 対象外**（素材が無いため）。CI は `electron/` の typecheck/lint/test を含み、
   `ELECTRON_SKIP_BINARY_DOWNLOAD=1` で Electron バイナリの取得をスキップする。
7. **ウィンドウ**: コンテンツ 1280×720 起点・最小 960×540・`setAspectRatio(16/9)`（HU-52 の
   積み残し解消）。セキュリティは `contextIsolation` / `sandbox` 有効・`nodeIntegration` 無効。
   preload は識別フラグのみ（ブックマークのファイル永続化 IPC は HU-65）。

## 結果

- `dev:electron`＝Vite dev サーバ＋Electron 同時起動（web の `dev` は不変）。
- `build:electron`＝web build ＋ main/preload バンドル。`dist:electron`＝mac arm64 `.app` 生成。
- ブックマーク等の localStorage は app://（standard scheme）配下で userData に永続化される。
- 検証済み: フロー図・物語再生（CG/立ち絵/字幕）・BGM/voice 再生・ノードクリック遷移が
  app:// 経由で動作（HU-64）。

## 却下した代替案

- **electron-vite / electron-forge**: Vite 8 との互換リスクと二重設定。利得が薄い。
- **file:// 直ロード＋`base: './'`**: 絶対パス素材参照が壊れ、レンダラ改造が必要になる。
- **ローカル HTTP サーバ内蔵**: ポート衝突・起動順序の管理が増える。カスタムプロトコルで足りる。
- **素材の外部ディレクトリ参照**: アプリ単体で完結しない（要件分析で同梱案を採択）。
