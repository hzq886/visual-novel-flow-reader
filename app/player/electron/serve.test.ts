import { describe, expect, it } from 'vitest'
import { resolveAppPath, resolveAppRequest } from './serve'

const roots = { dist: '/app/dist', assets: '/app/resources/assets' }

describe('resolveAppRequest', () => {
  it('正規オリジン app://bundle/** を解決する', () => {
    expect(resolveAppRequest('app://bundle/', roots)).toBe('/app/dist/index.html')
    expect(resolveAppRequest('app://bundle/assets/cg/X.png', roots)).toBe(
      '/app/resources/assets/cg/X.png',
    )
    expect(resolveAppRequest('app://bundle/static/index-abc.js', roots)).toBe(
      '/app/dist/static/index-abc.js',
    )
  })

  it('PixiJS が host 化した先頭セグメントを復元して解決する（app://assets/…）', () => {
    expect(resolveAppRequest('app://assets/cg/PRO_TITLE_A.png', roots)).toBe(
      '/app/resources/assets/cg/PRO_TITLE_A.png',
    )
    expect(resolveAppRequest('app://assets/sprite/CH01B_01.png', roots)).toBe(
      '/app/resources/assets/sprite/CH01B_01.png',
    )
  })

  it('クエリ・ハッシュは無視して解決する', () => {
    expect(resolveAppRequest('app://bundle/assets/cg/X.png?v=1#f', roots)).toBe(
      '/app/resources/assets/cg/X.png',
    )
  })

  it('不正な URL は拒否する', () => {
    expect(resolveAppRequest('not a url', roots)).toBeNull()
  })
})

describe('resolveAppPath', () => {
  it('ルートは dist/index.html へフォールバックする', () => {
    expect(resolveAppPath('/', roots)).toBe('/app/dist/index.html')
  })

  it('/assets/** はゲーム素材ルートへ解決する', () => {
    expect(resolveAppPath('/assets/cg/BG20_02_00.png', roots)).toBe(
      '/app/resources/assets/cg/BG20_02_00.png',
    )
    expect(resolveAppPath('/assets/voice/ayan_002_ayan001A_001.ogg', roots)).toBe(
      '/app/resources/assets/voice/ayan_002_ayan001A_001.ogg',
    )
  })

  it('その他のパスは dist へ解決する（Vite バンドル・フォント）', () => {
    expect(resolveAppPath('/static/index-abc123.js', roots)).toBe(
      '/app/dist/static/index-abc123.js',
    )
    expect(resolveAppPath('/fonts/foo.woff2', roots)).toBe('/app/dist/fonts/foo.woff2')
    expect(resolveAppPath('/favicon.svg', roots)).toBe('/app/dist/favicon.svg')
  })

  it('URL エンコードされたパスをデコードして解決する', () => {
    expect(resolveAppPath('/assets/cg/%E3%83%86%E3%82%B9%E3%83%88.png', roots)).toBe(
      '/app/resources/assets/cg/テスト.png',
    )
  })

  it('パストラバーサルを拒否する', () => {
    expect(resolveAppPath('/assets/../../etc/passwd', roots)).toBe('/app/dist/etc/passwd')
    expect(resolveAppPath('/%2e%2e/%2e%2e/etc/passwd', roots)).toBe('/app/dist/etc/passwd')
    expect(resolveAppPath('..', roots)).toBeNull()
    expect(resolveAppPath('/assets/', roots)).toBeNull()
  })

  it('不正なパーセントエンコーディングは拒否する', () => {
    expect(resolveAppPath('/%zz', roots)).toBeNull()
  })
})
