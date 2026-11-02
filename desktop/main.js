// OneSyncERP desktop shell. It has no logic of its own: it serves the exact same web build the browser gets
// (`npx expo export --platform web`, copied into web-build/ before packaging) from a local HTTP server and shows
// it in a window. The app inside is unaware it is not in a browser tab — same React code, same local storage
// (localStorage, the same driver.web.ts the browser uses), same sync to a OneSync server.
const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('node:path')
const http = require('node:http')
const fs = require('node:fs')

const WEB_DIR = path.join(__dirname, 'web-build')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' }

/** A plain static file server with SPA fallback (expo-router's client-side routes all resolve to index.html). Bound
 * to 127.0.0.1 only — nothing outside this machine can reach it — on a port the OS picks, so two instances never clash. */
function serveWebBuild() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0])
      let filePath = path.join(WEB_DIR, reqPath)
      if (!filePath.startsWith(WEB_DIR)) { res.writeHead(403); res.end(); return } // no path traversal out of web-build/
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) filePath = path.join(WEB_DIR, 'index.html') // SPA fallback
        fs.readFile(filePath, (readErr, data) => {
          if (readErr) { res.writeHead(404); res.end('Not found'); return }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
          res.end(data)
        })
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

let mainWindow

async function createWindow() {
  if (!fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
    const win = new BrowserWindow({ width: 640, height: 360 })
    win.loadURL('data:text/html,' + encodeURIComponent('<body style="font:16px sans-serif;padding:40px">web-build/ is missing — run the build step (expo export --platform web) before packaging.</body>'))
    return
  }
  const server = await serveWebBuild()
  const { port } = server.address()

  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#F4F3EF', // matches the light-mode canvas, so the window never flashes white while loading
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
    autoHideMenuBar: true,
  })
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)
  mainWindow.on('closed', () => { mainWindow = null })

  // An outbound link (a shared invoice, WhatsApp) opens in the person's real browser, not a second app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })

  app.on('before-quit', () => server.close())
}

Menu.setApplicationMenu(null)

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
