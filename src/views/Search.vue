<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Clock, User, Disc3, ListMusic, Heart, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { formatTime } from '@/lib/utils'
import {
  searchSongs,
  searchArtists,
  searchAlbums,
  searchPlaylists,
} from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import { getDisplayThumbnailUrl } from '@/lib/image'
import ArtistLinks from '@/components/ArtistLinks.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { SearchResult } from '@/lib/api'
import type { Song } from '@/types'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

type Tab = 'songs' | 'artists' | 'albums' | 'playlists'
const activeTab = ref<Tab>('songs')
const keyword = ref('')
const loading = ref(false)

const songs = ref<Song[]>([])
const artists = ref<SearchResult[]>([])
const albums = ref<SearchResult[]>([])
const playlists = ref<SearchResult[]>([])

const tabs: { key: Tab; label: string }[] = [
  { key: 'songs', label: '单曲' },
  { key: 'artists', label: '歌手' },
  { key: 'albums', label: '专辑' },
  { key: 'playlists', label: '歌单' },
]

async function doSearch(kw: string) {
  if (!kw.trim()) return
  loading.value = true
  try {
    const [s, ar, al, pl] = await Promise.all([
      searchSongs(kw),
      searchArtists(kw),
      searchAlbums(kw),
      searchPlaylists(kw),
    ])
    songs.value = s
    artists.value = ar
    albums.value = al
    playlists.value = pl
  } catch (e) {
    console.error('[Search] error:', e)
  } finally {
    loading.value = false
  }
}

function goToArtist(id: number) {
  router.push(`/artist/${id}`)
}

function goToAlbum(id: number) {
  router.push(`/album/${id}`)
}

function goToPlaylist(id: number) {
  router.push(`/playlist/${id}`)
}

onMounted(() => {
  keyword.value = (route.params.keyword as string) ?? ''
  doSearch(keyword.value)
})

watch(
  () => route.params.keyword,
  (kw) => {
    keyword.value = (kw as string) ?? ''
    doSearch(keyword.value)
  },
)
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <h1 class="text-xl font-bold mb-4">
      <span class="text-primary">"{{ keyword }}"</span> 的相关搜索
    </h1>

    <!-- Tab bar -->
    <div class="flex items-center gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
        :class="activeTab === tab.key
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <template v-else>
      <!-- Songs -->
      <div v-if="activeTab === 'songs'">
        <div v-if="songs.length === 0" class="py-16 text-center text-muted-foreground">
          <p class="text-sm">未找到相关单曲</p>
        </div>
        <div v-else class="bg-card rounded-xl border border-border overflow-hidden">
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
              class="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:block w-32 truncate text-left"
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
      </div>

      <!-- Artists -->
      <div v-if="activeTab === 'artists'">
        <div v-if="artists.length === 0" class="py-16 text-center text-muted-foreground">
          <p class="text-sm">未找到相关歌手</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div
            v-for="a in artists"
            :key="a.id"
            class="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-accent
                   cursor-pointer transition-colors group"
            @click="goToArtist(a.id)"
          >
            <div class="w-full aspect-square rounded-full overflow-hidden bg-muted">
              <img
                v-if="a.cover"
                :src="getDisplayThumbnailUrl(a.cover, 240)"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <User :size="32" class="text-muted-foreground" />
              </div>
            </div>
            <p class="text-sm font-medium text-center truncate w-full">{{ a.name }}</p>
          </div>
        </div>
      </div>

      <!-- Albums -->
      <div v-if="activeTab === 'albums'">
        <div v-if="albums.length === 0" class="py-16 text-center text-muted-foreground">
          <p class="text-sm">未找到相关专辑</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div
            v-for="a in albums"
            :key="a.id"
            class="flex flex-col gap-2 p-3 rounded-xl hover:bg-accent
                   cursor-pointer transition-colors group"
            @click="goToAlbum(a.id)"
          >
            <div class="w-full aspect-square rounded-xl overflow-hidden bg-muted">
              <img
                v-if="a.cover"
                :src="getDisplayThumbnailUrl(a.cover, 240)"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <Disc3 :size="32" class="text-muted-foreground" />
              </div>
            </div>
            <p class="text-sm font-medium truncate">{{ a.name }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ a.artist }}</p>
          </div>
        </div>
      </div>

      <!-- Playlists -->
      <div v-if="activeTab === 'playlists'">
        <div v-if="playlists.length === 0" class="py-16 text-center text-muted-foreground">
          <p class="text-sm">未找到相关歌单</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <div
            v-for="pl in playlists"
            :key="pl.id"
            class="flex flex-col gap-2 p-3 rounded-xl hover:bg-accent
                   cursor-pointer transition-colors group"
            @click="goToPlaylist(pl.id)"
          >
            <div class="w-full aspect-square rounded-xl overflow-hidden bg-muted relative">
              <img
                v-if="pl.cover"
                :src="getDisplayThumbnailUrl(pl.cover, 240)"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <ListMusic :size="32" class="text-muted-foreground" />
              </div>
              <div
                v-if="pl.playCount"
                class="absolute top-1.5 right-1.5 text-xs text-white bg-black/50
                       px-1.5 py-0.5 rounded-full"
              >
                {{ pl.playCount! >= 10000 ? `${(pl.playCount! / 10000).toFixed(1)}万` : pl.playCount }}
              </div>
            </div>
            <p class="text-sm font-medium line-clamp-2">{{ pl.name }}</p>
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
