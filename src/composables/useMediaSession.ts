import { watch } from 'vue'
import { usePlayerStore } from '@/stores/player'

export function useMediaSession() {
  const player = usePlayerStore()

  function buildMetadata(song: { name: string; artist: string; album?: string; cover?: string }) {
    return new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: song.album || '',
      artwork: song.cover
        ? [{ src: song.cover, sizes: '256x256', type: 'image/jpeg' }]
        : [],
    })
  }

  function applyMetadata() {
    if (!('mediaSession' in navigator)) return
    const song = player.currentSong
    if (!song) return
    navigator.mediaSession.metadata = buildMetadata(song)
    navigator.mediaSession.playbackState = player.isPlaying ? 'playing' : 'paused'
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
    navigator.mediaSession.setActionHandler('play', () => player.play())
    navigator.mediaSession.setActionHandler('pause', () => player.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => player.prev())
    navigator.mediaSession.setActionHandler('nexttrack', () => player.next())
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) player.audio.currentTime = details.seekTime
    })
  }

  // Apply metadata on every song change
  watch(() => player.currentIndex, () => {
    // Immediate apply
    applyMetadata()
    // Delayed apply to handle browser reset
    setTimeout(applyMetadata, 50)
    setTimeout(applyMetadata, 150)
    setTimeout(applyMetadata, 300)
  })

  watch(() => player.isPlaying, () => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = player.isPlaying ? 'playing' : 'paused'
  })

  watch(() => player.currentTime, () => {
    updatePositionState()
  })

  setupActionHandlers()

  // Apply on audio events
  player.audio.addEventListener('play', () => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = 'playing'
  })

  player.audio.addEventListener('playing', () => {
    applyMetadata()
  })

  player.audio.addEventListener('loadedmetadata', () => {
    applyMetadata()
  })

  // Initial
  applyMetadata()
}