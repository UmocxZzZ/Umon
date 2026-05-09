<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Compass,
  Heart,
  Clock,
  ChevronDown,
  ListMusic,
  Download,
} from 'lucide-vue-next'
import { getUserPlaylists } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { Playlist } from '@/types'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const isElectron = computed(() => !!window.electronAPI)

const showCreated = ref(true)
const showCollected = ref(true)

const createdPlaylists = ref<Playlist[]>([])
const collectedPlaylists = ref<Playlist[]>([])

async function loadUserPlaylists() {
  if (!auth.profile) return
  try {
    const all = await getUserPlaylists(auth.profile.userId)
    const uid = auth.profile.userId
    // Skip "喜欢的音乐" (specialType === 5)
    const normal = all.filter((p) => p.specialType !== 5)
    createdPlaylists.value = normal.filter((p) => p.creatorId === uid && !p.subscribed)
    collectedPlaylists.value = normal.filter((p) => p.subscribed === true)
  } catch (e) {
    console.error('[SideBar] load user playlists:', e)
  }
}

onMounted(() => {
  if (auth.isLoggedIn) loadUserPlaylists()
})

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) loadUserPlaylists()
    else {
      createdPlaylists.value = []
      collectedPlaylists.value = []
    }
  },
)

function navigate(path: string) {
  router.push(path)
}

function isActive(path: string) {
  return route.path === path
}
</script>

<template>
  <aside class="w-52 h-full bg-sidebar border-r border-border flex flex-col overflow-hidden">
    <nav class="flex-1 overflow-y-auto py-3 px-2 space-y-1">
      <!-- 个性推荐 -->
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive('/discover')
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-sidebar-foreground hover:bg-accent'"
        @click="navigate('/discover')"
      >
        <Compass :size="16" />
        个性推荐
      </button>

      <!-- 我的 -->
      <div class="border-t border-border my-3" />
      <p class="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        我的
      </p>

      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive('/favorites')
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-sidebar-foreground hover:bg-accent'"
        @click="navigate('/favorites')"
      >
        <Heart :size="16" />
        我喜欢的音乐
      </button>

      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive('/recent')
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-sidebar-foreground hover:bg-accent'"
        @click="navigate('/recent')"
      >
        <Clock :size="16" />
        最近播放
      </button>

      <button
        v-if="isElectron"
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive('/downloads')
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-sidebar-foreground hover:bg-accent'"
        @click="navigate('/downloads')"
      >
        <Download :size="16" />
        下载管理
      </button>

      <!-- 创建的歌单 -->
      <div class="border-t border-border my-3" />
      <div>
        <button
          class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold
                 text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          @click="showCreated = !showCreated"
        >
          <div class="flex items-center gap-1">
            <ChevronDown
              :size="12"
              class="transition-transform"
              :class="{ '-rotate-90': !showCreated }"
            />
            创建的歌单
          </div>
        </button>
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-96"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 max-h-96"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="showCreated" class="overflow-hidden">
            <div v-if="!auth.isLoggedIn" class="px-3 py-2 text-xs text-muted-foreground">
              登录后查看
            </div>
            <button
              v-for="pl in createdPlaylists"
              :key="pl.id"
              class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm
                     text-sidebar-foreground hover:bg-accent transition-colors"
              @click="navigate(`/playlist/${pl.id}`)"
            >
              <ListMusic :size="14" class="text-muted-foreground shrink-0" />
              <span class="truncate">{{ pl.name }}</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- 收藏的歌单 -->
      <div>
        <button
          class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold
                 text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          @click="showCollected = !showCollected"
        >
          <div class="flex items-center gap-1">
            <ChevronDown
              :size="12"
              class="transition-transform"
              :class="{ '-rotate-90': !showCollected }"
            />
            收藏的歌单
          </div>
        </button>
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-96"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 max-h-96"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="showCollected" class="overflow-hidden">
            <div v-if="!auth.isLoggedIn" class="px-3 py-2 text-xs text-muted-foreground">
              登录后查看
            </div>
            <button
              v-for="pl in collectedPlaylists"
              :key="pl.id"
              class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm
                     text-sidebar-foreground hover:bg-accent transition-colors"
              @click="navigate(`/playlist/${pl.id}`)"
            >
              <ListMusic :size="14" class="text-muted-foreground shrink-0" />
              <span class="truncate">{{ pl.name }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </nav>
  </aside>
</template>
