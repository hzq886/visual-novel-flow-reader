---
name: verify
description: app/player の変更をランタイム観察で検証する手順（devサーバ + Playwright + Zustand store 直接操作）
---

# app/player の検証手順

エンジン/ストア/UI の変更は Vite dev サーバを起動し、Playwright でブラウザから実際に駆動して確認する。

## 起動

```bash
cd app/player && npm run dev   # http://localhost:5173（バックグラウンド起動）
```

素材は `public/assets/`（git 外）に配置済みであること（無ければ `npm run assets:fetch`）。

## 任意シーン・任意 beat へのジャンプ（dev 限定の要領）

アプリは map ビューで起動し、UI からの beat 送りはクリック連打になる。dev サーバは
ソースモジュールをそのまま配信するので、ページ内から Zustand ストアを直接操作できる:

```js
// page.evaluate 内で — アプリと同一のモジュールインスタンスが返る
const mod = await import('/src/store/player.ts')
await mod.usePlayer.getState().gotoPosition('001_PRO001B', 38, 0) // (code, beatIndex, line)
```

- ビュー切替は `Tab` キー（map ⇄ story）、言語トグルは `` ` ``（Backquote）。
- beat 送りは `Enter`（narration は行数ぶん複数回）。
- 遷移後はクロスフェード 1.4s ＋テクスチャロードがあるので **2.5s 程度待ってから** screenshot。
- ページロード直後に gotoPosition すると `start()`（ブックマーク自動復帰）と競合して
  黒画面になることがある。**ロード後 2s 待ってから** 操作するか、リロードしてやり直す。

## 観察

- screenshot は Playwright の `page.screenshot()` で取得（リポジトリ直下に書かず scratchpad へ移す）。
- Ken Burns 等の時間演出の検証は t0/t+6s の 2 枚を撮って PIL/numpy でピクセル diff。
- Electron 側の検証は CDP + native WebSocket（メモリ electron-verify-technique 参照）。

## 後片付け

- Vite dev サーバを kill、`.playwright-mcp/` とスクリーンショットをリポジトリから除去。
