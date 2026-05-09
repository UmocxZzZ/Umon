import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ThemeMode } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(
    (localStorage.getItem('umon-theme') as ThemeMode) || 'light',
  )

  const apiBase = ref(localStorage.getItem('umon-api-base') || '')
  const downloadDir = ref(localStorage.getItem('umon-download-dir') || '')

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

  function setApiBase(url: string) {
    apiBase.value = url
  }

  function setDownloadDir(path: string) {
    downloadDir.value = path
  }

  watch(theme, (val) => {
    localStorage.setItem('umon-theme', val)
    document.documentElement.classList.toggle('dark', val === 'dark')
  }, { immediate: true })

  watch(apiBase, (val) => {
    localStorage.setItem('umon-api-base', val)
  })

  watch(downloadDir, (val) => {
    localStorage.setItem('umon-download-dir', val)
  })

  return {
    theme, toggleTheme, setTheme,
    apiBase, setApiBase,
    downloadDir, setDownloadDir,
  }
})
