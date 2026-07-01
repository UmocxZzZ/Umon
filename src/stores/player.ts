import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Song, PlayMode, LyricLine } from '@/types'
import { shuffleArray } from '@/lib/utils'
import { getSongUrl, getLyric } from '@/lib/api'

export const usePlayerStore = defineStore('player', () => {
  // Double audio elements for seamless playback
  const audioA = new Audio()
  const audioB = new Audio()
  audioA.preload = 'auto'
  audioB.preload = 'auto'
  let activeAudio: HTMLAudioElement = audioA
  let preloadedSongId: number | null = null

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

  // Setup event listeners for both audio elements
  function setupAudioEvents(a: HTMLAudioElement) {
    a.addEventListener('timeupdate', () => {
      if (a === activeAudio) currentTime.value = a.currentTime
    })
    a.addEventListener('loadedmetadata', () => {
      if (a === activeAudio) duration.value = a.duration
    })
    a.addEventListener('ended', () => {
      if (a === activeAudio) next()
    })
    a.addEventListener('play', () => {
      if (a === activeAudio) isPlaying.value = true
    })
    a.addEventListener('pause', () => {
      if (a === activeAudio) isPlaying.value = false
    })
  }
  setupAudioEvents(audioA)
  setupAudioEvents(audioB)

  watch(volume, (v) => {
    activeAudio.volume = v
    localStorage.setItem('umon-volume', String(v))
  })

  function addToHistory(song: Song) {
    const idx = playHistory.value.findIndex((s) => s.id === song.id)
    if (idx !== -1) playHistory.value.splice(idx, 1)
    playHistory.value.unshift(song)
    if (playHistory.value.length > 200) playHistory.value.pop()
    localStorage.setItem('umon-history', JSON.stringify(playHistory.value))
  }

  // Callback for visualizer reconnection - passes new audio element directly
  let onAudioSwitch: ((newAudio: HTMLAudioElement) => void) | null = null
  function setOnAudioSwitch(cb: (newAudio: HTMLAudioElement) => void) {
    onAudioSwitch = cb
  }

  // Switch to the other audio element for seamless playback
  function switchAudio(song: Song, url: string) {
    const newAudio = activeAudio === audioA ? audioB : audioA
    const oldAudio = activeAudio

    // Setup new audio BEFORE pausing old
    newAudio.src = toProxyUrl(url)
    newAudio.volume = volume.value

    // Switch active audio first (events will now target new audio)
    activeAudio = newAudio
    preloadedSongId = null

    // Update SMTC metadata
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artist,
        album: song.album || '',
        artwork: song.cover
          ? [{ src: song.cover, sizes: '256x256', type: 'image/jpeg' }]
          : [],
      })
      navigator.mediaSession.playbackState = 'playing'
    }

    // Start new audio FIRST (seamless overlap)
    newAudio.play().catch(() => {})

    // THEN pause old audio (after new one starts)
    setTimeout(() => oldAudio.pause(), 50)

    // Notify visualizer to reconnect - pass new audio element directly
    if (onAudioSwitch) {
      setTimeout(() => onAudioSwitch!(newAudio), 30)
    }

    getLyric(song.id).then((l) => { lyrics.value = l })
    isLoading.value = false

    // Preload adjacent songs after a delay
    setTimeout(preloadAdjacent, 500)
  }

  // Synchronous play — called when URL is already cached (preserves user gesture)
  function playWithUrl(song: Song, url: string) {
    switchAudio(song, url)
  }

  async function loadAndPlay(song: Song) {
    isLoading.value = true
    addToHistory(song)
    try {
      let url = urlCache.get(song.id)
      if (url) {
        playWithUrl(song, url)
      } else {
        url = await getSongUrl(song.id) ?? null
        urlCache.set(song.id, url)
        if (url) {
          switchAudio(song, url)
        }
        getLyric(song.id).then((l) => { lyrics.value = l })
      }
    } catch (e) {
      console.error('[Player] load error:', e)
    } finally {
      isLoading.value = false
    }
  }

  // Preload next/prev songs
  function preloadSong(song: Song) {
    const url = urlCache.get(song.id)
    if (!url) return
    if (preloadedSongId === song.id) return

    const idleAudio = activeAudio === audioA ? audioB : audioA
    idleAudio.src = toProxyUrl(url)
    idleAudio.preload = 'auto'
    idleAudio.load()
    preloadedSongId = song.id
  }

  function preloadAdjacent() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length <= 1) return
    const nextIdx = (currentIndex.value + 1) % list.length
    if (list[nextIdx]) preloadSong(list[nextIdx])
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
    if (activeAudio.src) {
      activeAudio.play()
    } else if (currentSong.value) {
      loadAndPlay(currentSong.value)
    }
    isPlaying.value = true
  }

  function pause() {
    activeAudio.pause()
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
      activeAudio.currentTime = 0
      activeAudio.play()
      return
    }
    currentIndex.value = (currentIndex.value + 1) % list.length
    loadAndPlay(list[currentIndex.value])
  }

  function prev() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      activeAudio.currentTime = 0
      activeAudio.play()
      return
    }
    currentIndex.value = (currentIndex.value - 1 + list.length) % list.length
    loadAndPlay(list[currentIndex.value])
  }

  function seek(ratio: number) {
    const t = ratio * duration.value
    activeAudio.currentTime = t
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
    activeAudio.volume = volume.value
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
        progress: activeAudio.currentTime,
        mode: playMode.value,
      }))
    } catch { /* quota exceeded, ignore */ }
  }

  // Save periodically (throttled) and on close
  let lastSaveTime = 0
  function onTimeUpdate() {
    const now = Date.now()
    if (now - lastSaveTime > 5000) {
      lastSaveTime = now
      saveState()
    }
  }
  audioA.addEventListener('timeupdate', onTimeUpdate)
  audioB.addEventListener('timeupdate', onTimeUpdate)
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
        activeAudio.src = toProxyUrl(url)
        activeAudio.load()
        // Seek once metadata is loaded
        const onLoaded = () => {
          activeAudio.currentTime = savedProgress
          currentTime.value = savedProgress
          activeAudio.removeEventListener('loadedmetadata', onLoaded)
        }
        activeAudio.addEventListener('loadedmetadata', onLoaded)
        // Don't auto-play, just load the track
        isLoading.value = false
      })
      getLyric(state.song.id).then((l) => { lyrics.value = l })
    } catch { /* corrupted data, ignore */ }
  }

  restoreState()

  // Init volume
  activeAudio.volume = volume.value

  return {
    get audio() { return activeAudio },
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
    setOnAudioSwitch,
    togglePlaylistDrawer,
    prefetchUrls,
  }
})
