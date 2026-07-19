import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseVersion(raw: string): ParsedVersion | null {
  const normalized = raw.trim().replace(/^[vV]/, '')
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  )
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber
    if (leftNumber != null) return -1
    if (rightNumber != null) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (next[key] !== installed[key]) return next[key] > installed[key]
  }
  return comparePrerelease(next.prerelease, installed.prerelease) > 0
}

function isApplicationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (VITE_DEV_SERVER_URL) {
      return url.origin === new URL(VITE_DEV_SERVER_URL).origin
    }
    return url.protocol === 'file:'
  } catch {
    return false
  }
}

function openExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    void shell.openExternal(url.toString()).catch((error) => {
      console.warn('[ExternalLink] Failed to open URL:', error)
    })
    return true
  } catch {
    return false
  }
}

function createWindow() {
  const preloadPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, '..', 'electron', 'preload.cjs')
    : path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Umon',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Keep application navigation inside Electron, but hand every web link to
  // the user's Windows default browser. Deny the Chromium child window either
  // way so target="_blank" never creates an unmanaged Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isApplicationUrl(url)) openExternalUrl(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isApplicationUrl(url)) return
    event.preventDefault()
    openExternalUrl(url)
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Update title after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.setTitle('Umon')
    // Set SMTC metadata for Windows
    if (process.platform === 'win32') {
      mainWindow?.webContents.executeJavaScript(`
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Umon',
            artist: 'Music Player',
            album: ''
          });
        }
      `).catch(() => {})
    }
  })

  // Open DevTools in development
  if (VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools()
  }

  // F12 toggle DevTools (works in both dev and production)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools()
    }
  })
}

// IPC: Window controls
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window-close', () => {
  mainWindow?.close()
})

// IPC: File system operations
interface ActiveDownload {
  req: http.ClientRequest
  resolve: (value: { ok: boolean; filePath?: string; error?: string }) => void
  paused: boolean
}
const activeDownloads = new Map<number, ActiveDownload>()

ipcMain.handle('download-file', async (event, data: { url: string; fileName: string; songId: number; downloadDir: string }) => {
  const { url, fileName, songId, downloadDir } = data
  const dir = downloadDir || app.getPath('downloads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  const tmpPath = filePath + '.umon_tmp'

  return new Promise<{ ok: boolean; filePath?: string; error?: string }>((resolve) => {
    const proto = url.startsWith('https') ? https : http

    function doRequest(requestUrl: string, redirectCount = 0, startByte = 0) {
      if (redirectCount > 5) {
        cleanup()
        resolve({ ok: false, error: 'too many redirects' })
        return
      }

      const headers: Record<string, string> = {}
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`
      }

      const req = proto.get(requestUrl, { headers }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1, startByte)
          return
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          cleanup()
          resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          return
        }

        const contentLength = parseInt(res.headers['content-length'] ?? '0', 10)
        const totalSize = startByte > 0 ? startByte + contentLength : contentLength
        let downloaded = startByte

        const fileStream = fs.createWriteStream(tmpPath, { flags: startByte > 0 ? 'a' : 'w' })

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (totalSize > 0) {
            const percent = Math.round((downloaded / totalSize) * 100)
            event.sender.send('download-progress', { songId, percent, downloaded, totalSize })
          }
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close()
          try {
            fs.renameSync(tmpPath, filePath)
          } catch {
            fs.copyFileSync(tmpPath, filePath)
            fs.unlinkSync(tmpPath)
          }
          cleanup()
          resolve({ ok: true, filePath })
        })

        fileStream.on('error', (err) => {
          cleanup()
          try { fs.unlinkSync(tmpPath) } catch {}
          resolve({ ok: false, error: err.message })
        })
      })

      req.on('error', (err) => {
        cleanup()
        try { fs.unlinkSync(tmpPath) } catch {}
        resolve({ ok: false, error: err.message })
      })

      activeDownloads.set(songId, { req, resolve, paused: false })
    }

    function cleanup() {
      activeDownloads.delete(songId)
    }

    doRequest(url)
  })
})

ipcMain.on('pause-download', (_event, songId: number) => {
  const entry = activeDownloads.get(songId)
  if (entry && !entry.paused) {
    entry.paused = true
    entry.req.destroy()
    // Don't delete from map, keep for resume
  }
})

ipcMain.handle('resume-download', async (event, data: { url: string; fileName: string; songId: number; downloadDir: string }) => {
  const { url, fileName, songId, downloadDir } = data
  const dir = downloadDir || app.getPath('downloads')
  const filePath = path.join(dir, fileName)
  const tmpPath = filePath + '.umon_tmp'

  // Get existing file size for resume
  let startByte = 0
  try {
    if (fs.existsSync(tmpPath)) {
      startByte = fs.statSync(tmpPath).size
    }
  } catch {}

  // Remove old entry if exists
  activeDownloads.delete(songId)

  return new Promise<{ ok: boolean; filePath?: string; error?: string }>((resolve) => {
    const proto = url.startsWith('https') ? https : http

    function doRequest(requestUrl: string, redirectCount = 0) {
      if (redirectCount > 5) {
        activeDownloads.delete(songId)
        resolve({ ok: false, error: 'too many redirects' })
        return
      }

      const headers: Record<string, string> = {}
      if (startByte > 0) headers['Range'] = `bytes=${startByte}-`

      const req = proto.get(requestUrl, { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          activeDownloads.delete(songId)
          resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          return
        }

        // If server doesn't support range, start from scratch
        if (startByte > 0 && res.statusCode === 200) {
          startByte = 0
        }

        const contentLength = parseInt(res.headers['content-length'] ?? '0', 10)
        const totalSize = startByte > 0 ? startByte + contentLength : contentLength
        let downloaded = startByte

        const fileStream = fs.createWriteStream(tmpPath, { flags: startByte > 0 ? 'a' : 'w' })

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (totalSize > 0) {
            const percent = Math.round((downloaded / totalSize) * 100)
            event.sender.send('download-progress', { songId, percent, downloaded, totalSize })
          }
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close()
          try {
            fs.renameSync(tmpPath, filePath)
          } catch {
            fs.copyFileSync(tmpPath, filePath)
            fs.unlinkSync(tmpPath)
          }
          activeDownloads.delete(songId)
          resolve({ ok: true, filePath })
        })

        fileStream.on('error', (err) => {
          activeDownloads.delete(songId)
          try { fs.unlinkSync(tmpPath) } catch {}
          resolve({ ok: false, error: err.message })
        })
      })

      req.on('error', (err) => {
        activeDownloads.delete(songId)
        try { fs.unlinkSync(tmpPath) } catch {}
        resolve({ ok: false, error: err.message })
      })

      activeDownloads.set(songId, { req, resolve, paused: false })
    }

    doRequest(url)
  })
})

ipcMain.on('cancel-download', (_event, songId: number) => {
  const entry = activeDownloads.get(songId)
  if (entry) {
    entry.req.destroy()
    activeDownloads.delete(songId)
  }
  // Clean up temp file
  // Note: we don't have filePath here directly, but the temp file will be overwritten next time
})

ipcMain.handle('check-file', (_event, filePath: string) => {
  return fs.existsSync(filePath)
})

ipcMain.handle('open-folder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('get-download-path', () => {
  return app.getPath('downloads')
})

ipcMain.handle('check-update', async () => {
  const currentVersion = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/UmocxZzZ/Umon/releases/latest')
    if (res.status === 404) {
      return { status: 'no-release', hasUpdate: false, currentVersion }
    }
    if (!res.ok) {
      return {
        status: 'error',
        hasUpdate: false,
        currentVersion,
        error: `GitHub API HTTP ${res.status}`,
      }
    }
    const data = await res.json() as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').trim().replace(/^[vV]/, '')
    if (!parseVersion(latest)) {
      return {
        status: 'error',
        hasUpdate: false,
        currentVersion,
        error: 'Release tag is not a semantic version',
      }
    }
    if (isNewerVersion(latest, currentVersion)) {
      const releaseUrl = data.html_url ?? 'https://github.com/UmocxZzZ/Umon/releases/latest'
      await shell.openExternal(releaseUrl)
      return { status: 'update-available', hasUpdate: true, latestVersion: latest, currentVersion }
    }
    return { status: 'up-to-date', hasUpdate: false, latestVersion: latest, currentVersion }
  } catch (error) {
    return {
      status: 'error',
      hasUpdate: false,
      currentVersion,
      error: error instanceof Error ? error.message : 'Unknown update error',
    }
  }
})

// Auth session: renderer configures one API scope, main process owns injection.
let authCookie = ''
let authScope: { origin: string; pathPrefix: string } | null = null

// Filter cookie string to only include name=value pairs (strip attributes)
const KNOWN_ATTRS = new Set([
  'domain',
  'expires',
  'httponly',
  'max-age',
  'partitioned',
  'path',
  'priority',
  'samesite',
  'secure',
])

function cleanCookieString(raw: string): string {
  if (!raw) return ''
  return raw
    .split(/;\s*/)
    .map((segment) => segment.trim())
    .filter((seg) => {
      const eq = seg.indexOf('=')
      if (eq < 1) return false
      const name = seg.slice(0, eq).trim().toLowerCase()
      return !KNOWN_ATTRS.has(name)
    })
    .join('; ')
}

function createAuthScope(apiBase: string): { origin: string; pathPrefix: string } {
  const url = new URL(apiBase)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base must use HTTP or HTTPS')
  }
  return {
    origin: url.origin,
    pathPrefix: url.pathname.replace(/\/+$/, '') || '/',
  }
}

function isAuthRequest(requestUrl: string): boolean {
  if (!authScope) return false
  try {
    const url = new URL(requestUrl)
    if (url.origin !== authScope.origin) return false
    return authScope.pathPrefix === '/'
      || url.pathname === authScope.pathPrefix
      || url.pathname.startsWith(`${authScope.pathPrefix}/`)
  } catch {
    return false
  }
}

function deleteHeader(headers: Record<string, string>, name: string) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
  }
}

function setupWebRequestFilter() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      // Never forward the renderer-only bridge header to arbitrary hosts.
      deleteHeader(details.requestHeaders, 'X-Umon-Cookie')

      if (isAuthRequest(details.url)) {
        // The configured in-memory session is authoritative. Removing an
        // automatically persisted Cookie also makes logout deterministic.
        deleteHeader(details.requestHeaders, 'Cookie')
        if (authCookie) details.requestHeaders['Cookie'] = authCookie
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  // MediaElementSource requires an explicit anonymous CORS response in Electron.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://*.music.126.net/*', 'https://*.music.126.net/*'] },
    (details, callback) => {
      const headers = details.responseHeaders ?? {}
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders: headers })
    },
  )
}

ipcMain.handle('configure-auth-session', (
  event,
  data: { cookie: string; apiBase: string },
) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Auth session can only be configured by the app window')
  }
  if (typeof data?.cookie !== 'string' || typeof data?.apiBase !== 'string') {
    throw new Error('Invalid auth session payload')
  }

  const nextScope = createAuthScope(data.apiBase)
  const nextCookie = cleanCookieString(data.cookie)
  authScope = nextScope
  authCookie = nextCookie
})

app.whenReady().then(() => {
  // Set app name for SMTC
  app.setName('Umon')

  // Set app user model id for Windows SMTC
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.umon.player')
  }

  setupWebRequestFilter()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
