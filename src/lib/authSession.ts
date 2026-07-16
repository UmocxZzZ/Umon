const AUTH_COOKIE_KEY = 'umon-cookie'
const API_BASE_KEY = 'umon-api-base'
const DEFAULT_ELECTRON_API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

const COOKIE_ATTRIBUTES = new Set([
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

export function normalizeAuthCookie(raw: string): string {
  if (!raw) return ''

  return raw
    .split(/;\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => {
      const separator = segment.indexOf('=')
      if (separator < 1) return false
      const name = segment.slice(0, separator).trim().toLowerCase()
      return !COOKIE_ATTRIBUTES.has(name)
    })
    .join('; ')
}

export function getAuthCookie(): string {
  return normalizeAuthCookie(localStorage.getItem(AUTH_COOKIE_KEY) || '')
}

export function persistAuthCookie(raw: string): string {
  const cookie = normalizeAuthCookie(raw)
  if (cookie) localStorage.setItem(AUTH_COOKIE_KEY, cookie)
  else localStorage.removeItem(AUTH_COOKIE_KEY)
  return cookie
}

export function normalizeElectronApiBase(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API 地址必须使用 http:// 或 https://')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址不能包含账号、查询参数或片段')
  }
  return value.replace(/\/+$/, '')
}

export function getApiBase(): string {
  // Web authentication always uses the same-origin bridge. Both the Vite dev
  // proxy and the production Nginx config translate X-Umon-Cookie server-side.
  if (!window.electronAPI) return '/api'

  const customBase = (localStorage.getItem(API_BASE_KEY) || '').trim()
  try {
    return normalizeElectronApiBase(customBase)
      || normalizeElectronApiBase(DEFAULT_ELECTRON_API)
  } catch {
    return normalizeElectronApiBase(DEFAULT_ELECTRON_API)
  }
}

/**
 * Electron owns request-time Cookie injection. Awaiting this method is the
 * synchronization barrier used before authenticated API requests.
 */
export async function syncElectronAuthSession(cookie = getAuthCookie()): Promise<void> {
  if (!window.electronAPI?.configureAuthSession) return
  await window.electronAPI.configureAuthSession({
    cookie: normalizeAuthCookie(cookie),
    apiBase: getApiBase(),
  })
}
