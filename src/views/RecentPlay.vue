<script setup lang="ts">
import { ref, computed } from 'vue'
import { Clock, Play, Heart, Download } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import { formatTime } from '@/lib/utils'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import DownloadDialog from '@/components/DownloadDialog.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { Song } from '@/types'

const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const downloadSong = ref<Song | null>(null)

const recentSongs = computed(() => player.playHistory)

function playAll() {
  if (recentSongs.value.length > 0) {
    player.setPlaylist([...recentSongs.value], 0)
  }
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center gap-4 mb-6">
      <div class="w-20 h-20 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20
                  flex items-center justify-center">
        <Clock :size="32" class="text-blue-500" />
      </div>
      <div>
        <h1 class="text-2xl font-bold">最近播放</h1>
        <p class="text-sm text-muted-foreground">{{ recentSongs.length }} 首歌曲</p>
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

    <div class="bg-card rounded-xl border border-border overflow-hidden">
      <div
        v-for="(song, i) in recentSongs"
        :key="song.id"
        class="flex items-center gap-4 px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
        @dblclick="player.setPlaylist([...recentSongs], i)"
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
            :artist="song.artist"
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
      <div
        v-if="recentSongs.length === 0"
        class="py-16 text-center text-muted-foreground"
      >
        <Clock :size="40" class="mx-auto mb-3 opacity-30" />
        <p class="text-sm">还没有播放记录</p>
      </div>
    </div>
  </div>

  <DownloadDialog
    v-if="downloadSong"
    :song="downloadSong"
    :show="!!downloadSong"
    @close="downloadSong = null"
  />
</template>
