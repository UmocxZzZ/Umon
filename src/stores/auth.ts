import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getUserAccount } from '@/lib/api'
import {
  getAuthCookie,
  persistAuthCookie,
  syncElectronAuthSession,
} from '@/lib/authSession'

export interface UserProfile {
  userId: number
  nickname: string
  avatarUrl: string
  vipType: number
}

export const useAuthStore = defineStore('auth', () => {
  const cookie = ref(getAuthCookie())
  const profile = ref<UserProfile | null>(null)
  const isLoggedIn = ref(false)
  let restorePromise: Promise<UserProfile | null> | null = null
  let sessionVersion = 0
  let electronSyncQueue: Promise<void> = Promise.resolve()

  function enqueueElectronSync(value: string): Promise<void> {
    const task = electronSyncQueue
      .catch(() => undefined)
      .then(() => syncElectronAuthSession(value))
    electronSyncQueue = task
    return task
  }

  function stageCookie(c: string): {
    value: string
    version: number
    synchronized: Promise<void>
  } {
    const cleaned = persistAuthCookie(c)
    cookie.value = cleaned
    const version = ++sessionVersion
    return {
      value: cleaned,
      version,
      synchronized: enqueueElectronSync(cleaned),
    }
  }

  async function applyCookie(c: string): Promise<{ value: string; version: number }> {
    const staged = stageCookie(c)
    await staged.synchronized
    return { value: staged.value, version: staged.version }
  }

  async function setCookie(c: string): Promise<string> {
    return (await applyCookie(c)).value
  }

  function setProfile(p: UserProfile) {
    profile.value = p
    isLoggedIn.value = true
  }

  async function completeLogin(rawCookie: string): Promise<UserProfile> {
    const previousCookie = cookie.value
    let loginVersion = sessionVersion
    try {
      const applied = stageCookie(rawCookie)
      const cleaned = applied.value
      loginVersion = applied.version
      if (!cleaned) throw new Error('登录响应中没有有效凭证')
      await applied.synchronized

      // This request runs only after Electron has acknowledged the new session.
      const user = await getUserAccount()
      if (sessionVersion !== loginVersion || cookie.value !== cleaned) {
        throw new Error('登录流程已被新的会话操作替代')
      }
      if (!user) throw new Error('登录凭证未生效，无法读取用户资料')
      setProfile(user)
      return user
    } catch (error) {
      // A failed verification must not leave renderer and main on different
      // credentials. Restore the previous session before reporting failure.
      if (sessionVersion === loginVersion) {
        try {
          await applyCookie(previousCookie)
        } catch {
          cookie.value = persistAuthCookie(previousCookie)
        }
      }
      throw error
    }
  }

  async function restoreSession(): Promise<UserProfile | null> {
    if (restorePromise) return restorePromise

    restorePromise = (async () => {
      const restoreCookie = cookie.value
      const restoreVersion = sessionVersion
      await enqueueElectronSync(restoreCookie)
      if (sessionVersion !== restoreVersion || cookie.value !== restoreCookie) return null
      if (!restoreCookie) return null

      const user = await getUserAccount()
      if (sessionVersion !== restoreVersion || cookie.value !== restoreCookie) return null
      if (!user) return null
      setProfile(user)
      return user
    })()

    try {
      return await restorePromise
    } finally {
      restorePromise = null
    }
  }

  async function logout(): Promise<void> {
    cookie.value = ''
    profile.value = null
    isLoggedIn.value = false
    await applyCookie('')
  }

  return {
    cookie,
    profile,
    isLoggedIn,
    setCookie,
    setProfile,
    completeLogin,
    restoreSession,
    logout,
  }
})
