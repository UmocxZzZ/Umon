import axios from 'axios'

const DEFAULT_API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

// Strip cookie attributes (Max-Age, Expires, Path, Domain, Secure, etc.) — keep only name=value pairs
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

const api = axios.create({
  baseURL: window.electronAPI ? DEFAULT_API : '/api',
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  const customBase = localStorage.getItem('umon-api-base')
  if (customBase) {
    config.baseURL = customBase
  }
  // Web: use X-Umon-Cookie header (goes through nginx proxy)
  // Electron: no header needed, webRequest interceptor handles cookie injection
  if (!window.electronAPI) {
    const rawCookie = localStorage.getItem('umon-cookie')
    if (rawCookie) {
      const cleaned = cleanCookieString(rawCookie)
      if (cleaned) {
        config.headers['X-Umon-Cookie'] = cleaned
      }
    }
  }
  return config
})

api.interceptors.response.use(
  (res) => {
    const data = res.data
    // Preserve Set-Cookie header for login endpoints
    const setCookie = res.headers?.['set-cookie']
    if (setCookie && typeof data === 'object' && data !== null) {
      data._cookies = setCookie
    }
    return data
  },
  (err) => {
    return Promise.reject(err)
  },
)

export default api
