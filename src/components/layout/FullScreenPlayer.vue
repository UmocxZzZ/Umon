<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown, Loader2, Waves } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { getHotComments } from '@/lib/api'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import MapScene from '@/components/visualizer/MapScene.vue'
import type { Comment } from '@/types'

const route = useRoute()
const player = usePlayerStore()
const { goAlbum } = useSongNavigate()
const comments = ref<Comment[]>([])
const commentsLoaded = ref(false)
const commentsLoading = ref(false)
const lyricsRef = ref<HTMLElement | null>(null)
const commentsRef = ref<HTMLElement | null>(null)
const currentPage = ref(0)
const immersiveMode = ref(false) // true = UI hidden, blur removed, full visualization

// Sync lyrics scroll to current line
watch(
  () => player.currentLyricIndex,
  (idx) => {
    if (idx >= 0 && lyricsRef.value) {
      // children[0] = top spacer, children[1] = lyrics container, children[2] = bottom spacer
      const lyricsContainer = lyricsRef.value.children[1] as HTMLElement
      if (lyricsContainer) {
        const el = lyricsContainer.children[idx] as HTMLElement
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  },
)

async function loadComments() {
  if (!player.currentSong || commentsLoaded.value || commentsLoading.value) return
  commentsLoading.value = true
  try {
    comments.value = await getHotComments(player.currentSong.id)
    commentsLoaded.value = true
  } catch (e) {
    console.error('[Comments] load error:', e)
  } finally {
    commentsLoading.value = false
  }
}

function formatLikedCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

// Scrollable area wheel: consume event unless at scroll boundary
function onScrollableWheel(e: WheelEvent, el: HTMLElement | null) {
  if (!el) return
  const atTop = el.scrollTop <= 0
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
  if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return
  e.stopPropagation()
}

// Check if event target is inside lyrics area
function isInLyricsArea(e: WheelEvent): boolean {
  const lyricsEl = lyricsRef.value
  if (!lyricsEl) return false
  return lyricsEl.contains(e.target as Node)
}

// Page-level wheel: switch pages (only when not in lyrics area)
function onWheel(e: WheelEvent) {
  if (isInLyricsArea(e)) return
  if (e.deltaY > 30 && currentPage.value === 0) {
    currentPage.value = 1
    loadComments()
  } else if (e.deltaY < -30 && currentPage.value === 1) {
    currentPage.value = 0
  }
}

// Reset on song change
watch(
  () => player.currentSong?.id,
  () => {
    comments.value = []
    commentsLoaded.value = false
  },
)

// Reset page on open
watch(
  () => player.showFullScreen,
  (show) => {
    if (show) currentPage.value = 0
    if (!show) immersiveMode.value = false
  },
)

// Close fullscreen player on route navigation
watch(
  () => route.path,
  () => {
    if (player.showFullScreen) player.showFullScreen = false
  },
)
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-300 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="player.showFullScreen"
      class="fixed inset-x-0 top-0 bottom-20 z-30 flex flex-col overflow-hidden bg-transparent"
      @wheel="onWheel"
    >
      <!-- Visualizer Background Layer (always active, always clear) -->
      <div
        class="absolute inset-0 z-0 overflow-hidden"
        @click="immersiveMode = false"
      >
        <MapScene :active="true" />
      </div>

      <!-- Background + Dim overlay (covers visualizer when not in immersive mode) -->
      <div
        class="absolute inset-0 z-[1] transition-opacity duration-700 pointer-events-none bg-background/80"
        :class="immersiveMode ? 'opacity-0' : 'opacity-100'"
      />

      <!-- Header -->
      <div
        class="flex items-center px-6 py-4 shrink-0 absolute top-0 left-0 right-0 z-20 transition-opacity duration-500"
        :class="immersiveMode ? 'opacity-0 pointer-events-none' : 'opacity-100'"
      >
        <button
          class="p-2 rounded-full hover:bg-accent transition-colors"
          @click="player.toggleFullScreen"
        >
          <ChevronDown :size="24" />
        </button>
        <div class="flex-1" />
        <button
          class="p-2 rounded-full transition-all duration-300 hover:bg-accent text-muted-foreground hover:text-foreground"
          @click="immersiveMode = true"
        >
          <Waves :size="20" />
        </button>
      </div>

      <!-- Pages: absolute stacking, each page fills the container -->
      <div
        class="flex-1 relative overflow-hidden transition-all duration-700 ease-out z-10"
        :class="immersiveMode
          ? 'opacity-0 pointer-events-none'
          : 'opacity-100'"
      >
        <!-- Page 1 -->
        <div
          class="absolute inset-0 flex transition-transform duration-500 ease-out"
          :style="{ transform: currentPage === 1 ? 'translateY(-100%)' : 'translateY(0)' }"
        >
          <!-- Left: Cover -->
          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <div
              class="rounded-full bg-gradient-to-br from-gray-800 to-gray-900
                     flex items-center justify-center shadow-2xl"
              :class="{ 'animate-spin': player.isPlaying }"
              style="animation-duration: 20s; width: min(40vh, 40vw); height: min(40vh, 40vw);"
            >
              <img
                v-if="player.currentSong?.cover"
                :src="player.currentSong.cover"
                class="rounded-full object-cover"
                style="width: 65%; height: 65%;"
              />
              <div v-else class="rounded-full bg-card flex items-center justify-center"
                   style="width: 65%; height: 65%;">
                <span class="text-3xl">♪</span>
              </div>
            </div>
            <div class="text-center space-y-1">
              <button
                class="text-lg font-semibold hover:text-primary transition-colors"
                @click="player.currentSong && goAlbum(player.currentSong.albumId)"
              >
                {{ player.currentSong?.name ?? '未播放' }}
              </button>
              <ArtistLinks
                v-if="player.currentSong"
                :artists="player.currentSong.artists"
                :artist="player.currentSong.artist"
                class="block text-sm text-muted-foreground mx-auto"
              />
              <button
                class="block text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
                @click="player.currentSong && goAlbum(player.currentSong.albumId)"
              >
                {{ player.currentSong?.album ?? '' }}
              </button>
            </div>
          </div>

          <!-- Right: Lyrics (independent scrollable container) -->
          <div class="flex-1 relative">
            <div
              v-if="player.lyrics.length > 0"
              ref="lyricsRef"
              class="absolute inset-0 overflow-y-auto px-12"
              style="overscroll-behavior: contain;"
            >
              <div style="height: 45vh;"></div>
              <div class="space-y-4">
                <p
                  v-for="(line, i) in player.lyrics"
                  :key="i"
                  class="text-lg transition-all duration-300 cursor-pointer"
                  :class="i === player.currentLyricIndex
                    ? 'text-foreground font-semibold scale-105'
                    : 'text-muted-foreground hover:text-foreground'"
                >
                  {{ line.text }}
                </p>
              </div>
              <div style="height: 80vh;"></div>
            </div>
            <div v-else class="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <p class="text-sm">暂无歌词，滚轮切换到评论页</p>
            </div>
          </div>
        </div>

        <!-- Page 2 -->
        <div
          class="absolute inset-0 flex flex-col transition-transform duration-500 ease-out"
          :style="{ transform: currentPage === 1 ? 'translateY(0)' : 'translateY(100%)' }"
        >
          <!-- Song info header -->
          <div class="flex flex-col items-center gap-3 pt-8 pb-6 shrink-0">
            <img
              v-if="player.currentSong?.cover"
              :src="player.currentSong.cover"
              class="w-24 h-24 rounded-xl object-cover shadow-lg"
            />
            <div v-else class="w-24 h-24 rounded-xl bg-muted flex items-ce
            nter justify-center">
              <span class="text-3xl">♪</span>
            </div>
            <div class="text-center">
              <button
                class="text-xl font-bold hover:text-primary transition-colors"
                @click="player.currentSong && goAlbum(player.currentSong.albumId)"
              >
                {{ player.currentSong?.name ?? '未播放' }}
              </button>
              <div class="text-sm text-muted-foreground mt-1">
                <ArtistLinks
                  v-if="player.currentSong"
                  :artists="player.currentSong.artists"
                  :artist="player.currentSong.artist"
                />
                <span v-if="player.currentSong?.album">
                  ·
                  <button
                    class="hover:text-foreground transition-colors"
                    @click="player.currentSong && goAlbum(player.currentSong.albumId)"
                  >
                    {{ player.currentSong.album }}
                  </button>
                </span>
              </div>
            </div>
          </div>

          <!-- Comments -->
          <div
            ref="commentsRef"
            class="flex-1 overflow-y-auto px-12 py-6 space-y-6"
            @wheel="onScrollableWheel($event, commentsRef)"
          >
            <div v-if="commentsLoading" class="flex items-center justify-center h-full">
              <Loader2 :size="24" class="animate-spin text-muted-foreground" />
            </div>
            <template v-else-if="comments.length > 0">
              <div
                v-for="c in comments"
                :key="c.id"
                class="flex gap-3"
              >
                <img
                  :src="c.avatar"
                  class="w-10 h-10 rounded-full object-cover shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">{{ c.user }}</span>
                    <span class="text-xs text-muted-foreground">{{ c.time }}</span>
                  </div>
                  <p class="text-sm mt-1 leading-relaxed">{{ c.content }}</p>
                  <p class="text-xs text-muted-foreground mt-1">
                    👍 {{ formatLikedCount(c.likedCount) }}
                  </p>
                </div>
              </div>
            </template>
            <div v-else class="flex items-center justify-center h-full text-muted-foreground">
              <p class="text-sm">暂无热评</p>
            </div>
          </div>
        </div>

        <!-- Page dots: absolute overlay on top of pages -->
        <div class="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2 z-10">
          <button
            class="w-2 h-2 rounded-full transition-colors"
            :class="currentPage === 0 ? 'bg-primary' : 'bg-muted-foreground/30'"
            @click="currentPage = 0"
          />
          <button
            class="w-2 h-2 rounded-full transition-colors"
            :class="currentPage === 1 ? 'bg-primary' : 'bg-muted-foreground/30'"
            @click="currentPage = 1; loadComments()"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>
