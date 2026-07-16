<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Clock, Play, Heart, Download, Disc3 } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { formatTime } from '@/lib/utils'
import { getAllArtistAlbums, getArtistDetail } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import { getDisplayThumbnailUrl } from '@/lib/image'
import ArtistLinks from '@/components/ArtistLinks.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { Album, Song } from '@/types'

const route = useRoute()
const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

type ArtistTab = 'songs' | 'albums'
const activeTab = ref<ArtistTab>('songs')
const tabs: { key: ArtistTab; label: string }[] = [
  { key: 'songs', label: '歌曲' },
  { key: 'albums', label: '专辑' },
]

const name = ref('')
const cover = ref('')
const songs = ref<Song[]>([])
const albums = ref<Album[]>([])
const loading = ref(true)
const albumLoadFailed = ref(false)
let artistRequestId = 0

async function loadArtist(id: number) {
  const requestId = ++artistRequestId
  loading.value = true
  albumLoadFailed.value = false
  name.value = ''
  cover.value = ''
  songs.value = []
  albums.value = []
  try {
    const [detailResult, albumResult] = await Promise.allSettled([
      getArtistDetail(id),
      getAllArtistAlbums(id),
    ])
    if (requestId !== artistRequestId) return

    if (detailResult.status === 'fulfilled') {
      name.value = detailResult.value.name
      cover.value = detailResult.value.cover
      songs.value = detailResult.value.songs
    } else {
      console.error('[Artist] load error:', detailResult.reason)
    }

    if (albumResult.status === 'fulfilled') {
      albums.value = albumResult.value
    } else {
      albumLoadFailed.value = true
      console.error('[Artist] albums load error:', albumResult.reason)
    }
  } finally {
    if (requestId === artistRequestId) {
      loading.value = false
    }
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

function formatAlbumReleaseDate(publishTime?: number): string {
  if (!publishTime || !Number.isFinite(publishTime)) return ''
  const date = new Date(publishTime)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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
            :src="getDisplayThumbnailUrl(cover, 128)"
            decoding="async"
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

      <!-- Tab bar -->
      <div class="mb-6 flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Albums -->
      <section v-if="activeTab === 'albums'">
        <div v-if="albums.length === 0" class="rounded-xl border border-border bg-card py-12 text-center">
          <Disc3 :size="30" class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            {{ albumLoadFailed ? '专辑加载失败，请重试' : '暂无专辑' }}
          </p>
          <button
            v-if="albumLoadFailed"
            class="mt-3 rounded-full border border-border px-4 py-1.5 text-xs hover:bg-accent"
            @click="loadArtist(Number(route.params.id))"
          >
            重试
          </button>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="album in albums"
            :key="album.id"
            class="group min-w-0 cursor-pointer text-left"
            @click="goAlbum(album.id)"
          >
            <div
              class="relative aspect-square overflow-hidden rounded-xl bg-muted
                     transition-all group-hover:ring-2 group-hover:ring-primary/30"
            >
              <img
                v-if="album.cover"
                :src="getDisplayThumbnailUrl(album.cover, 240)"
                :alt="album.name"
                loading="lazy"
                decoding="async"
                class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div v-else class="flex h-full w-full items-center justify-center">
                <Disc3 :size="36" class="text-muted-foreground" />
              </div>
            </div>
            <p class="mt-2 truncate text-sm font-medium" :title="album.name">
              {{ album.name }}
            </p>
            <p
              v-if="formatAlbumReleaseDate(album.publishTime)"
              class="mt-0.5 text-xs text-muted-foreground"
            >
              {{ formatAlbumReleaseDate(album.publishTime) }}
            </p>
          </button>
        </div>

      </section>

      <!-- Songs -->
      <section v-else>
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
      </section>
    </template>
  </div>

  <DownloadDialog
    v-if="downloadSong"
    :song="downloadSong"
    :show="!!downloadSong"
    @close="downloadSong = null"
  />
</template>
