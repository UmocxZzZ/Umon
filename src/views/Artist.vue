<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Clock, Play, Heart, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { formatTime } from '@/lib/utils'
import { getArtistDetail } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import type { Song } from '@/types'

const route = useRoute()
const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

const name = ref('')
const cover = ref('')
const songs = ref<Song[]>([])
const loading = ref(true)

async function loadArtist(id: number) {
  loading.value = true
  try {
    const detail = await getArtistDetail(id)
    name.value = detail.name
    cover.value = detail.cover
    songs.value = detail.songs
  } catch (e) {
    console.error('[Artist] load error:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => loadArtist(Number(route.params.id)))

watch(
  () => route.params.id,
  (id) => { if (id) loadArtist(Number(id)) },
)

function playAll() {
  if (songs.value.length > 0) {
    player.setPlaylist(songs.value, 0)
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
      <div class="flex items-center gap-6 mb-6">
        <div class="w-32 h-32 rounded-full overflow-hidden bg-muted shrink-0">
          <img
            v-if="cover"
            :src="cover"
            class="w-full h-full object-cover"
          />
        </div>
        <div>
          <h1 class="text-2xl font-bold">{{ name }}</h1>
          <p class="text-sm text-muted-foreground mt-1">{{ songs.length }} 首热门歌曲</p>
          <button
            class="mt-3 flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground
                   rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-transform"
            @click="playAll"
          >
            <Play :size="16" />
            播放全部
          </button>
        </div>
      </div>

      <!-- Songs -->
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
          <img
            v-if="song.cover"
            :src="song.cover"
            class="w-10 h-10 rounded object-cover"
          />
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
