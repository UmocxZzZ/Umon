import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env file manually for Electron main process
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '..', '.env')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim()
          const value = trimmed.slice(eqIndex + 1).trim()
          if (!process.env[key]) {
            process.env[key] = value
          }
        }
      }
    }
  } catch (e) {
    console.error('[Main] Failed to load .env:', e)
  }
}

loadEnvFile()

let mainWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

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
    if (!res.ok) return { hasUpdate: false, currentVersion }
    const data = await res.json() as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (latest && latest !== currentVersion) {
      shell.openExternal(data.html_url ?? 'https://github.com/UmocxZzZ/Umon/releases')
      return { hasUpdate: true, latestVersion: latest, currentVersion }
    }
    return { hasUpdate: false, currentVersion }
  } catch {
    return { hasUpdate: false, currentVersion }
  }
})

// IPC: Cookie management — inject via webRequest to bypass file:// origin restrictions
const API_BASE = process.env.VITE_API_BASE || 'http://localhost:3000'
let storedCookie = ''

// Filter cookie string to only include name=value pairs (strip attributes)
const KNOWN_ATTRS = new Set(['max-age', 'expires', 'path', 'domain', 'secure', 'httponly', 'samesite'])

function cleanCookieString(raw: string): string {
  if (!raw) return ''
  return raw
    .split(/;\s*/)
    .filter((seg) => {
      const eq = seg.indexOf('=')
      if (eq < 1) return false
      const name = seg.slice(0, eq).trim().toLowerCase()
      return !KNOWN_ATTRS.has(name)
    })
    .join('; ')
}

// Inject stored cookie into all requests to the API server
function setupWebRequestFilter() {
  console.log('[Main] Setting up webRequest filter for:', API_BASE)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${API_BASE}/*`] },
    (details, callback) => {
      if (storedCookie) {
        details.requestHeaders['Cookie'] = storedCookie
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

ipcMain.handle('set-cookie', async (_event, cookieStr: string) => {
  storedCookie = cleanCookieString(cookieStr)
  console.log('[Main] Cookie stored, length:', storedCookie.length)
  console.log('[Main] Cookie preview:', storedCookie.substring(0, 100) + '...')
})

ipcMain.handle('clear-cookies', async () => {
  storedCookie = ''
  await session.defaultSession.clearStorageData({ storages: ['cookies'] })
})

ipcMain.handle('get-stored-cookie', () => {
  return storedCookie
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
