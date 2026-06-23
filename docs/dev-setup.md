# 開発環境セットアップ

## 前提
- Node v24 系（`app/player/.nvmrc` = 24）。`nvm use` で合わせる。
- git リポジトリ（origin = `hzq886/visual-novel-flow-reader`、**非公開**）。

## アプリのセットアップ
```bash
cd app/player
nvm use
npm install
npm run dev        # http://localhost:5173
```

## 素材の配置
CG/音声は git 外。`ASSET_SRC`（既定 `app/player/../../data_extract`）から取得する。
```bash
cd app/player
npm run assets:fetch -- --scene 002_AYAN001A   # 縦串に必要なボイスを取得＋manifest生成
# 別ソースから取る場合:
ASSET_SRC=/abs/path/to/data_extract npm run assets:fetch -- --only bgm
```

## Linear MCP 接続（チケット管理）
タスクは Linear で管理し、Claude Code から MCP 経由で issue を操作する。

1. Claude Code に Linear MCP サーバーを登録（OAuth）:
   ```bash
   claude mcp add --transport http linear https://mcp.linear.app/mcp
   ```
   ※ **HTTP トランスポート**を使う（SSE の `https://mcp.linear.app/sse` は 404）。
   ※ 登録後は **Claude Code を再起動** → `/mcp` で OAuth 認可 → `connected` を確認。
2. Linear 側に **Team**（例: `催眠4 Web`）と **Cycle**（スプリント）を作成。
3. ラベルを用意: `area:pipeline` `area:engine` `area:flow` `area:infra` `type:adr`。
4. プラン（`~/.claude/plans/calude-code-first-peppy-ullman.md`）の **VN-1〜VN-12** を issue 化する。

> 接続できない/ヘッドレス環境では、当面コミットメッセージ＋`docs/adr/` で代替し、後で issue 化する。

## 設計判断（ADR）
スキーマ・解決規則・素材取得・フロー復元方式を変更/決定したら `docs/adr/NNNN-*.md` に追記する。
現状: 0001 技術スタック / 0002 データスキーマ / 0003 素材パイプライン。
予定: 0004 ボイス解決 / 0005 フロー復元 / 0006 フロー再抽出オペコード仕様。
