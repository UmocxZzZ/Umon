import { defineStore } from 'pinia'
import { ref } from 'vue'

// Strip cookie attributes — keep only name=value pairs (same as Electron main.ts)
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

export interface UserProfile {
  userId: number
  nickname: string
  avatarUrl: string
  vipType: number
}

export const useAuthStore = defineStore('auth', () => {
  const cookie = ref(localStorage.getItem('umon-cookie') || '')
  const profile = ref<UserProfile | null>(null)
  const isLoggedIn = ref(false)

  function setCookie(c: string) {
    const cleaned = cleanCookieString(c)
    cookie.value = cleaned
    localStorage.setItem('umon-cookie', cleaned)
    // In Electron, store cookie for webRequest header injection
    if (window.electronAPI?.setCookie) {
      console.log('[Auth] setting Electron cookie')
      window.electronAPI.setCookie(c)
    }
  }

  function setProfile(p: UserProfile) {
    profile.value = p
    isLoggedIn.value = true
  }

  function logout() {
    cookie.value = ''
    profile.value = null
    isLoggedIn.value = false
    localStorage.removeItem('umon-cookie')
    if (window.electronAPI?.clearCookies) {
      window.electronAPI.clearCookies()
    }
  }

  return { cookie, profile, isLoggedIn, setCookie, setProfile, logout }
})
