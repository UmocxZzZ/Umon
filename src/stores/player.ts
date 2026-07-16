import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Song, PlayMode, LyricLine } from '@/types'
import { shuffleArray } from '@/lib/utils'
import { getSongUrl, getLyric } from '@/lib/api'
import {
  attachMediaElement,
  connectAudioSource,
  getPlaybackContext,
  resumeAudioEngine,
  setAudioOutputVolume,
  suspendAudioEngine,
} from '@/lib/audioEngine'

export const usePlayerStore = defineStore('player', () => {
  // HTML5 Audio for immediate playback
  const audio = new Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'

  // Web Audio API for gapless transitions
  let currentSource: AudioBufferSourceNode | null = null

  // Buffer cache: songId → AudioBuffer
  const MAX_BUFFER_CACHE = 8
  const bufferCache = new Map<number, AudioBuffer>()
  const bufferFetchPromises = new Map<number, Promise<void>>()

  const playlist = ref<Song[]>([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const playMode = ref<PlayMode>('list')
  const volume = ref(parseFloat(localStorage.getItem('umon-volume') ?? '0.7'))
  const currentTime = ref(0)
  const duration = ref(0)
  const bufferedProgress = ref(0)
  const showFullScreen = ref(false)
  const showPlaylistDrawer = ref(false)
  const shuffledPlaylist = ref<Song[]>([])
  const lyrics = ref<LyricLine[]>([])
  const isLoading = ref(false)
  const playHistory = ref<Song[]>(
    JSON.parse(localStorage.getItem('umon-history') || '[]'),
  )

  const URL_CACHE_TTL = 4 * 60 * 1000
  const EMPTY_URL_CACHE_TTL = 15 * 1000
  const urlCache = new Map<number, { value: string | null; expiresAt: number }>()
  const urlFetchPromises = new Map<number, Promise<string | null>>()
  // Track which song is currently using WebAudio (gapless mode)
  let gaplessSongId: number | null = null
  let mediaSongId: number | null = null
  let gaplessStartTime = 0
  let isSeeking = false // Flag to prevent onended during seek
  let playbackRequestId = 0

  const isElectron = !!window.electronAPI

  function toProxyUrl(url: string): string {
    if (!url) return url
    // Electron adds CORS response headers in the main process. Web always uses
    // the same-origin proxy so MediaElementSource and fetch decode real samples.
    if (isElectron) return url
    if (url.startsWith('/__audio-proxy/')) return url
    return `/__audio-proxy/${encodeURIComponent(url)}`
  }

  function resolveSongUrl(songId: number): Promise<string | null> {
    const cached = urlCache.get(songId)
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value)
    }
    urlCache.delete(songId)

    const pending = urlFetchPromises.get(songId)
    if (pending) return pending

    const request = getSongUrl(songId)
      .then((url) => {
        urlCache.set(songId, {
          value: url,
          expiresAt: Date.now() + (url ? URL_CACHE_TTL : EMPTY_URL_CACHE_TTL),
        })
        return url
      })
      .finally(() => {
        urlFetchPromises.delete(songId)
      })

    urlFetchPromises.set(songId, request)
    return request
  }

  function prefetchUrls(songs: Song[]) {
    const MAX_PREFETCH = 30
    const CONCURRENCY = 5
    const toFetch = songs
      .filter((song) => {
        const cached = urlCache.get(song.id)
        return (!cached || cached.expiresAt <= Date.now())
          && !urlFetchPromises.has(song.id)
      })
      .slice(0, MAX_PREFETCH)
    let i = 0
    function next() {
      if (i >= toFetch.length) return
      const song = toFetch[i++]
      void resolveSongUrl(song.id).then(next, next)
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

  function updateMediaBufferedProgress() {
    if (mediaSongId !== currentSong.value?.id || gaplessSongId !== null) return

    const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : duration.value
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0 || audio.buffered.length === 0) {
      bufferedProgress.value = 0
      return
    }

    const bufferedEnd = audio.buffered.end(audio.buffered.length - 1)
    bufferedProgress.value = Math.max(0, Math.min(1, bufferedEnd / mediaDuration))
  }

  // HTML5 Audio events
  audio.addEventListener('timeupdate', () => {
    if (mediaSongId === currentSong.value?.id && gaplessSongId === null) {
      currentTime.value = audio.currentTime
    }
  })
  audio.addEventListener('loadedmetadata', () => {
    if (mediaSongId === currentSong.value?.id && gaplessSongId === null) {
      duration.value = audio.duration
      updateMediaBufferedProgress()
    }
  })
  audio.addEventListener('durationchange', updateMediaBufferedProgress)
  audio.addEventListener('progress', updateMediaBufferedProgress)
  audio.addEventListener('ended', () => {
    if (mediaSongId === currentSong.value?.id && gaplessSongId === null) {
      next()
    }
  })
  audio.addEventListener('play', () => {
    if (mediaSongId === currentSong.value?.id && gaplessSongId === null) {
      isPlaying.value = true
    }
  })
  audio.addEventListener('pause', () => {
    if (mediaSongId === currentSong.value?.id && gaplessSongId === null) {
      isPlaying.value = false
    }
  })
  audio.addEventListener('error', () => {
    if (mediaSongId !== currentSong.value?.id || !audio.error) return
    isPlaying.value = false
    console.warn(`[Player] media element error ${audio.error.code}: ${audio.error.message}`)
  })

  watch(volume, (v) => {
    setAudioOutputVolume(v)
    localStorage.setItem('umon-volume', String(v))
  })

  function addToHistory(song: Song) {
    const idx = playHistory.value.findIndex((s) => s.id === song.id)
    if (idx !== -1) playHistory.value.splice(idx, 1)
    playHistory.value.unshift(song)
    if (playHistory.value.length > 200) playHistory.value.pop()
    localStorage.setItem('umon-history', JSON.stringify(playHistory.value))
  }

  function getCachedBuffer(songId: number): AudioBuffer | null {
    const buffer = bufferCache.get(songId)
    if (!buffer) return null
    bufferCache.delete(songId)
    bufferCache.set(songId, buffer)
    return buffer
  }

  function cacheBuffer(songId: number, buffer: AudioBuffer) {
    bufferCache.delete(songId)
    bufferCache.set(songId, buffer)
    while (bufferCache.size > MAX_BUFFER_CACHE) {
      const oldestId = bufferCache.keys().next().value as number | undefined
      if (oldestId == null) break
      bufferCache.delete(oldestId)
    }
  }

  // Fetch audio buffer via proxy
  async function fetchBuffer(songId: number): Promise<AudioBuffer | null> {
    const cachedBuffer = getCachedBuffer(songId)
    if (cachedBuffer) return cachedBuffer
    if (bufferFetchPromises.has(songId)) {
      await bufferFetchPromises.get(songId)
      return getCachedBuffer(songId)
    }

    const url = await resolveSongUrl(songId)
    if (!url) return null

    const promise = (async () => {
      try {
        const context = getPlaybackContext()
        const proxyUrl = toProxyUrl(url)
        const resp = await fetch(proxyUrl)
        if (!resp.ok) throw new Error(`Audio fetch failed with HTTP ${resp.status}`)
        const arrayBuffer = await resp.arrayBuffer()
        const audioBuffer = await context.decodeAudioData(arrayBuffer)
        cacheBuffer(songId, audioBuffer)
      } catch (e) {
        console.warn('[Player] fetchBuffer failed:', e)
      } finally {
        bufferFetchPromises.delete(songId)
      }
    })()

    bufferFetchPromises.set(songId, promise)
    await promise
    return getCachedBuffer(songId)
  }

  // Pre-fetch next song buffer
  async function prefetchNextBuffer() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length <= 1) return
    const activeId = currentSong.value?.id
    const activeIndex = activeId == null ? -1 : list.findIndex((song) => song.id === activeId)
    const nextIdx = (activeIndex + 1) % list.length
    const nextSong = list[nextIdx]
    if (nextSong && !bufferCache.has(nextSong.id)) {
      await resolveSongUrl(nextSong.id)
      await fetchBuffer(nextSong.id)
    }
  }

  function stopBufferPlayback() {
    const source = currentSource
    currentSource = null
    gaplessSongId = null
    if (!source) return

    try { source.onended = null } catch { /* ignore */ }
    try { source.stop() } catch { /* ignore */ }
    try { source.disconnect() } catch { /* ignore */ }
  }

  function beginPlaybackRequest(): number {
    playbackRequestId += 1
    stopBufferPlayback()
    mediaSongId = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    bufferedProgress.value = 0
    return playbackRequestId
  }

  function isPlaybackRequestCurrent(requestId: number, song: Song): boolean {
    return playbackRequestId === requestId && currentSong.value?.id === song.id
  }

  // Play via WebAudio buffer (gapless)
  function playBuffer(song: Song, buffer: AudioBuffer, startOffset = 0) {
    const context = getPlaybackContext()
    void resumeAudioEngine()
    stopBufferPlayback()
    mediaSongId = null
    audio.pause()

    const source = context.createBufferSource()
    source.buffer = buffer
    connectAudioSource(source)
    source.start(0, startOffset)

    currentSource = source
    gaplessSongId = song.id
    gaplessStartTime = context.currentTime - startOffset

    duration.value = buffer.duration
    bufferedProgress.value = 1
    isPlaying.value = true

    // Update currentTime via requestAnimationFrame
    let animId = 0
    const updateTime = () => {
      if (gaplessSongId !== song.id) return
      const elapsed = context.currentTime - gaplessStartTime
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

  // Main play function: try gapless buffer first, fallback to HTML5 Audio
  async function playSong(song: Song, url: string, requestId: number) {
    if (!isPlaybackRequestCurrent(requestId, song)) return

    addToHistory(song)
    void getLyric(song.id).then((result) => {
      if (isPlaybackRequestCurrent(requestId, song)) lyrics.value = result
    })

    await resumeAudioEngine()
    if (!isPlaybackRequestCurrent(requestId, song)) return

    // Try to use pre-fetched buffer for seamless playback
    const buffer = getCachedBuffer(song.id)
    if (buffer) {
      playBuffer(song, buffer)
      window.setTimeout(() => { void prefetchNextBuffer() }, 500)
      return
    }

    // Fallback: the media element is permanently attached to the same analyser.
    mediaSongId = song.id
    audio.src = toProxyUrl(url)
    audio.load()
    try {
      await audio.play()
    } catch (e) {
      if (!isPlaybackRequestCurrent(requestId, song)) return
      isPlaying.value = false
      console.warn('[Player] playback start was blocked:', e)
    }

    // Fetch buffer in background for gapless transition next time
    void fetchBuffer(song.id).then(() => {
      if (isPlaybackRequestCurrent(requestId, song)) void prefetchNextBuffer()
    })
  }

  async function loadAndPlay(song: Song) {
    // Resume while the user gesture is still active; URL lookup may complete later.
    void resumeAudioEngine()
    const requestId = beginPlaybackRequest()
    isLoading.value = true
    lyrics.value = []
    try {
      const url = await resolveSongUrl(song.id)
      if (!isPlaybackRequestCurrent(requestId, song)) return
      if (!url) throw new Error(`No playable URL for song ${song.id}`)
      await playSong(song, url, requestId)
    } catch (e) {
      if (isPlaybackRequestCurrent(requestId, song)) {
        console.error('[Player] load error:', e)
      }
    } finally {
      if (isPlaybackRequestCurrent(requestId, song)) isLoading.value = false
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
      void loadAndPlay(songs[index])
    }
    window.setTimeout(() => { void prefetchNextBuffer() }, 2000)
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
    if (isLoading.value) return

    if (gaplessSongId && currentSource) {
      // Resume gapless playback
      void resumeAudioEngine()
      isPlaying.value = true
    } else if (audio.src) {
      void resumeAudioEngine().then(() => audio.play()).catch((e: unknown) => {
        isPlaying.value = false
        console.warn('[Player] playback resume was blocked:', e)
      })
    } else if (currentSong.value) {
      void loadAndPlay(currentSong.value)
    }
  }

  function pause() {
    if (gaplessSongId && currentSource) {
      void suspendAudioEngine()
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

  function restartCurrentSong() {
    const song = currentSong.value
    if (!song) return

    const buffer = getCachedBuffer(song.id)
    if (buffer) {
      playBuffer(song, buffer)
      audio.pause()
      return
    }

    audio.currentTime = 0
    void resumeAudioEngine().then(() => audio.play()).catch((e: unknown) => {
      isPlaying.value = false
      console.warn('[Player] playback restart was blocked:', e)
    })
  }

  function next() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      restartCurrentSong()
      return
    }

    const activeId = currentSong.value?.id
    const activeIndex = activeId == null ? -1 : list.findIndex((song) => song.id === activeId)
    const song = list[(activeIndex + 1) % list.length]
    currentIndex.value = playlist.value.findIndex((item) => item.id === song.id)
    void loadAndPlay(song)
  }

  function prev() {
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length === 0) return
    if (playMode.value === 'single') {
      restartCurrentSong()
      return
    }

    const activeId = currentSong.value?.id
    const activeIndex = activeId == null ? 0 : list.findIndex((song) => song.id === activeId)
    const song = list[(activeIndex - 1 + list.length) % list.length]
    currentIndex.value = playlist.value.findIndex((item) => item.id === song.id)
    void loadAndPlay(song)
  }

  function seek(ratio: number) {
    if (!duration.value || !isFinite(duration.value)) return
    const t = ratio * duration.value

    if (gaplessSongId && currentSource) {
      // Seek in gapless mode: restart buffer at new position
      isSeeking = true
      const buffer = getCachedBuffer(gaplessSongId)
      const song = currentSong.value
      if (song && buffer) {
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
      const restoreRequestId = playbackRequestId
      void resolveSongUrl(state.song.id).then((url) => {
        if (
          !url
          || playbackRequestId !== restoreRequestId
          || currentSong.value?.id !== state.song.id
        ) return

        mediaSongId = state.song.id
        audio.src = toProxyUrl(url)
        audio.load()
        const onLoaded = () => {
          if (mediaSongId !== state.song.id) {
            audio.removeEventListener('loadedmetadata', onLoaded)
            return
          }
          audio.currentTime = savedProgress
          currentTime.value = savedProgress
          audio.removeEventListener('loadedmetadata', onLoaded)
        }
        audio.addEventListener('loadedmetadata', onLoaded)
        isLoading.value = false
      })
      void getLyric(state.song.id).then((result) => {
        if (
          playbackRequestId === restoreRequestId
          && currentSong.value?.id === state.song.id
        ) lyrics.value = result
      })
    } catch { /* ignore */ }
  }

  attachMediaElement(audio)
  setAudioOutputVolume(volume.value, true)
  restoreState()

  return {
    audio,
    playlist,
    currentIndex,
    isPlaying,
    playMode,
    volume,
    currentTime,
    duration,
    bufferedProgress,
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
    togglePlaylistDrawer,
    prefetchUrls,
  }
})
