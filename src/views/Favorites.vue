<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Heart, Play, Clock, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import { usePlaylistCacheStore } from '@/stores/playlistCache'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { formatTime } from '@/lib/utils'
import { getUserPlaylists } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { Song } from '@/types'

const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const auth = useAuthStore()
const cache = usePlaylistCacheStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

const loading = ref(true)
const playlistId = ref(0)
const totalTracks = ref(0)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const favorites = computed(() => cache.getTracks(playlistId.value))
const hasMore = computed(() => !cache.isAllLoaded(playlistId.value))
const loadingMore = computed(() => cache.get(playlistId.value)?.loading ?? false)

async function loadFavorites() {
  if (!auth.profile) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const playlists = await getUserPlaylists(auth.profile.userId)
    const liked = playlists.find((p) => p.specialType === 5) ?? playlists[0]
    if (liked) {
      playlistId.value = liked.id
      totalTracks.value = liked.trackCount
      // Load first batch
      await cache.loadFirst(liked.id, liked.trackCount)
      // Continue loading in background
      cache.loadAll(liked.id)
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
  // Trigger background loading
  cache.loadAll(playlistId.value)
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
  else loading.value = false
})

async function playAll() {
  // Load all songs first if not all loaded yet
  if (!cache.isAllLoaded(playlistId.value)) {
    await cache.loadAll(playlistId.value)
  }
  const tracks = cache.getTracks(playlistId.value)
  if (tracks.length > 0) {
    player.setPlaylist(tracks, 0)
  }
}

function playSong(index: number) {
  const tracks = cache.getTracks(playlistId.value)
  player.setPlaylist(tracks, index)
  // Append remaining tracks in background if not all loaded
  if (!cache.isAllLoaded(playlistId.value)) {
    cache.loadAll(playlistId.value).then((allTracks) => {
      player.appendToPlaylist(allTracks)
    })
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
          @dblclick="playSong(i)"
        >
          <span class="w-8 text-center text-sm text-muted-foreground">
            {{ String(i + 1).padStart(2, '0') }}
          </span>
          <LazySongCover :src="song.cover" :alt="song.name" />
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
