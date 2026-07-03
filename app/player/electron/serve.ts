/**
 * electron/serve — app:// リクエスト URL をローカルファイルパスへ解決する純関数。
 *
 * 配信レイアウト（レンダラの URL 規約は Web 版と同一のまま）:
 *  - /           → <dist>/index.html
 *  - /assets/**  → <assets>/**（ゲーム素材 2.4GB。パッケージ時は extraResources、
 *                  非パッケージ時はリポジトリの public/assets）
 *  - その他      → <dist>/**（Vite バンドル static/・fonts/・favicon 等）
 */
import path from 'node:path'

export interface ServeRoots {
  /** Vite ビルド成果物ルート（index.html / static/ / fonts/） */
  dist: string
  /** ゲーム素材ルート（cg/ sprite/ voice/ se/ bgm/） */
  assets: string
}

/** 正規オリジンの host（app://bundle/...） */
export const APP_HOST = 'bundle'

/**
 * リクエスト URL 全体を解決する。PixiJS の path.isUrl が https? 限定のため、絶対パス
 * '/assets/…' が 'app://assets/…'（先頭セグメントの host 化）へ誤解決される。host が
 * APP_HOST 以外の場合は先頭パスセグメントとして復元し、同一の規則で解決する。
 */
export function resolveAppRequest(requestUrl: string, roots: ServeRoots): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  const pathname = url.host === APP_HOST ? url.pathname : `/${url.host}${url.pathname}`
  return resolveAppPath(pathname, roots)
}

export function resolveAppPath(pathname: string, roots: ServeRoots): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const clean = path.posix.normalize(decoded)
  // URL pathname は必ず絶対。normalize 後に `..` が残る要求はルート外なので拒否。
  if (!clean.startsWith('/') || clean.split('/').includes('..')) return null
  if (clean === '/') return path.join(roots.dist, 'index.html')
  if (clean.startsWith('/assets/')) {
    const rel = clean.slice('/assets/'.length)
    if (rel === '') return null
    return path.join(roots.assets, rel)
  }
  return path.join(roots.dist, clean.slice(1))
}
