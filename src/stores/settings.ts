import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AudioQuality, ThemeMode } from '@/types'
import { normalizeAudioQuality } from '@/lib/audioQuality'
import { setAudioOutputDevice as applyAudioOutputDevice } from '@/lib/audioEngine'
import {
  normalizeElectronApiBase,
  syncElectronAuthSession,
} from '@/lib/authSession'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(
    (localStorage.getItem('umon-theme') as ThemeMode) || 'light',
  )

  const apiBase = ref(localStorage.getItem('umon-api-base') || '')
  const downloadDir = ref(localStorage.getItem('umon-download-dir') || '')
  const playbackQuality = ref<AudioQuality>(
    normalizeAudioQuality(localStorage.getItem('umon-playback-quality')),
  )
  // Empty means "follow the Windows default output device".
  const audioOutputDeviceId = ref(localStorage.getItem('umon-audio-output-device') || '')

  // Initialize default download path from system
  if (!localStorage.getItem('umon-download-dir') && window.electronAPI?.getDownloadPath) {
    window.electronAPI.getDownloadPath().then((p) => {
      if (!downloadDir.value) downloadDir.value = p
    })
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  function setTheme(t: ThemeMode) {
    theme.value = t
  }

  async function setApiBase(url: string): Promise<void> {
    const nextValue = normalizeElectronApiBase(url)
    const previousValue = apiBase.value

    apiBase.value = nextValue
    if (nextValue) localStorage.setItem('umon-api-base', nextValue)
    else localStorage.removeItem('umon-api-base')

    try {
      await syncElectronAuthSession()
    } catch (error) {
      apiBase.value = previousValue
      if (previousValue) localStorage.setItem('umon-api-base', previousValue)
      else localStorage.removeItem('umon-api-base')
      await syncElectronAuthSession()
      throw error
    }
  }

  function setDownloadDir(path: string) {
    downloadDir.value = path
  }

  function setPlaybackQuality(quality: AudioQuality) {
    playbackQuality.value = quality
  }

  async function setAudioOutputDevice(deviceId: string): Promise<void> {
    await applyAudioOutputDevice(deviceId)
    audioOutputDeviceId.value = deviceId
    if (deviceId) localStorage.setItem('umon-audio-output-device', deviceId)
    else localStorage.removeItem('umon-audio-output-device')
  }

  async function restoreAudioOutputDevice(): Promise<void> {
    if (!audioOutputDeviceId.value) return
    try {
      await applyAudioOutputDevice(audioOutputDeviceId.value)
    } catch (error) {
      // A Bluetooth/USB device may have been disconnected since the last run.
      // Fall back to the Windows default instead of leaving playback silent.
      console.warn('[Settings] Saved audio output is unavailable, using system default:', error)
      audioOutputDeviceId.value = ''
      localStorage.removeItem('umon-audio-output-device')
      await applyAudioOutputDevice('')
    }
  }

  watch(theme, (val) => {
    localStorage.setItem('umon-theme', val)
    document.documentElement.classList.toggle('dark', val === 'dark')
  }, { immediate: true })

  watch(downloadDir, (val) => {
    localStorage.setItem('umon-download-dir', val)
  })

  watch(playbackQuality, (val) => {
    localStorage.setItem('umon-playback-quality', val)
  })

  return {
    theme, toggleTheme, setTheme,
    apiBase, setApiBase,
    downloadDir, setDownloadDir,
    playbackQuality, setPlaybackQuality,
    audioOutputDeviceId, setAudioOutputDevice, restoreAudioOutputDevice,
  }
})
