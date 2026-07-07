import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Song } from '@/types'
import { getPlaylistTracks } from '@/lib/api'

interface CachedPlaylist {
  tracks: Song[]
  total: number
  loading: boolean
  allLoaded: boolean
}

const STORAGE_KEY = 'umon-playlist-cache'
const BATCH_SIZE = 100

export const usePlaylistCacheStore = defineStore('playlistCache', () => {
  const cache = ref<Map<number, CachedPlaylist>>(new Map())
  const loadingPromises = new Map<number, Promise<Song[]>>()

  // Load cache from localStorage on init
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as Record<string, { tracks: Song[]; total: number; allLoaded: boolean }>
      for (const [key, value] of Object.entries(data)) {
        cache.value.set(Number(key), {
          tracks: value.tracks,
          total: value.total,
          loading: false,
          allLoaded: value.allLoaded,
        })
      }
    } catch { /* corrupted data, ignore */ }
  }

  // Save cache to localStorage
  function saveToStorage() {
    try {
      const data: Record<string, { tracks: Song[]; total: number; allLoaded: boolean }> = {}
      for (const [key, value] of cache.value.entries()) {
        data[key] = {
          tracks: value.tracks,
          total: value.total,
          allLoaded: value.allLoaded,
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* quota exceeded, ignore */ }
  }

  // Initialize on store creation
  loadFromStorage()

  function get(playlistId: number): CachedPlaylist | undefined {
    return cache.value.get(playlistId)
  }

  function has(playlistId: number): boolean {
    return cache.value.has(playlistId)
  }

  function init(playlistId: number, total: number) {
    if (!cache.value.has(playlistId)) {
      cache.value.set(playlistId, {
        tracks: [],
        total,
        loading: false,
        allLoaded: false,
      })
    }
  }

  // Load first batch (for immediate display)
  async function loadFirst(playlistId: number, total: number): Promise<Song[]> {
    init(playlistId, total)
    const entry = cache.value.get(playlistId)!
    if (entry.tracks.length > 0) return entry.tracks

    entry.loading = true
    try {
      const result = await getPlaylistTracks(playlistId, 0, BATCH_SIZE)
      entry.tracks = result.songs
      entry.allLoaded = !result.hasMore
      saveToStorage()
      return entry.tracks
    } catch (e) {
      console.error('[PlaylistCache] loadFirst error:', e)
      return []
    } finally {
      entry.loading = false
    }
  }

  // Load all remaining tracks in background (with Promise lock)
  async function loadAll(playlistId: number): Promise<Song[]> {
    const entry = cache.value.get(playlistId)
    if (!entry) return []
    if (entry.allLoaded) return entry.tracks

    // Return existing promise if already loading
    const existing = loadingPromises.get(playlistId)
    if (existing) return existing

    const promise = doLoadAll(playlistId, entry)
    loadingPromises.set(playlistId, promise)
    try {
      return await promise
    } finally {
      loadingPromises.delete(playlistId)
    }
  }

  async function doLoadAll(playlistId: number, entry: CachedPlaylist): Promise<Song[]> {
    entry.loading = true
    try {
      while (!entry.allLoaded) {
        const offset = entry.tracks.length
        const result = await getPlaylistTracks(playlistId, offset, BATCH_SIZE)
        // Deduplicate by id
        const existingIds = new Set(entry.tracks.map(s => s.id))
        const newSongs = result.songs.filter(s => !existingIds.has(s.id))
        if (newSongs.length === 0) {
          entry.allLoaded = true
          break
        }
        entry.tracks = [...entry.tracks, ...newSongs]
        entry.allLoaded = !result.hasMore
        saveToStorage()
        if (!entry.allLoaded) {
          await new Promise(r => setTimeout(r, 100))
        }
      }
      return entry.tracks
    } catch (e) {
      console.error('[PlaylistCache] loadAll error:', e)
      return entry.tracks
    } finally {
      entry.loading = false
    }
  }

  function getTracks(playlistId: number): Song[] {
    return cache.value.get(playlistId)?.tracks ?? []
  }

  function isAllLoaded(playlistId: number): boolean {
    return cache.value.get(playlistId)?.allLoaded ?? false
  }

  function clear(playlistId: number) {
    cache.value.delete(playlistId)
    saveToStorage()
  }

  function clearAll() {
    cache.value.clear()
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    cache,
    get,
    has,
    init,
    loadFirst,
    loadAll,
    getTracks,
    isAllLoaded,
    clear,
    clearAll,
  }
})
