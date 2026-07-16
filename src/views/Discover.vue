<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Play, Clock } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { formatTime } from '@/lib/utils'
import { getPersonalized, getNewSongs } from '@/lib/api'
import LazySongCover from '@/components/LazySongCover.vue'
import { getDisplayThumbnailUrl } from '@/lib/image'
import type { Song, Playlist } from '@/types'

const router = useRouter()
const player = usePlayerStore()

const playlists = ref<Playlist[]>([])
const newSongs = ref<Song[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const [pl, songs] = await Promise.all([
      getPersonalized(8),
      getNewSongs(),
    ])
    playlists.value = pl
    newSongs.value = songs
    player.prefetchUrls(songs)
  } catch (e) {
    console.error('[Discover] load error:', e)
  } finally {
    loading.value = false
  }
})

function playSong(songs: Song[], index: number) {
  player.setPlaylist(songs, index)
}

function openPlaylist(id: number) {
  router.push(`/playlist/${id}`)
}

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}
</script>

<template>
  <div class="p-6 space-y-8">
    <!-- Banner -->
    <div class="h-48 rounded-2xl bg-gradient-to-r from-primary/20 via-secondary/10 to-accent
                flex items-center justify-center">
      <div class="text-center">
        <h1 class="text-3xl font-bold">欢迎使用 Umon</h1>
        <p class="text-muted-foreground mt-2">发现好音乐，享受好时光</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>

    <template v-else>
      <!-- Recommend Playlists -->
      <section>
        <h2 class="text-lg font-semibold mb-4">个性推荐</h2>
        <div class="grid grid-cols-4 gap-4">
          <div
            v-for="pl in playlists"
            :key="pl.id"
            class="group cursor-pointer"
            @click="openPlaylist(pl.id)"
          >
            <div class="aspect-square rounded-xl overflow-hidden bg-muted
                        group-hover:ring-2 group-hover:ring-primary/30 transition-all relative">
              <img
                v-if="pl.cover"
                :src="getDisplayThumbnailUrl(pl.cover, 240)"
                :alt="pl.name"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <span class="text-4xl opacity-30">♪</span>
              </div>
              <div class="absolute top-2 right-2 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded">
                {{ formatCount(pl.playCount) }}
              </div>
              <button
                class="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-primary
                       text-primary-foreground flex items-center justify-center
                       opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0
                       transition-all shadow-lg"
              >
                <Play :size="18" class="ml-0.5" />
              </button>
            </div>
            <p class="text-sm font-medium mt-2 truncate">{{ pl.name }}</p>
          </div>
        </div>
      </section>

      <!-- New Songs -->
      <section>
        <h2 class="text-lg font-semibold mb-4">新歌速递</h2>
        <div class="bg-card rounded-xl border border-border overflow-hidden">
          <div
            v-for="(song, i) in newSongs"
            :key="song.id"
            class="flex items-center gap-4 px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
            @click="playSong(newSongs, i)"
          >
            <span class="w-8 text-center text-sm text-muted-foreground">
              {{ String(i + 1).padStart(2, '0') }}
            </span>
            <LazySongCover :src="song.cover" :alt="song.name" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ song.name }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ song.artist }}</p>
            </div>
            <span class="text-xs text-muted-foreground hidden sm:block">{{ song.album }}</span>
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock :size="12" />
              {{ formatTime(song.duration) }}
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
