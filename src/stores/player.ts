import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { AudioQuality, Song, PlayMode, LyricLine } from '@/types'
import { shuffleArray } from '@/lib/utils'
import { getSongUrl, getLyric } from '@/lib/api'
import { useSettingsStore } from '@/stores/settings'
import {
  attachMediaElement,
  connectAudioSource,
  getPlaybackContext,
  resumeAudioEngine,
  setAudioOutputVolume,
  suspendAudioEngine,
} from '@/lib/audioEngine'

export const usePlayerStore = defineStore('player', () => {
  const settings = useSettingsStore()

  // HTML5 Audio for immediate playback
  const audio = new Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'

  // Web Audio API for gapless transitions
  let currentSource: AudioBufferSourceNode | null = null

  interface CachedAudioBuffer {
    buffer: AudioBuffer
    bytes: number
    quality: AudioQuality
  }

  // Decoded PCM is expensive (~80 MiB for a four-minute stereo track). Keep
  // only the next track and enforce a byte budget instead of a song count.
  const MAX_DECODED_BUFFER_BYTES = 128 * 1024 * 1024
  const MAX_ENCODED_BUFFER_BYTES = 64 * 1024 * 1024
  const bufferCache = new Map<number, CachedAudioBuffer>()
  const bufferFetchPromises = new Map<string, Promise<AudioBuffer | null>>()
  const bufferFetchControllers = new Map<string, AbortController>()
  let bufferCacheBytes = 0
  let bufferWorkQueue: Promise<void> = Promise.resolve()
  let prefetchTimer: number | null = null
  let cancelMetadataWait: (() => void) | null = null

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
  const MAX_URL_CACHE_ENTRIES = 100
  const urlCache = new Map<string, { value: string | null; expiresAt: number }>()
  const urlFetchPromises = new Map<string, Promise<string | null>>()
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

  function getQualityCacheKey(songId: number, quality: AudioQuality): string {
    return `${quality}:${songId}`
  }

  function resolveSongUrl(
    songId: number,
    quality: AudioQuality = settings.playbackQuality,
  ): Promise<string | null> {
    const cacheKey = getQualityCacheKey(songId, quality)
    const cached = urlCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      urlCache.delete(cacheKey)
      urlCache.set(cacheKey, cached)
      return Promise.resolve(cached.value)
    }
    urlCache.delete(cacheKey)

    const pending = urlFetchPromises.get(cacheKey)
    if (pending) return pending

    const request = getSongUrl(songId, quality)
      .then((url) => {
        urlCache.set(cacheKey, {
          value: url,
          expiresAt: Date.now() + (url ? URL_CACHE_TTL : EMPTY_URL_CACHE_TTL),
        })
        while (urlCache.size > MAX_URL_CACHE_ENTRIES) {
          const oldestKey = urlCache.keys().next().value as string | undefined
          if (!oldestKey) break
          urlCache.delete(oldestKey)
        }
        return url
      })
      .finally(() => {
        urlFetchPromises.delete(cacheKey)
      })

    urlFetchPromises.set(cacheKey, request)
    return request
  }

  function prefetchUrls(songs: Song[]) {
    const MAX_PREFETCH = 30
    const CONCURRENCY = 5
    const toFetch = songs
      .filter((song) => {
        const cacheKey = getQualityCacheKey(song.id, settings.playbackQuality)
        const cached = urlCache.get(cacheKey)
        return (!cached || cached.expiresAt <= Date.now())
          && !urlFetchPromises.has(cacheKey)
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

  function estimateDecodedBufferBytes(buffer: AudioBuffer): number {
    return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  }

  function estimateTrackBufferBytes(song: Song, quality: AudioQuality): number {
    if (!Number.isFinite(song.duration) || song.duration <= 0) return 0
    // Lossless sources may decode above 48 kHz. Use a conservative estimate so
    // long high-resolution files stay on streaming playback instead of causing
    // a large transient allocation.
    const estimatedSampleRate = quality === 'lossless' ? 96_000 : 48_000
    return Math.ceil(
      song.duration * estimatedSampleRate * 2 * Float32Array.BYTES_PER_ELEMENT,
    )
  }

  function deleteCachedBuffer(songId: number): CachedAudioBuffer | null {
    const entry = bufferCache.get(songId)
    if (!entry) return null
    bufferCache.delete(songId)
    bufferCacheBytes = Math.max(0, bufferCacheBytes - entry.bytes)
    return entry
  }

  function getCachedBuffer(
    songId: number,
    quality: AudioQuality = settings.playbackQuality,
  ): AudioBuffer | null {
    const entry = bufferCache.get(songId)
    if (!entry) return null
    if (entry.quality !== quality) {
      deleteCachedBuffer(songId)
      return null
    }
    return entry.buffer
  }

  function takeCachedBuffer(
    songId: number,
    quality: AudioQuality = settings.playbackQuality,
  ): AudioBuffer | null {
    const buffer = getCachedBuffer(songId, quality)
    if (!buffer) return null
    deleteCachedBuffer(songId)
    return buffer
  }

  function clearCachedBuffers(exceptSongId: number | null = null) {
    for (const [songId, entry] of bufferCache) {
      if (songId !== exceptSongId || entry.quality !== settings.playbackQuality) {
        deleteCachedBuffer(songId)
      }
    }
  }

  function cacheBuffer(songId: number, quality: AudioQuality, buffer: AudioBuffer): boolean {
    const bytes = estimateDecodedBufferBytes(buffer)
    if (bytes > MAX_DECODED_BUFFER_BYTES) return false

    deleteCachedBuffer(songId)
    while (bufferCache.size > 0 || bufferCacheBytes + bytes > MAX_DECODED_BUFFER_BYTES) {
      const oldestId = bufferCache.keys().next().value as number | undefined
      if (oldestId == null) break
      deleteCachedBuffer(oldestId)
    }

    bufferCache.set(songId, { buffer, bytes, quality })
    bufferCacheBytes += bytes
    return true
  }

  function cancelPendingBufferWork() {
    if (prefetchTimer !== null) {
      window.clearTimeout(prefetchTimer)
      prefetchTimer = null
    }
    for (const controller of bufferFetchControllers.values()) controller.abort()
    bufferFetchControllers.clear()
    bufferFetchPromises.clear()
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
  }

  // Fetching and decoding are intentionally serialized: each operation can
  // temporarily own both the compressed response and a large decoded PCM copy.
  function fetchBuffer(
    song: Song,
    requestId: number,
    quality: AudioQuality = settings.playbackQuality,
  ): Promise<AudioBuffer | null> {
    const cachedBuffer = getCachedBuffer(song.id, quality)
    if (cachedBuffer) return Promise.resolve(cachedBuffer)
    if (estimateTrackBufferBytes(song, quality) > MAX_DECODED_BUFFER_BYTES) {
      return Promise.resolve(null)
    }

    const cacheKey = getQualityCacheKey(song.id, quality)
    const existing = bufferFetchPromises.get(cacheKey)
    if (existing) return existing

    const controller = new AbortController()
    bufferFetchControllers.set(cacheKey, controller)

    const work = bufferWorkQueue.then(async (): Promise<AudioBuffer | null> => {
      if (
        controller.signal.aborted
        || playbackRequestId !== requestId
        || settings.playbackQuality !== quality
      ) return null

      const url = await resolveSongUrl(song.id, quality)
      if (
        !url
        || controller.signal.aborted
        || playbackRequestId !== requestId
        || settings.playbackQuality !== quality
      ) return null

      const response = await fetch(toProxyUrl(url), { signal: controller.signal })
      if (!response.ok) throw new Error(`Audio fetch failed with HTTP ${response.status}`)

      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (declaredSize > MAX_ENCODED_BUFFER_BYTES) {
        await response.body?.cancel()
        return null
      }

      let encoded: ArrayBuffer | null = await response.arrayBuffer()
      if (encoded.byteLength > MAX_ENCODED_BUFFER_BYTES) return null
      if (
        controller.signal.aborted
        || playbackRequestId !== requestId
        || settings.playbackQuality !== quality
      ) return null

      const audioBuffer = await getPlaybackContext().decodeAudioData(encoded)
      encoded = null
      if (
        controller.signal.aborted
        || playbackRequestId !== requestId
        || settings.playbackQuality !== quality
      ) return null

      return cacheBuffer(song.id, quality, audioBuffer) ? audioBuffer : null
    })

    let promise: Promise<AudioBuffer | null>
    promise = work
      .catch((error: unknown) => {
        if (!isAbortError(error)) console.warn('[Player] fetchBuffer failed:', error)
        return null
      })
      .finally(() => {
        if (bufferFetchPromises.get(cacheKey) === promise) bufferFetchPromises.delete(cacheKey)
        if (bufferFetchControllers.get(cacheKey) === controller) {
          bufferFetchControllers.delete(cacheKey)
        }
      })

    bufferWorkQueue = promise.then(() => undefined, () => undefined)
    bufferFetchPromises.set(cacheKey, promise)
    return promise
  }

  async function prefetchNextBuffer(requestId: number, activeSongId: number) {
    if (playbackRequestId !== requestId || currentSong.value?.id !== activeSongId) return
    const list = playMode.value === 'shuffle' ? shuffledPlaylist.value : playlist.value
    if (list.length <= 1) return
    const activeIndex = list.findIndex((song) => song.id === activeSongId)
    if (activeIndex < 0) return
    const nextSong = list[(activeIndex + 1) % list.length]
    if (!nextSong || getCachedBuffer(nextSong.id)) return
    await fetchBuffer(nextSong, requestId)
  }

  function scheduleNextBufferPrefetch(delay: number) {
    if (prefetchTimer !== null) window.clearTimeout(prefetchTimer)
    const requestId = playbackRequestId
    const activeSongId = currentSong.value?.id
    if (activeSongId == null) return

    prefetchTimer = window.setTimeout(() => {
      prefetchTimer = null
      void prefetchNextBuffer(requestId, activeSongId)
    }, delay)
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

  function beginPlaybackRequest(songId: number): number {
    playbackRequestId += 1
    cancelMetadataWait?.()
    cancelPendingBufferWork()
    clearCachedBuffers(songId)
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

  function waitForMediaMetadata(requestId: number, song: Song): Promise<void> {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()

    return new Promise((resolve) => {
      let timeoutId = 0
      const finish = () => {
        window.clearTimeout(timeoutId)
        audio.removeEventListener('loadedmetadata', finish)
        audio.removeEventListener('error', finish)
        if (cancelMetadataWait === finish) cancelMetadataWait = null
        resolve()
      }
      cancelMetadataWait = finish
      timeoutId = window.setTimeout(finish, 10_000)
      audio.addEventListener('loadedmetadata', finish)
      audio.addEventListener('error', finish)

      if (!isPlaybackRequestCurrent(requestId, song)) finish()
    })
  }

  async function playMediaElement(
    song: Song,
    url: string,
    requestId: number,
    startOffset = 0,
    autoplay = true,
  ) {
    mediaSongId = song.id
    audio.src = toProxyUrl(url)
    audio.load()

    if (startOffset > 0) {
      await waitForMediaMetadata(requestId, song)
      if (!isPlaybackRequestCurrent(requestId, song)) return
      try {
        const maxTime = Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.max(0, audio.duration - 0.05)
          : startOffset
        audio.currentTime = Math.min(startOffset, maxTime)
        currentTime.value = audio.currentTime
      } catch {
        currentTime.value = startOffset
      }
    }

    if (!autoplay) {
      isPlaying.value = false
      return
    }

    await resumeAudioEngine()
    if (!isPlaybackRequestCurrent(requestId, song)) return
    try {
      await audio.play()
    } catch (error) {
      if (!isPlaybackRequestCurrent(requestId, song)) return
      isPlaying.value = false
      console.warn('[Player] playback start was blocked:', error)
    }
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
        source.onended = null
        try { source.disconnect() } catch { /* ignore */ }
        if (currentSource === source) currentSource = null
        gaplessSongId = null
        if (playMode.value === 'single') {
          playBuffer(song, buffer)
          return
        }
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
    const buffer = takeCachedBuffer(song.id)
    if (buffer) {
      playBuffer(song, buffer)
      scheduleNextBufferPrefetch(500)
      return
    }

    // Fallback: the media element is permanently attached to the same analyser.
    await playMediaElement(song, url, requestId)
    if (isPlaybackRequestCurrent(requestId, song) && isPlaying.value) {
      scheduleNextBufferPrefetch(500)
    }
  }

  async function loadAndPlay(song: Song) {
    // Resume while the user gesture is still active; URL lookup may complete later.
    void resumeAudioEngine()
    const requestId = beginPlaybackRequest(song.id)
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

  async function reloadCurrentSongForQuality(
    song: Song,
    startOffset: number,
    autoplay: boolean,
  ) {
    const requestId = beginPlaybackRequest(song.id)
    isLoading.value = true
    try {
      const url = await resolveSongUrl(song.id)
      if (!isPlaybackRequestCurrent(requestId, song)) return
      if (!url) throw new Error(`No playable URL for song ${song.id}`)
      await playMediaElement(song, url, requestId, startOffset, autoplay)
      if (isPlaybackRequestCurrent(requestId, song) && autoplay && isPlaying.value) {
        scheduleNextBufferPrefetch(500)
      }
    } catch (error) {
      if (isPlaybackRequestCurrent(requestId, song)) {
        console.error('[Player] quality reload error:', error)
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

    const buffer = gaplessSongId === song.id && currentSource?.buffer
      ? currentSource.buffer
      : takeCachedBuffer(song.id)
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
      const buffer = currentSource.buffer
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
  void settings.restoreAudioOutputDevice()
  watch(
    () => settings.playbackQuality,
    () => {
      const song = currentSong.value
      const startOffset = currentTime.value
      const autoplay = isPlaying.value

      // URL and decoded PCM caches are quality-specific. Drop them before the
      // reload so an old 320 kbps request cannot win after selecting lossless.
      urlCache.clear()
      cancelPendingBufferWork()
      clearCachedBuffers()

      if (song) void reloadCurrentSongForQuality(song, startOffset, autoplay)
    },
  )
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
