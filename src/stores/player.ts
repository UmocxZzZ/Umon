import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Song, PlayMode, LyricLine } from '@/types'
import { shuffleArray } from '@/lib/utils'
import { getSongUrl, getLyric } from '@/lib/api'

export const usePlayerStore = defineStore('player', () => {
  const audio = new Audio()
  audio.preload = 'auto'

  const playlist = ref<Song[]>([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const playMode = ref<PlayMode>('list')
  const volume = ref(parseFloat(localStorage.getItem('umon-volume') ?? '0.7'))
  const currentTime = ref(0)
  const duration = ref(0)
  const showFullScreen = ref(false)
  const showPlaylistDrawer = ref(false)
  const shuffledPlaylist = ref<Song[]>([])
  const lyrics = ref<LyricLine[]>([])
  const isLoading = ref(false)
  const playHistory = ref<Song[]>(
    JSON.parse(localStorage.getItem('umon-history') || '[]'),
  )

  // URL cache: songId → resolved URL (or null if fetch failed)
  const urlCache = new Map<number, string | null>()

  // Convert CDN URL to proxy URL for CORS bypass (needed for Web Audio API)
  function toProxyUrl(url: string): string {
    if (!url || url.startsWith('/__audio-proxy/')) return url
    return `/__audio-proxy/${encodeURIComponent(url)}`
  }

  function prefetchUrls(songs: Song[]) {
    const MAX_PREFETCH = 30
    const CONCURRENCY = 5
    const toFetch = songs.filter((s) => !urlCache.has(s.id)).slice(0, MAX_PREFETCH)
    for (const song of toFetch) {
      urlCache.set(song.id, null)
    }
    let i = 0
    function next() {
      if (i >= toFetch.length) return
      const song = toFetch[i++]
      getSongUrl(song.id).then((url) => {
        urlCache.set(song.id, url)
        next()
      })
    }
    for (let c = 0; c < Math.min(CONCURRENCY, toFetch.length); c++) next()
  }

  const currentSong = computed(() => playlist.value[currentIndex.value] ?? null)

  const progress = computed(() =>
    duration.value > 0 ? currentTime.value / duration.value : 0,
  )

  const currentLyricIndex = computed(() => {
    const t = currentTime.value
    let idx = -1
    for (let i = 0; i < lyrics.value.length; i++) {
      if (lyrics.value[i].time <= t) idx = i
      else break
    }
    return idx
  })

  // Sync audio events
  audio.addEventListener('timeupdate', () => {
    currentTime.value = audio.currentTime
  })
  audio.addEventListener('loadedmetadata', () => {
    duration.value = audio.duration
  })
  audio.addEventListener('ended', () => {
    next()
  })
  audio.addEventListener('play', () => {
    isPlaying.value = true
  })
  audio.addEventListener('pause', () => {
    isPlaying.value = false
  })

  watch(volume, (v) => {
    audio.volume = v
    localStorage.setItem('umon-volume', String(v))
  })

  function addToHistory(song: Song) {
    const idx = playHistory.value.findIndex((s) => s.id === song.id)
    if (idx !== -1) playHistory.value.splice(idx, 1)
    playHistory.value.unshift(song)
    if (playHistory.value.length > 200) playHistory.value.pop()
    localStorage.setItem('umon-history', JSON.stringify(playHistory.value))
  }

  // Synchronous play — called when URL is already cached (preserves user gesture)
  function playWithUrl(song: Song, url: string) {
    audio.pause()
    audio.src = toProxyUrl(url)
    audio.load()
    audio.play().catch(() => {})
    getLyric(song.id).then((l) => { lyrics.value = l })
    isLoading.value = false
  }

  async function loadAndPlay(song: Song) {
    isLoading.value = true
    addToHistory(song)
    try {
      let url = urlCache.get(song.id)
      if (url) {
        // Cached with valid URL: play synchronously
        playWithUrl(song, url)
      } else {
        // Not cached or cached as null (prefetch placeholder / failed): fetch now
        url = await getSongUrl(song.id) ?? null
        urlCache.set(song.id, url)
        if (url) {
          audio.pause()
          audio.src = toProxyUrl(url)
          audio.load()
          audio.play().catch(() => {})
        }
        getLyric(song.id).then((l) => { lyrics.value = l })
      }
    } catch (e) {
      console.error('[Player] load error:', e)
    } finally {
      isLoading.value = false
    }
  }


  function setPlaylist(songs: Song[], index = 0) {
    playlist.value = songs
    currentIndex.value = index
    if (playMode.value === 'shuffle') {
      shuffledPlaylist.value = shuffleArray(songs)
    }
    prefetchUrls(songs)
    if (songs[index]) {
      loadAndPlay(songs[index])
    }
  }

  function play() {
    if (audio.src) {
      audio.play()
    } else if (currentSong.value) {
      loadAndPlay(currentSong.value)
    }
    isPlaying.value = true
  }

  function pause() {
    audio.pause()
    isPlaying.value = false
  }

  function togglePlay() {
    if (isPlaying.value) pause()
    else play()
  }

  function next() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      audio.currentTime = 0
      audio.play()
      return
    }
    currentIndex.value = (currentIndex.value + 1) % list.length
    loadAndPlay(list[currentIndex.value])
  }

  function prev() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      audio.currentTime = 0
      audio.play()
      return
    }
    currentIndex.value = (currentIndex.value - 1 + list.length) % list.length
    loadAndPlay(list[currentIndex.value])
  }

  function seek(ratio: number) {
    const t = ratio * duration.value
    audio.currentTime = t
    currentTime.value = t
  }

  function setPlayMode(mode: PlayMode) {
    playMode.value = mode
    if (mode === 'shuffle') {
      shuffledPlaylist.value = shuffleArray(playlist.value)
    }
  }

  function togglePlayMode() {
    const modes: PlayMode[] = ['list', 'single', 'shuffle']
    const i = modes.indexOf(playMode.value)
    setPlayMode(modes[(i + 1) % modes.length])
  }

  function setCurrentTime(t: number) {
    currentTime.value = t
  }

  function setDuration(d: number) {
    duration.value = d
  }

  function setVolume(v: number) {
    volume.value = Math.max(0, Math.min(1, v))
    audio.volume = volume.value
  }

  function toggleFullScreen() {
    showFullScreen.value = !showFullScreen.value
  }

  function togglePlaylistDrawer() {
    showPlaylistDrawer.value = !showPlaylistDrawer.value
  }

  // --- Persist & restore player state ---
  function saveState() {
    if (!currentSong.value) return
    try {
      localStorage.setItem('umon-player-state', JSON.stringify({
        song: currentSong.value,
        playlist: playlist.value,
        index: currentIndex.value,
        progress: audio.currentTime,
        mode: playMode.value,
      }))
    } catch { /* quota exceeded, ignore */ }
  }

  // Save periodically (throttled) and on close
  let lastSaveTime = 0
  audio.addEventListener('timeupdate', () => {
    const now = Date.now()
    if (now - lastSaveTime > 5000) {
      lastSaveTime = now
      saveState()
    }
  })
  window.addEventListener('beforeunload', saveState)

  // Restore on init
  function restoreState() {
    try {
      const raw = localStorage.getItem('umon-player-state')
      if (!raw) return
      const state = JSON.parse(raw) as {
        song: Song
        playlist: Song[]
        index: number
        progress: number
        mode: PlayMode
      }
      if (!state.song || !state.playlist?.length) return

      playlist.value = state.playlist
      currentIndex.value = state.index
      playMode.value = state.mode ?? 'list'
      if (state.mode === 'shuffle') {
        shuffledPlaylist.value = shuffleArray(state.playlist)
      }

      // Load the song URL and seek to saved progress
      const savedProgress = state.progress ?? 0
      getSongUrl(state.song.id).then((url) => {
        if (!url) return
        urlCache.set(state.song.id, url)
        audio.src = toProxyUrl(url)
        audio.load()
        // Seek once metadata is loaded
        const onLoaded = () => {
          audio.currentTime = savedProgress
          currentTime.value = savedProgress
          audio.removeEventListener('loadedmetadata', onLoaded)
        }
        audio.addEventListener('loadedmetadata', onLoaded)
        // Don't auto-play, just load the track
        isLoading.value = false
      })
      getLyric(state.song.id).then((l) => { lyrics.value = l })
    } catch { /* corrupted data, ignore */ }
  }

  restoreState()

  // Init volume
  audio.volume = volume.value

  return {
    audio,
    playlist,
    currentIndex,
    isPlaying,
    playMode,
    volume,
    currentTime,
    duration,
    showFullScreen,
    showPlaylistDrawer,
    currentSong,
    progress,
    lyrics,
    currentLyricIndex,
    isLoading,
    playHistory,
    setPlaylist,
    play,
    pause,
    togglePlay,
    next,
    prev,
    seek,
    setPlayMode,
    togglePlayMode,
    setCurrentTime,
    setDuration,
    setVolume,
    toggleFullScreen,
    togglePlaylistDrawer,
    prefetchUrls,
  }
})
