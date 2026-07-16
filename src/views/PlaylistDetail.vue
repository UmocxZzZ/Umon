<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Play, Clock, ListMusic, Heart, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { formatTime } from '@/lib/utils'
import { getPlaylistDetail } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import { getDisplayThumbnailUrl } from '@/lib/image'
import ArtistLinks from '@/components/ArtistLinks.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { Song, Playlist } from '@/types'

const route = useRoute()
const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

const playlist = ref<Playlist | null>(null)
const songs = ref<Song[]>([])
const loading = ref(true)

async function loadPlaylist(id: number) {
  loading.value = true
  try {
    const detail = await getPlaylistDetail(id)
    playlist.value = detail.playlist
    songs.value = detail.tracks
  } catch (e) {
    console.error('[PlaylistDetail] load error:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPlaylist(Number(route.params.id))
})

watch(
  () => route.params.id,
  (id) => {
    if (id) loadPlaylist(Number(id))
  },
)

function playAll() {
  if (songs.value.length > 0) {
    player.setPlaylist(songs.value, 0)
  }
}
</script>

<template>
  <div class="p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <template v-else-if="playlist">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <div class="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">
          <img
            v-if="playlist.cover"
            :src="getDisplayThumbnailUrl(playlist.cover, 80)"
            :alt="playlist.name"
            decoding="async"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <ListMusic :size="32" class="text-muted-foreground" />
          </div>
        </div>
        <div class="min-w-0">
          <h1 class="text-2xl font-bold truncate">{{ playlist.name }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ playlist.creator ? `by ${playlist.creator}` : '' }}
            · {{ songs.length }} 首歌曲
          </p>
          <p v-if="playlist.description" class="text-xs text-muted-foreground mt-1 line-clamp-2">
            {{ playlist.description }}
          </p>
        </div>
        <button
          class="ml-auto flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground
                 rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-transform shrink-0"
          @click="playAll"
        >
          <Play :size="16" />
          播放全部
        </button>
      </div>

      <!-- Track List -->
      <div class="bg-card rounded-xl border border-border overflow-hidden">
        <div
          v-for="(song, i) in songs"
          :key="song.id"
          class="flex items-center gap-4 px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
          @dblclick="player.setPlaylist(songs, i)"
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
