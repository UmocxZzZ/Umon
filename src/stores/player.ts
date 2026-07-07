import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Song, PlayMode, LyricLine } from '@/types'
import { shuffleArray } from '@/lib/utils'
import { getSongUrl, getLyric } from '@/lib/api'

export const usePlayerStore = defineStore('player', () => {
  // HTML5 Audio for immediate playback
  const audio = new Audio()
  audio.preload = 'auto'

  // Web Audio API for gapless transitions
  let gaplessCtx: AudioContext | null = null
  let gaplessGain: GainNode | null = null
  let currentSource: AudioBufferSourceNode | null = null

  // Buffer cache: songId → AudioBuffer
  const bufferCache = new Map<number, AudioBuffer>()
  const bufferFetchPromises = new Map<number, Promise<void>>()

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

  const urlCache = new Map<number, string | null>()
  // Track which song is currently using WebAudio (gapless mode)
  let gaplessSongId: number | null = null
  let gaplessStartTime = 0
  let isSeeking = false // Flag to prevent onended during seek

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

  // HTML5 Audio events
  audio.addEventListener('timeupdate', () => {
    if (gaplessSongId !== currentSong.value?.id) {
      currentTime.value = audio.currentTime
    }
  })
  audio.addEventListener('loadedmetadata', () => {
    if (gaplessSongId !== currentSong.value?.id) {
      duration.value = audio.duration
    }
  })
  audio.addEventListener('ended', () => {
    if (gaplessSongId !== currentSong.value?.id) {
      next()
    }
  })
  audio.addEventListener('play', () => {
    if (gaplessSongId !== currentSong.value?.id) {
      isPlaying.value = true
    }
  })
  audio.addEventListener('pause', () => {
    if (gaplessSongId !== currentSong.value?.id) {
      isPlaying.value = false
    }
  })

  watch(volume, (v) => {
    audio.volume = v
    if (gaplessGain) gaplessGain.gain.value = v
    localStorage.setItem('umon-volume', String(v))
  })

  function addToHistory(song: Song) {
    const idx = playHistory.value.findIndex((s) => s.id === song.id)
    if (idx !== -1) playHistory.value.splice(idx, 1)
    playHistory.value.unshift(song)
    if (playHistory.value.length > 200) playHistory.value.pop()
    localStorage.setItem('umon-history', JSON.stringify(playHistory.value))
  }

  // Ensure Web Audio API context exists
  function ensureGaplessCtx() {
    if (!gaplessCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      gaplessCtx = new AC()
      gaplessGain = gaplessCtx.createGain()
      gaplessGain.gain.value = volume.value
      gaplessGain.connect(gaplessCtx.destination)
    }
    if (gaplessCtx.state === 'suspended') gaplessCtx.resume()
  }

  // Fetch audio buffer via proxy
  async function fetchBuffer(songId: number): Promise<AudioBuffer | null> {
    if (bufferCache.has(songId)) return bufferCache.get(songId)!
    if (bufferFetchPromises.has(songId)) {
      await bufferFetchPromises.get(songId)
      return bufferCache.get(songId) ?? null
    }

    const url = urlCache.get(songId)
    if (!url) return null

    const promise = (async () => {
      try {
        ensureGaplessCtx()
        const proxyUrl = toProxyUrl(url)
        const resp = await fetch(proxyUrl)
        const arrayBuffer = await resp.arrayBuffer()
        const audioBuffer = await gaplessCtx!.decodeAudioData(arrayBuffer)
        bufferCache.set(songId, audioBuffer)
      } catch (e) {
        console.warn('[Player] fetchBuffer failed:', e)
      }
    })()

    bufferFetchPromises.set(songId, promise)
    await promise
    return bufferCache.get(songId) ?? null
  }

  // Pre-fetch next song buffer
  function prefetchNextBuffer() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length <= 1) return
    const nextIdx = (currentIndex.value + 1) % list.length
    const nextSong = list[nextIdx]
    if (nextSong && !bufferCache.has(nextSong.id)) {
      fetchBuffer(nextSong.id)
    }
  }

  // Play via WebAudio buffer (gapless)
  function playBuffer(song: Song, buffer: AudioBuffer, startOffset = 0) {
    ensureGaplessCtx()

    // Stop previous source without triggering onended
    if (currentSource) {
      const oldSource = currentSource
      currentSource = null
      gaplessSongId = null
      try { oldSource.onended = null } catch { /* ignore */ }
      try { oldSource.stop() } catch { /* ignore */ }
      try { oldSource.disconnect() } catch { /* ignore */ }
    }

    const source = gaplessCtx!.createBufferSource()
    source.buffer = buffer
    source.connect(gaplessGain!)
    source.start(0, startOffset)

    currentSource = source
    gaplessSongId = song.id
    gaplessStartTime = gaplessCtx!.currentTime - startOffset

    duration.value = buffer.duration
    isPlaying.value = true

    // Update currentTime via requestAnimationFrame
    let animId = 0
    const updateTime = () => {
      if (gaplessSongId !== song.id) return
      const elapsed = gaplessCtx!.currentTime - gaplessStartTime
      currentTime.value = Math.min(elapsed, buffer.duration)
      animId = requestAnimationFrame(updateTime)
    }
    updateTime()

    source.onended = () => {
      if (gaplessSongId === song.id && !isSeeking) {
        cancelAnimationFrame(animId)
        gaplessSongId = null
        next()
      }
    }
  }

  // Visualizer reconnect callback
  let onAudioSwitch: ((audioEl: HTMLAudioElement) => void) | null = null
  function setOnAudioSwitch(cb: (audioEl: HTMLAudioElement) => void) {
    onAudioSwitch = cb
  }

  // Main play function: try gapless buffer first, fallback to HTML5 Audio
  async function playSong(song: Song, url: string) {
    isLoading.value = false
    addToHistory(song)
    getLyric(song.id).then((l) => { lyrics.value = l })

    // Stop current gapless playback - clear onended FIRST to prevent triggering next()
    const oldSource = currentSource
    currentSource = null
    gaplessSongId = null
    if (oldSource) {
      try { oldSource.onended = null } catch { /* ignore */ }
      try { oldSource.stop() } catch { /* ignore */ }
      try { oldSource.disconnect() } catch { /* ignore */ }
    }

    // Try to use pre-fetched buffer for seamless playback
    const buffer = bufferCache.get(song.id)
    if (buffer) {
      playBuffer(song, buffer)
      // Keep HTML5 audio playing (muted) for captureStream visualization
      audio.src = toProxyUrl(url)
      audio.volume = 0 // Mute - WebAudio handles actual output
      audio.load()
      audio.play().catch(() => {}) // Must play for captureStream to work
      if (onAudioSwitch) onAudioSwitch(audio)
      setTimeout(prefetchNextBuffer, 500)
      return
    }

    // Fallback: play via HTML5 Audio immediately
    audio.src = toProxyUrl(url)
    audio.volume = volume.value
    audio.load()
    audio.play().catch(() => {})
    if (onAudioSwitch) onAudioSwitch(audio)

    // Fetch buffer in background for gapless transition next time
    fetchBuffer(song.id).then(() => {
      // Pre-fetch next song
      prefetchNextBuffer()
    })
  }

  async function loadAndPlay(song: Song) {
    isLoading.value = true
    try {
      let url = urlCache.get(song.id)
      if (!url) {
        url = await getSongUrl(song.id) ?? null
        if (url) urlCache.set(song.id, url)
      }
      if (url) {
        await playSong(song, url)
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
    setTimeout(prefetchNextBuffer, 2000)
  }

  function appendToPlaylist(songs: Song[]) {
    const existingIds = new Set(playlist.value.map(s => s.id))
    const newSongs = songs.filter(s => !existingIds.has(s.id))
    if (newSongs.length === 0) return
    playlist.value = [...playlist.value, ...newSongs]
    if (playMode.value === 'shuffle') {
      shuffledPlaylist.value = shuffleArray(playlist.value)
    }
    prefetchUrls(newSongs)
  }

  function play() {
    if (gaplessSongId && currentSource && gaplessCtx) {
      // Resume gapless playback
      gaplessCtx.resume()
      isPlaying.value = true
    } else if (audio.src) {
      audio.play()
      isPlaying.value = true
    } else if (currentSong.value) {
      loadAndPlay(currentSong.value)
    }
  }

  function pause() {
    if (gaplessSongId && gaplessCtx) {
      gaplessCtx.suspend()
      isPlaying.value = false
    } else {
      audio.pause()
      isPlaying.value = false
    }
  }

  function togglePlay() {
    if (isPlaying.value) pause()
    else play()
  }

  function next() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      if (gaplessSongId && currentSource) {
        currentSource.stop()
        gaplessSongId = null
      }
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
      if (gaplessSongId && currentSource) {
        currentSource.stop()
        gaplessSongId = null
      }
      audio.currentTime = 0
      audio.play()
      return
    }
    currentIndex.value = (currentIndex.value - 1 + list.length) % list.length
    loadAndPlay(list[currentIndex.value])
  }

  function seek(ratio: number) {
    if (!duration.value || !isFinite(duration.value)) return
    const t = ratio * duration.value

    if (gaplessSongId && currentSource && bufferCache.has(gaplessSongId)) {
      // Seek in gapless mode: restart buffer at new position
      isSeeking = true
      const buffer = bufferCache.get(gaplessSongId)!
      const song = currentSong.value
      if (song) {
        playBuffer(song, buffer, t)
      }
      isSeeking = false
    } else {
      audio.currentTime = t
      currentTime.value = t
    }
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
    if (gaplessGain) gaplessGain.gain.value = volume.value
  }

  function toggleFullScreen() {
    showFullScreen.value = !showFullScreen.value
  }

  function togglePlaylistDrawer() {
    showPlaylistDrawer.value = !showPlaylistDrawer.value
  }

  function saveState() {
    if (!currentSong.value) return
    try {
      localStorage.setItem('umon-player-state', JSON.stringify({
        song: currentSong.value,
        playlist: playlist.value,
        index: currentIndex.value,
        progress: gaplessSongId ? currentTime.value : audio.currentTime,
        mode: playMode.value,
      }))
    } catch { /* ignore */ }
  }

  let lastSaveTime = 0
  audio.addEventListener('timeupdate', () => {
    const now = Date.now()
    if (now - lastSaveTime > 5000) {
      lastSaveTime = now
      saveState()
    }
  })
  window.addEventListener('beforeunload', saveState)

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

      const savedProgress = state.progress ?? 0
      getSongUrl(state.song.id).then((url) => {
        if (!url) return
        urlCache.set(state.song.id, url)
        audio.src = toProxyUrl(url)
        audio.load()
        const onLoaded = () => {
          audio.currentTime = savedProgress
          currentTime.value = savedProgress
          audio.removeEventListener('loadedmetadata', onLoaded)
        }
        audio.addEventListener('loadedmetadata', onLoaded)
        isLoading.value = false
      })
      getLyric(state.song.id).then((l) => { lyrics.value = l })
    } catch { /* ignore */ }
  }

  restoreState()
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
    appendToPlaylist,
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
