import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getLikedSongIds, likeSong } from '@/lib/api'
import { useAuthStore } from './auth'

export const useLikesStore = defineStore('likes', () => {
  const likedIds = ref(new Set<number>())
  const loading = ref(false)
  const likedPlaylistId = ref(0)

  async function loadLikes() {
    const auth = useAuthStore()
    if (!auth.profile) {
      likedIds.value = new Set()
      return
    }
    loading.value = true
    try {
      likedIds.value = await getLikedSongIds(auth.profile.userId)
    } catch (e) {
      console.error('[Likes] load error:', e)
    } finally {
      loading.value = false
    }
  }

  function isLiked(id: number): boolean {
    return likedIds.value.has(id)
  }

  async function toggleLike(id: number): Promise<boolean> {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) return false
    const wasLiked = likedIds.value.has(id)
    const snapshot = new Set(likedIds.value)
    // optimistic update
    const next = new Set(likedIds.value)
    wasLiked ? next.delete(id) : next.add(id)
    likedIds.value = next
    try {
      const ok = await likeSong(id, !wasLiked)
      if (!ok) likedIds.value = snapshot
      return ok
    } catch {
      likedIds.value = snapshot
      return false
    }
  }

  return { likedIds, loading, likedPlaylistId, loadLikes, isLiked, toggleLike }
})
