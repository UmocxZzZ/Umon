<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import {
  Heart,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  ListMusic,
  Loader2,
  Download,
} from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import { formatTime } from '@/lib/utils'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import type { PlayMode } from '@/types'

const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()
const { goAlbum } = useSongNavigate()

const isElectron = computed(() => !!window.electronAPI)
const showDownloadDialog = ref(false)

const isCurrentLiked = computed(() =>
  player.currentSong ? likes.isLiked(player.currentSong.id) : false,
)

function onHeartClick() {
  if (player.currentSong) likes.toggleLike(player.currentSong.id)
}

const playModeIcon = computed(() => {
  const map: Record<PlayMode, typeof Repeat> = {
    list: Repeat,
    single: Repeat1,
    shuffle: Shuffle,
  }
  return map[player.playMode]
})

const playModeLabel = computed(() => {
  const map: Record<PlayMode, string> = {
    list: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放',
  }
  return map[player.playMode]
})

// Progress bar drag
const isDragging = ref(false)
const dragProgress = ref(0)
const progressRef = ref<HTMLElement | null>(null)

const displayProgress = computed(() =>
  isDragging.value ? dragProgress.value : player.progress,
)

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val))
}

function calcRatio(e: MouseEvent) {
  if (!progressRef.value) return 0
  const rect = progressRef.value.getBoundingClientRect()
  return clamp((e.clientX - rect.left) / rect.width, 0, 1)
}

function onProgressMouseDown(e: MouseEvent) {
  isDragging.value = true
  dragProgress.value = calcRatio(e)
  document.addEventListener('mousemove', onProgressMouseMove)
  document.addEventListener('mouseup', onProgressMouseUp)
}

function onProgressMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  dragProgress.value = calcRatio(e)
}

function onProgressMouseUp(e: MouseEvent) {
  if (!isDragging.value) return
  player.seek(calcRatio(e))
  isDragging.value = false
  document.removeEventListener('mousemove', onProgressMouseMove)
  document.removeEventListener('mouseup', onProgressMouseUp)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onProgressMouseMove)
  document.removeEventListener('mouseup', onProgressMouseUp)
  document.removeEventListener('mousemove', onVolumeMouseMove)
  document.removeEventListener('mouseup', onVolumeMouseUp)
})

// Volume bar drag
const isVolDragging = ref(false)
const dragVolume = ref(0)
const volumeRef = ref<HTMLElement | null>(null)

const displayVolume = computed(() =>
  isVolDragging.value ? dragVolume.value : player.volume,
)

function calcVolumeRatio(e: MouseEvent) {
  if (!volumeRef.value) return 0
  const rect = volumeRef.value.getBoundingClientRect()
  return clamp((e.clientX - rect.left) / rect.width, 0, 1)
}

function onVolumeMouseDown(e: MouseEvent) {
  isVolDragging.value = true
  dragVolume.value = calcVolumeRatio(e)
  player.setVolume(dragVolume.value)
  document.addEventListener('mousemove', onVolumeMouseMove)
  document.addEventListener('mouseup', onVolumeMouseUp)
}

function onVolumeMouseMove(e: MouseEvent) {
  if (!isVolDragging.value) return
  dragVolume.value = calcVolumeRatio(e)
  player.setVolume(dragVolume.value)
}

function onVolumeMouseUp(e: MouseEvent) {
  if (!isVolDragging.value) return
  player.setVolume(calcVolumeRatio(e))
  isVolDragging.value = false
  document.removeEventListener('mousemove', onVolumeMouseMove)
  document.removeEventListener('mouseup', onVolumeMouseUp)
}
</script>

<template>
  <!-- Progress bar: fixed above everything including fullscreen player -->
  <div
    ref="progressRef"
    class="fixed bottom-20 left-0 right-0 z-50 h-1 bg-muted cursor-pointer group"
    @mousedown="onProgressMouseDown"
  >
    <div
      class="h-full bg-primary transition-none"
      :style="{ width: `${displayProgress * 100}%` }"
    />
    <div
      class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary
             opacity-0 group-hover:opacity-100 transition-opacity"
      :style="{ left: `${displayProgress * 100}%` }"
    />
  </div>

  <footer class="h-20 bg-player border-t border-border flex flex-col select-none relative z-40">
    <div class="flex-1 flex items-center px-4">
      <!-- Left: Song info -->
      <div class="flex items-center gap-3 w-64 min-w-0">
        <button
          class="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-muted
                 hover:ring-2 hover:ring-primary/30 transition-all"
          @click="player.toggleFullScreen"
        >
          <img
            v-if="player.currentSong?.cover"
            :src="player.currentSong.cover"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-muted-foreground">
            <span class="text-lg">♪</span>
          </div>
        </button>
        <div class="min-w-0">
          <button
            class="text-sm font-medium truncate hover:text-primary transition-colors block max-w-full text-left"
            @click="player.currentSong && goAlbum(player.currentSong.albumId)"
          >
            {{ player.currentSong?.name ?? '未播放' }}
          </button>
          <ArtistLinks
            v-if="player.currentSong"
            :artists="player.currentSong.artists"
            :artist="player.currentSong.artist"
            class="text-xs text-muted-foreground truncate block max-w-full text-left"
          />
          <span v-else class="text-xs text-muted-foreground">—</span>
        </div>
        <button
          class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
          @click="onHeartClick"
        >
          <Heart
            v-if="isCurrentLiked"
            :size="16"
            :fill="'currentColor'"
            class="text-primary"
          />
          <Heart v-else :size="16" class="text-muted-foreground hover:text-primary" />
        </button>
        <button
          v-if="isElectron && player.currentSong"
          class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
          @click="showDownloadDialog = true"
        >
          <Download
            :size="16"
            :class="downloads.isDownloaded(player.currentSong.id)
              ? 'text-green-500'
              : 'text-muted-foreground hover:text-primary'"
          />
        </button>
      </div>

      <!-- Center: Controls -->
      <div class="flex-1 flex items-center justify-center gap-4">
        <button
          class="p-2 rounded-full hover:bg-accent transition-colors"
          @click="player.togglePlayMode"
          :title="playModeLabel"
        >
          <component
            :is="playModeIcon"
            :size="18"
            class="text-muted-foreground"
          />
        </button>
        <button
          class="p-2 rounded-full hover:bg-accent transition-colors"
          @click="player.prev"
        >
          <SkipBack :size="20" />
        </button>
        <button
          class="w-10 h-10 rounded-full bg-primary text-primary-foreground
                 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          @click="player.togglePlay"
          :disabled="player.isLoading"
        >
          <Loader2 v-if="player.isLoading" :size="20" class="animate-spin" />
          <Pause v-else-if="player.isPlaying" :size="20" />
          <Play v-else :size="20" class="ml-0.5" />
        </button>
        <button
          class="p-2 rounded-full hover:bg-accent transition-colors"
          @click="player.next"
        >
          <SkipForward :size="20" />
        </button>
        <span class="text-xs text-muted-foreground w-24 text-center">
          {{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}
        </span>
      </div>

      <!-- Right: Volume & Playlist -->
      <div class="flex items-center gap-2 w-52 justify-end overflow-hidden">
        <button
          class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
          @click="player.setVolume(player.volume > 0 ? 0 : 0.7)"
        >
          <VolumeX v-if="player.volume === 0" :size="16" class="text-muted-foreground" />
          <Volume2 v-else :size="16" class="text-muted-foreground" />
        </button>
        <div
          ref="volumeRef"
          class="w-20 h-1 bg-muted rounded-full cursor-pointer relative group shrink-0"
          @mousedown="onVolumeMouseDown"
        >
          <div
            class="h-full bg-primary rounded-full transition-none"
            :style="{ width: `${displayVolume * 100}%` }"
          />
          <div
            class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary
                   opacity-0 group-hover:opacity-100 transition-opacity"
            :style="{ left: `${displayVolume * 100}%` }"
          />
        </div>
        <button
          class="p-1.5 rounded-full hover:bg-accent transition-colors shrink-0"
          @click="player.togglePlaylistDrawer"
        >
          <ListMusic :size="16" class="text-muted-foreground" />
        </button>
      </div>
    </div>
  </footer>

  <DownloadDialog
    v-if="player.currentSong"
    :song="player.currentSong"
    :show="showDownloadDialog"
    @close="showDownloadDialog = false"
  />
</template>
