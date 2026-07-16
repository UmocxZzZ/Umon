<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Download, Play, Heart, FolderOpen, RefreshCw, Trash2, Pause, X, ChevronDown } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useLikesStore } from '@/stores/likes'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadDialog from '@/components/DownloadDialog.vue'
import LazySongCover from '@/components/LazySongCover.vue'
import type { DownloadItem } from '@/stores/downloads'
import type { Song } from '@/types'

const player = usePlayerStore()
const likes = useLikesStore()
const downloads = useDownloadsStore()

const showProgressPanel = ref(false)
const redownloadSong = ref<Song | null>(null)
const progressRef = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (progressRef.value && !progressRef.value.contains(e.target as Node)) {
    showProgressPanel.value = false
  }
}

onMounted(() => {
  downloads.checkFileExists()
  document.addEventListener('mousedown', onDocClick)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
})

const activeItems = computed(() =>
  downloads.items.filter((d) => d.status === 'downloading' || d.status === 'paused')
)

const hasPaused = computed(() =>
  downloads.items.some((d) => d.status === 'paused')
)

const totalSpeed = computed(() =>
  activeItems.value.reduce((sum, d) => sum + d.speed, 0)
)

function formatSpeed(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes.toFixed(0)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function playSong(item: DownloadItem) {
  const all = downloads.items.filter((d) => d.status === 'done').map((d) => d.song)
  const idx = all.findIndex((s) => s.id === item.song.id)
  if (idx !== -1) player.setPlaylist(all, idx)
}

function playAll() {
  const all = downloads.items.filter((d) => d.status === 'done').map((d) => d.song)
  if (all.length > 0) player.setPlaylist(all, 0)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function handleRedownload(item: DownloadItem) {
  redownloadSong.value = item.song
}

function onRedownloadClose() {
  redownloadSong.value = null
}
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-6">
      <div class="w-20 h-20 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20
                  flex items-center justify-center">
        <Download :size="32" class="text-green-500" />
      </div>
      <div>
        <h1 class="text-2xl font-bold">下载管理</h1>
        <p class="text-sm text-muted-foreground">{{ downloads.items.length }} 首歌曲</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <!-- Download progress toggle -->
        <div ref="progressRef" class="relative">
          <button
            class="flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-sm
                   hover:bg-accent transition-colors"
            @click="showProgressPanel = !showProgressPanel"
          >
            <Download :size="14" :class="{ 'text-primary animate-pulse': activeItems.length > 0 }" />
            {{ activeItems.length > 0 ? `${activeItems.length} 个下载中` : '下载进度' }}
            <ChevronDown :size="14" :class="{ 'rotate-180': showProgressPanel }" class="transition-transform" />
          </button>

          <!-- Progress dropdown -->
          <Transition
            enter-active-class="transition ease-out duration-150"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition ease-in duration-100"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
          >
          <div
            v-if="showProgressPanel"
            class="absolute right-0 top-12 w-80 bg-card rounded-xl border border-border shadow-xl z-50"
          >
            <!-- Actions -->
            <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
              <button
                v-if="hasPaused"
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                       border border-border text-xs hover:bg-accent transition-colors"
                @click.stop="downloads.resumeAll()"
              >
                <Play :size="12" />
                全部继续
              </button>
              <button
                v-else
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                       border border-border text-xs hover:bg-accent transition-colors"
                @click.stop="downloads.pauseAll()"
              >
                <Pause :size="12" />
                全部暂停
              </button>
              <button
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                       border border-border text-xs hover:bg-accent transition-colors"
                @click.stop="downloads.cancelAll()"
              >
                <X :size="12" />
                全部取消
              </button>
            </div>

            <!-- Total speed -->
            <div class="px-4 py-2 text-xs text-muted-foreground border-b border-border">
              总速度: {{ formatSpeed(totalSpeed) }}
            </div>

            <!-- Per-song list -->
            <div class="max-h-60 overflow-y-auto">
              <div
                v-for="item in activeItems"
                :key="item.song.id"
                class="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors"
              >
                <LazySongCover :src="item.song.cover" :alt="item.song.name" />
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium truncate">{{ item.song.name }}</p>
                  <div class="flex items-center gap-2 mt-1">
                    <div class="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        class="h-full bg-primary rounded-full transition-all duration-300"
                        :style="{ width: `${item.progress}%` }"
                      />
                    </div>
                    <span class="text-[10px] text-muted-foreground shrink-0">
                      {{ item.progress }}%
                    </span>
                  </div>
                  <div class="flex items-center justify-between mt-0.5">
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatSize(item.downloaded) }}{{ item.totalSize > 0 ? ` / ${formatSize(item.totalSize)}` : '' }}
                    </span>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatSpeed(item.speed) }}
                    </span>
                  </div>
                </div>
                <div class="flex items-center gap-0.5 shrink-0">
                  <button
                    v-if="item.status === 'downloading'"
                    class="p-1 rounded hover:bg-accent transition-colors"
                    @click.stop="downloads.pauseDownload(item.song.id)"
                  >
                    <Pause :size="14" class="text-muted-foreground" />
                  </button>
                  <button
                    v-else-if="item.status === 'paused'"
                    class="p-1 rounded hover:bg-accent transition-colors"
                    @click.stop="downloads.resumeDownload(item.song.id)"
                  >
                    <Play :size="14" class="text-muted-foreground" />
                  </button>
                  <button
                    class="p-1 rounded hover:bg-accent transition-colors"
                    @click.stop="downloads.cancelDownload(item.song.id)"
                  >
                    <X :size="14" class="text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </div>

              <!-- Empty state -->
              <div
                v-if="activeItems.length === 0"
                class="py-6 text-center text-xs text-muted-foreground"
              >
                没有正在下载的任务
              </div>
            </div>
          </div>
          </Transition>
        </div>

        <button
          class="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground
                 rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-transform"
          @click="playAll"
        >
          <Play :size="16" />
          播放全部
        </button>
      </div>
    </div>

    <!-- List -->
    <div class="bg-card rounded-xl border border-border overflow-hidden">
      <div
        v-for="item in downloads.items"
        :key="item.song.id"
        class="flex items-center gap-4 px-4 py-3 hover:bg-accent transition-colors"
      >
        <LazySongCover
          :src="item.song.cover"
          :alt="item.song.name"
          :class="{ 'opacity-40': item.status === 'missing' || item.status === 'error' }"
        />
        <div class="flex-1 min-w-0">
          <p
            class="text-sm font-medium truncate"
            :class="{ 'line-through text-muted-foreground': item.status === 'missing' }"
          >
            {{ item.song.name }}
          </p>
          <p class="text-xs text-muted-foreground truncate">{{ item.song.artist }}</p>
        </div>

        <!-- Progress / Date -->
        <div v-if="item.status === 'downloading' || item.status === 'paused'" class="w-24 hidden sm:block">
          <div class="text-xs text-muted-foreground mb-1">
            {{ item.status === 'paused' ? '已暂停' : formatSpeed(item.speed) }} · {{ item.progress }}%
          </div>
          <div class="h-1 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-primary rounded-full transition-all duration-300"
              :style="{ width: `${item.progress}%` }"
            />
          </div>
        </div>
        <span
          v-else
          class="text-xs hidden sm:block"
          :class="item.status === 'missing' || item.status === 'error' ? 'text-muted-foreground/40' : 'text-muted-foreground'"
        >
          {{ formatDate(item.timestamp) }}
        </span>

        <!-- Actions -->
        <div class="flex items-center gap-1">
          <!-- Pause / Resume for downloading items -->
          <button
            v-if="item.status === 'downloading'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="downloads.pauseDownload(item.song.id)"
          >
            <Pause :size="16" class="text-muted-foreground" />
          </button>
          <button
            v-else-if="item.status === 'paused'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="downloads.resumeDownload(item.song.id)"
          >
            <Play :size="16" class="text-muted-foreground" />
          </button>

          <!-- Cancel for downloading/paused items -->
          <button
            v-if="item.status === 'downloading' || item.status === 'paused'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="downloads.cancelDownload(item.song.id)"
          >
            <X :size="16" class="text-muted-foreground hover:text-destructive" />
          </button>

          <!-- Play for done items -->
          <button
            v-if="item.status === 'done'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="playSong(item)"
          >
            <Play :size="16" class="text-muted-foreground hover:text-primary" />
          </button>

          <!-- Heart -->
          <button
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="likes.toggleLike(item.song.id)"
          >
            <Heart
              v-if="likes.isLiked(item.song.id)"
              :size="16"
              :fill="'currentColor'"
              class="text-primary"
            />
            <Heart v-else :size="16" class="text-muted-foreground hover:text-primary" />
          </button>

          <!-- Open folder / Redownload -->
          <button
            v-if="item.status === 'done'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="downloads.openFileFolder(item.filePath)"
          >
            <FolderOpen :size="16" class="text-muted-foreground hover:text-primary" />
          </button>
          <button
            v-else-if="item.status === 'missing' || item.status === 'error'"
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="handleRedownload(item)"
          >
            <RefreshCw :size="16" class="text-muted-foreground hover:text-primary" />
          </button>

          <!-- Remove -->
          <button
            class="p-1.5 rounded-full hover:bg-accent transition-colors"
            @click="downloads.removeItem(item.song.id)"
          >
            <Trash2 :size="16" class="text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="downloads.items.length === 0"
        class="py-16 text-center text-muted-foreground"
      >
        <Download :size="40" class="mx-auto mb-3 opacity-30" />
        <p class="text-sm">还没有下载记录</p>
      </div>
    </div>

    <!-- Redownload dialog -->
    <DownloadDialog
      v-if="redownloadSong"
      :song="redownloadSong"
      :show="!!redownloadSong"
      @close="onRedownloadClose"
    />
  </div>
</template>
