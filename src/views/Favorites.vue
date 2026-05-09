<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Heart, Play, Clock, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { formatTime } from '@/lib/utils'
import { getUserPlaylists, getPlaylistTracks } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import type { Song } from '@/types'

const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const auth = useAuthStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

const favorites = ref<Song[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)
const playlistId = ref(0)
const totalTracks = ref(0)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

async function loadFavorites() {
  if (!auth.profile) {
    favorites.value = []
    loading.value = false
    return
  }
  loading.value = true
  hasMore.value = true
  favorites.value = []
  try {
    const playlists = await getUserPlaylists(auth.profile.userId)
    const liked = playlists.find((p) => p.specialType === 5) ?? playlists[0]
    if (liked) {
      playlistId.value = liked.id
      totalTracks.value = liked.trackCount
      const result = await getPlaylistTracks(liked.id, 0, 100)
      favorites.value = result.songs
      hasMore.value = result.hasMore
    }
  } catch (e) {
    console.error('[Favorites] load error:', e)
  } finally {
    loading.value = false
    nextTick(setupObserver)
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || !playlistId.value) return
  loadingMore.value = true
  // Disconnect observer immediately to prevent duplicate triggers
  if (observer) observer.disconnect()
  try {
    const result = await getPlaylistTracks(playlistId.value, favorites.value.length, 100)
    favorites.value = [...favorites.value, ...result.songs]
    hasMore.value = result.hasMore
  } catch (e) {
    console.error('[Favorites] load more error:', e)
  } finally {
    loadingMore.value = false
    nextTick(setupObserver)
  }
}

function setupObserver() {
  if (observer) observer.disconnect()
  if (!sentinelRef.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadMore()
    }
  }, { rootMargin: '200px' })
  observer.observe(sentinelRef.value)
}

onMounted(loadFavorites)

onUnmounted(() => {
  if (observer) observer.disconnect()
})

watch(() => auth.isLoggedIn, (v) => {
  if (v) loadFavorites()
  else {
    favorites.value = []
    loading.value = false
  }
})

function playAll() {
  if (favorites.value.length > 0) {
    player.setPlaylist(favorites.value, 0)
  }
}
</script>

<template>
  <div class="p-6">
    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <div class="w-20 h-20 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20
                    flex items-center justify-center">
          <Heart :size="32" class="text-primary" />
        </div>
        <div>
          <h1 class="text-2xl font-bold">我喜欢的音乐</h1>
          <p class="text-sm text-muted-foreground">{{ totalTracks }} 首歌曲</p>
        </div>
        <button
          class="ml-auto flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground
                 rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-transform"
          @click="playAll"
        >
          <Play :size="16" />
          播放全部
        </button>
      </div>

      <!-- List -->
      <div class="bg-card rounded-xl border border-border overflow-hidden">
        <div
          v-for="(song, i) in favorites"
          :key="song.id"
          class="flex items-center gap-4 px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
          @dblclick="player.setPlaylist(favorites, i)"
        >
          <span class="w-8 text-center text-sm text-muted-foreground">
            {{ String(i + 1).padStart(2, '0') }}
          </span>
          <img v-if="song.cover" :src="song.cover" class="w-10 h-10 rounded object-cover" />
          <div class="flex-1 min-w-0">
            <button
              class="text-sm font-medium truncate hover:text-primary transition-colors block max-w-full text-left"
              @click.stop="goAlbum(song.albumId)"
            >
              {{ song.name }}
            </button>
            <ArtistLinks
              :artists="song.artists"
              class="text-xs text-muted-foreground truncate block max-w-full text-left"
            />
          </div>
          <button
            class="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:block truncate max-w-[120px] text-left"
            @click.stop="goAlbum(song.albumId)"
          >
            {{ song.album }}
          </button>
          <button
            class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
            @click.stop="likes.toggleLike(song.id)"
          >
            <Heart
              v-if="likes.isLiked(song.id)"
              :size="16"
              :fill="'currentColor'"
              class="text-primary"
            />
            <Heart v-else :size="16" class="text-muted-foreground hover:text-primary" />
          </button>
          <button
            v-if="isElectron"
            class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
            @click.stop="downloadSong = song"
          >
            <Download
              :size="16"
              :class="downloads.isDownloaded(song.id)
                ? 'text-green-500'
                : 'text-muted-foreground hover:text-primary'"
            />
          </button>
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock :size="12" />
            {{ formatTime(song.duration) }}
          </div>
        </div>

        <!-- Loading more indicator -->
        <div v-if="loadingMore" class="flex items-center justify-center py-6">
          <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>

        <!-- Sentinel for infinite scroll -->
        <div ref="sentinelRef" class="h-1" />

        <!-- End message -->
        <div v-if="!hasMore && favorites.length > 0" class="py-6 text-center text-sm text-muted-foreground">
          已经到底啦
        </div>

        <div v-if="!auth.isLoggedIn" class="py-16 text-center text-muted-foreground">
          <Heart :size="40" class="mx-auto mb-3 opacity-30" />
          <p class="text-sm">登录后查看我喜欢的音乐</p>
        </div>
        <div v-else-if="favorites.length === 0" class="py-16 text-center text-muted-foreground">
          <Heart :size="40" class="mx-auto mb-3 opacity-30" />
          <p class="text-sm">还没有喜欢的音乐</p>
        </div>
      </div>
    </template>
  </div>

  <DownloadDialog
    v-if="downloadSong"
    :song="downloadSong"
    :show="!!downloadSong"
    @close="downloadSong = null"
  />
</template>
