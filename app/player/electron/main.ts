/**
 * electron/main — メインプロセス。
 *
 *  - BrowserWindow 生成: コンテンツ 1280×720 起点・16:9 アスペクト比ロック（HU-52 の積み残し）
 *  - 本番: app:// カスタムプロトコルで dist とゲーム素材を同一オリジン配信
 *    （file:// では絶対パス /assets/... が壊れるため。Range/MIME は net.fetch に委譲）
 *  - 開発: VITE_DEV_SERVER_URL があれば Vite dev サーバへ接続（scripts/electron-dev.ts が設定）
 */
import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_HOST, resolveAppRequest } from './serve'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

// 標準スキームとして登録（fetch/XHR・localStorage・ストリーミングを有効化）。
// corsEnabled は PixiJS の誤解決 URL（app://assets/… = クロスオリジン扱い）の fetch を
// 通すために必要（詳細は serve.ts の resolveAppRequest）。
// app.whenReady() より前に呼ぶ必要がある。
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])

function registerAppProtocol(): void {
  const distRoot = path.join(__dirname, '..', 'dist')
  // パッケージ時は extraResources（<resources>/assets）、非パッケージ時はリポジトリの public/assets
  const assetsRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', 'public', 'assets')
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppRequest(request.url, { dist: distRoot, assets: assetsRoot })
    if (!file) return new Response('Not Found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    // クロスオリジン扱いの誤解決 URL（app://assets/…）からも読めるよう常に CORS 許可
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    // 本番はフルスクリーンのみ。開発は reload / devtools 込みの標準 View メニュー。
    DEV_SERVER_URL
      ? { role: 'viewMenu' }
      : { label: '表示', submenu: [{ role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const win = new BrowserWindow({
    title: '催眠術4',
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setAspectRatio(16 / 9)
  // 外部リンクはアプリ内で開かず OS ブラウザへ
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // レンダラ console をターミナルへ転送（開発時と SAIMIN4_LOG=1 のとき）
  if (DEV_SERVER_URL || process.env.SAIMIN4_LOG) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
  }
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadURL(`${APP_ORIGIN}/`)
  }
}

void app.whenReady().then(() => {
  if (!DEV_SERVER_URL) registerAppProtocol()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// VN ビューアとして全ウィンドウ閉＝終了（mac の常駐慣習は採らない）
app.on('window-all-closed', () => {
  app.quit()
})
