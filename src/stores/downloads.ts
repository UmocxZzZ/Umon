import { defineStore } from 'pinia'
import { ref, triggerRef } from 'vue'
import type { AudioQuality, Song } from '@/types'
import { getSongUrlInfo } from '@/lib/api'
import { DEFAULT_AUDIO_QUALITY, normalizeAudioQuality } from '@/lib/audioQuality'
import { useSettingsStore } from './settings'

export interface DownloadItem {
  song: Song
  status: 'downloading' | 'done' | 'error' | 'missing' | 'paused'
  filePath: string
  fileName: string
  progress: number
  downloaded: number
  totalSize: number
  speed: number
  timestamp: number
  url?: string
  quality: AudioQuality
}

interface StoredItem {
  song: Song
  status: DownloadItem['status']
  filePath: string
  fileName: string
  timestamp: number
  quality?: AudioQuality
}

const STORAGE_KEY = 'umon-downloads'

function loadItems(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const stored: StoredItem[] = JSON.parse(raw)
    return stored.map((s) => ({
      ...s,
      quality: normalizeAudioQuality(s.quality),
      progress: s.status === 'done' ? 100 : 0,
      downloaded: 0,
      totalSize: 0,
      speed: 0,
    }))
  } catch {
    return []
  }
}

function saveItems(items: DownloadItem[]) {
  const stored: StoredItem[] = items.map(({ song, status, filePath, fileName, timestamp, quality }) => ({
    song, status, filePath, fileName, timestamp, quality,
  }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function getAudioExtension(format: string | null, quality: AudioQuality): string {
  const normalized = format?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized === 'flac' || normalized === 'mp3' || normalized === 'm4a') {
    return `.${normalized}`
  }
  return quality === 'lossless' ? '.flac' : '.mp3'
}

let progressListenerRegistered = false

export const useDownloadsStore = defineStore('downloads', () => {
  const items = ref<DownloadItem[]>(loadItems())

  // Speed tracking state
  const speedTrackers = new Map<number, { lastBytes: number; lastTime: number }>()

  // Register Electron progress listener (only once)
  if (window.electronAPI?.onDownloadProgress && !progressListenerRegistered) {
    progressListenerRegistered = true
    window.electronAPI.onDownloadProgress(({ songId, percent, downloaded, totalSize }) => {
      const item = items.value.find((d) => d.song.id === songId)
      if (!item) return
      item.progress = percent
      item.downloaded = downloaded
      item.totalSize = totalSize

      // Calculate speed
      const now = Date.now()
      const tracker = speedTrackers.get(songId)
      if (tracker) {
        const elapsed = (now - tracker.lastTime) / 1000
        if (elapsed >= 0.5) {
          item.speed = (downloaded - tracker.lastBytes) / elapsed
          tracker.lastBytes = downloaded
          tracker.lastTime = now
        }
      } else {
        speedTrackers.set(songId, { lastBytes: downloaded, lastTime: now })
      }
    })
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.electronAPI?.removeDownloadProgressListener?.()
    })
  }

  function isDownloaded(songId: number): boolean {
    return items.value.some((d) => d.song.id === songId && d.status === 'done')
  }

  function getItem(songId: number): DownloadItem | undefined {
    return items.value.find((d) => d.song.id === songId)
  }

  async function downloadSong(
    song: Song,
    quality: AudioQuality = DEFAULT_AUDIO_QUALITY,
  ): Promise<void> {
    if (isDownloaded(song.id)) return

    // Remove existing entry (missing/error) to avoid duplicates
    items.value = items.value.filter((d) => d.song.id !== song.id)

    const settings = useSettingsStore()
    const fallbackExt = quality === 'lossless' ? '.flac' : '.mp3'
    const fileName = sanitizeFileName(`${song.artist} - ${song.name}${fallbackExt}`)

    const item: DownloadItem = {
      song,
      status: 'downloading',
      filePath: '',
      fileName,
      progress: 0,
      downloaded: 0,
      totalSize: 0,
      speed: 0,
      timestamp: Date.now(),
      quality,
    }
    items.value.unshift(item)
    saveItems(items.value)

    try {
      const songUrl = await getSongUrlInfo(song.id, quality)
      if (!songUrl.url) {
        item.status = 'error'
        saveItems(items.value)
        return
      }
      const actualExt = getAudioExtension(songUrl.type, quality)
      item.fileName = sanitizeFileName(`${song.artist} - ${song.name}${actualExt}`)
      item.url = songUrl.url
      const url = songUrl.url

      if (window.electronAPI?.downloadFile) {
        const result = await window.electronAPI.downloadFile({
          url,
          fileName: item.fileName,
          songId: song.id,
          downloadDir: settings.downloadDir,
        })
        if (result.ok) {
          item.status = 'done'
          item.filePath = result.filePath || ''
          item.progress = 100
          item.speed = 0
          triggerRef(items)
        } else {
          if (item.status !== 'paused') {
            item.status = 'error'
            item.speed = 0
          }
          triggerRef(items)
        }
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = item.fileName
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        item.status = 'done'
        item.progress = 100
      }
    } catch {
      if (item.status !== 'paused') {
        item.status = 'error'
        item.speed = 0
      }
    }

    speedTrackers.delete(song.id)
    saveItems(items.value)
  }

  function pauseDownload(songId: number) {
    const item = items.value.find((d) => d.song.id === songId)
    if (!item || item.status !== 'downloading') return
    item.status = 'paused'
    item.speed = 0
    speedTrackers.delete(songId)
    if (window.electronAPI?.pauseDownload) {
      window.electronAPI.pauseDownload(songId)
    }
    triggerRef(items)
    saveItems(items.value)
  }

  async function resumeDownload(songId: number) {
    const item = items.value.find((d) => d.song.id === songId)
    if (!item || item.status !== 'paused') return
    item.status = 'downloading'
    item.speed = 0

    const settings = useSettingsStore()

    if (window.electronAPI?.resumeDownload && item.url) {
      const result = await window.electronAPI.resumeDownload({
        url: item.url,
        fileName: item.fileName,
        songId: item.song.id,
        downloadDir: settings.downloadDir,
      })
      if (result.ok) {
        item.status = 'done'
        item.filePath = result.filePath || ''
        item.progress = 100
        item.speed = 0
      } else {
        item.status = 'error'
        item.speed = 0
      }
    } else {
      await downloadSong(item.song)
    }
    speedTrackers.delete(songId)
    saveItems(items.value)
  }

  function cancelDownload(songId: number) {
    const item = items.value.find((d) => d.song.id === songId)
    if (item) {
      item.status = 'error'
      item.speed = 0
      item.progress = 0
    }
    speedTrackers.delete(songId)
    if (window.electronAPI?.cancelDownload) {
      window.electronAPI.cancelDownload(songId)
    }
    triggerRef(items)
    saveItems(items.value)
  }

  function pauseAll() {
    for (const item of items.value) {
      if (item.status === 'downloading') {
        pauseDownload(item.song.id)
      }
    }
  }

  async function resumeAll() {
    for (const item of items.value) {
      if (item.status === 'paused') {
        await resumeDownload(item.song.id)
      }
    }
  }

  function cancelAll() {
    for (const item of items.value) {
      if (item.status === 'downloading' || item.status === 'paused') {
        cancelDownload(item.song.id)
      }
    }
  }

  async function checkFileExists(): Promise<void> {
    if (!window.electronAPI?.checkFile) return
    for (const item of items.value) {
      if (item.status === 'done') {
        try {
          const exists = await window.electronAPI.checkFile(item.filePath)
          if (!exists) item.status = 'missing'
        } catch {
          item.status = 'missing'
        }
      }
    }
    saveItems(items.value)
  }

  async function redownload(item: DownloadItem): Promise<void> {
    item.status = 'downloading'
    item.progress = 0
    item.downloaded = 0
    item.speed = 0
    item.timestamp = Date.now()
    await downloadSong(item.song, item.quality)
  }

  function removeItem(songId: number) {
    if (window.electronAPI?.cancelDownload) {
      window.electronAPI.cancelDownload(songId)
    }
    speedTrackers.delete(songId)
    items.value = items.value.filter((d) => d.song.id !== songId)
    triggerRef(items)
    saveItems(items.value)
  }

  function openFileFolder(filePath: string) {
    if (window.electronAPI?.openFolder) {
      window.electronAPI.openFolder(filePath)
    }
  }

  const activeDownloads = () => items.value.filter((d) => d.status === 'downloading' || d.status === 'paused')

  return {
    items,
    isDownloaded,
    getItem,
    downloadSong,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    pauseAll,
    resumeAll,
    cancelAll,
    checkFileExists,
    redownload,
    removeItem,
    openFileFolder,
    activeDownloads,
  }
})
