import { watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/stores/player'

export function useMediaSession() {
  const player = usePlayerStore()

  // Create a silent audio context for SMTC anchor
  let silentCtx: AudioContext | null = null
  let silentOsc: OscillatorNode | null = null
  let silentGain: GainNode | null = null
  let silentStarted = false

  function ensureSilentAudio() {
    if (silentStarted) return
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      silentCtx = new AC()
      silentOsc = silentCtx.createOscillator()
      silentGain = silentCtx.createGain()
      silentGain.gain.value = 0.0001 // Nearly silent
      silentOsc.connect(silentGain)
      silentGain.connect(silentCtx.destination)
      silentOsc.start()
      silentStarted = true
    } catch {
      // Ignore errors
    }
  }

  function buildMetadata(song: { name: string; artist: string; album?: string; cover?: string }) {
    return new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: song.album || '',
      artwork: song.cover
        ? [
            { src: song.cover, sizes: '256x256', type: 'image/jpeg' },
            { src: song.cover, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    })
  }

  function forcePlayingState() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = 'playing'
  }

  function updateMetadata() {
    if (!('mediaSession' in navigator)) return
    const song = player.currentSong
    if (!song) return
    navigator.mediaSession.metadata = buildMetadata(song)
    forcePlayingState()
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator)) return
    if (!player.duration || !isFinite(player.duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration: player.duration,
        playbackRate: 1,
        position: player.currentTime,
      })
    } catch { /* ignore */ }
  }

  function setupActionHandlers() {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.setActionHandler('play', () => {
      player.play()
    })

    navigator.mediaSession.setActionHandler('pause', () => {
      player.pause()
    })

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      player.prev()
    })

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      player.next()
    })

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) {
        player.seek(details.seekTime / player.duration)
      }
    })
  }

  // Aggressive restore during song loading
  let restoreTimer: ReturnType<typeof setInterval> | null = null
  let forceTimer: ReturnType<typeof setInterval> | null = null

  function startRestore() {
    stopRestore()
    ensureSilentAudio()
    updateMetadata()

    // Aggressively force playing state every 30ms during loading
    restoreTimer = setInterval(() => {
      updateMetadata()
      forcePlayingState()
      if (player.isPlaying && player.audio.readyState >= 3) {
        stopRestore()
      }
    }, 30)

    // Safety timeout
    setTimeout(stopRestore, 8000)
  }

  function stopRestore() {
    if (restoreTimer) {
      clearInterval(restoreTimer)
      restoreTimer = null
    }
  }

  // Watch song changes
  watch(() => player.currentIndex, () => {
    startRestore()
  })

  // Also watch currentSong (for first song load)
  watch(() => player.currentSong, (song) => {
    if (song) {
      startRestore()
    }
  })

  // Keep forcing playing state
  watch(() => player.isPlaying, () => {
    forcePlayingState()
  })

  watch(() => player.currentTime, () => {
    updatePositionState()
  })

  // Setup
  setupActionHandlers()

  // Start a persistent timer that keeps forcing playing state
  forceTimer = setInterval(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing'
    }
  }, 100)

  // Try to start silent audio on user interaction
  const startOnInteraction = () => {
    ensureSilentAudio()
    document.removeEventListener('click', startOnInteraction)
    document.removeEventListener('keydown', startOnInteraction)
  }
  document.addEventListener('click', startOnInteraction)
  document.addEventListener('keydown', startOnInteraction)

  // Initial
  updateMetadata()
  forcePlayingState()

  onUnmounted(() => {
    stopRestore()
    if (forceTimer) clearInterval(forceTimer)
    document.removeEventListener('click', startOnInteraction)
    document.removeEventListener('keydown', startOnInteraction)
    if (silentOsc) { try { silentOsc.stop() } catch { /* */ } }
    if (silentCtx) { silentCtx.close().catch(() => {}) }
  })
}
