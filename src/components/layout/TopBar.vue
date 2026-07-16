<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Sun,
  Moon,
  Settings,
  LogIn,
  LogOut,
  Minus,
  Square,
  X,
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { getSearchDefault } from '@/lib/api'
import logoUrl from '@/assets/logo.png'

const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()
const searchQuery = ref('')
const showMenu = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const searchDefault = ref('')
const placeholderText = computed(() => searchDefault.value ? `搜索 ${searchDefault.value}` : '搜索音乐、歌手、歌词')

async function fetchSearchDefault() {
  searchDefault.value = await getSearchDefault()
}

const isElectron = computed(() => !!window.electronAPI)
const dragStyle = { '-webkit-app-region': 'drag' } as Record<string, string>
const noDragStyle = { '-webkit-app-region': 'no-drag' } as Record<string, string>

const canGoBack = ref(false)
const canGoForward = ref(false)

function updateNavState() {
  const state = window.history.state
  canGoBack.value = state?.position > 0
  canGoForward.value = state?.position < window.history.length - 1
}

router.afterEach(() => updateNavState())
onMounted(() => updateNavState())

function goBack() {
  router.back()
}

function goForward() {
  router.forward()
}

function handleLogin() {
  showMenu.value = false
  router.push('/login')
}

function onSearch() {
  const kw = searchQuery.value.trim()
  if (kw) router.push(`/search/${encodeURIComponent(kw)}`)
}

function handleLogout() {
  showMenu.value = false
  void auth.logout()
}

function onDocClick(e: MouseEvent) {
  if (showMenu.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    showMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  fetchSearchDefault()
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
})

function winMinimize() {
  window.electronAPI?.minimize()
}

function winMaximize() {
  window.electronAPI?.maximize()
}

function winClose() {
  window.electronAPI?.close()
}
</script>

<template>
  <header
    class="h-14 flex items-center px-4 gap-3 bg-card border-b border-border select-none"
    :style="isElectron ? dragStyle : {}"
  >
    <!-- Navigation -->
    <div class="flex items-center gap-1" :style="isElectron ? noDragStyle : {}">
      <button
        class="p-1.5 rounded-full transition-colors"
        :class="canGoBack ? 'hover:bg-accent text-foreground' : 'text-muted-foreground/40 cursor-default'"
        :disabled="!canGoBack"
        @click="goBack"
      >
        <ChevronLeft :size="18" />
      </button>
      <button
        class="p-1.5 rounded-full transition-colors"
        :class="canGoForward ? 'hover:bg-accent text-foreground' : 'text-muted-foreground/40 cursor-default'"
        :disabled="!canGoForward"
        @click="goForward"
      >
        <ChevronRight :size="18" />
      </button>
    </div>

    <!-- Logo -->
    <div class="flex items-center gap-2 mr-2">
      <img :src="logoUrl" alt="Umon" class="w-7 h-7 rounded-md" />
      <span class="text-lg font-bold text-primary tracking-tight">Umon</span>
    </div>

    <!-- Search -->
    <div class="w-64" :style="isElectron ? noDragStyle : {}">
      <div class="relative">
        <Search
          :size="16"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="placeholderText"
          class="w-full h-8 pl-9 pr-3 rounded-full bg-muted text-sm outline-none
                 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground"
          @keyup.enter="onSearch"
        />
      </div>
    </div>

    <!-- Account -->
    <div ref="menuRef" class="relative ml-auto" :style="isElectron ? noDragStyle : {}">
      <button
        class="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-accent transition-colors"
        @click="showMenu = !showMenu"
      >
        <div
          class="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0"
        >
          <img
            v-if="auth.isLoggedIn && auth.profile?.avatarUrl"
            :src="auth.profile.avatarUrl"
            class="w-full h-full object-cover"
          />
          <span v-else class="text-xs font-medium text-muted-foreground">?</span>
        </div>
        <span class="text-sm text-muted-foreground truncate max-w-[80px]">
          {{ auth.isLoggedIn && auth.profile ? auth.profile.nickname : '未登录' }}
        </span>
      </button>

      <!-- Dropdown -->
      <Transition
        enter-active-class="transition ease-out duration-100"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition ease-in duration-75"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="showMenu"
          class="absolute right-0 top-10 w-44 py-1 bg-card rounded-lg shadow-lg border border-border z-[60]"
        >
          <!-- User info when logged in -->
          <div v-if="auth.isLoggedIn && auth.profile" class="px-3 py-2 border-b border-border">
            <p class="text-sm font-medium truncate">{{ auth.profile.nickname }}</p>
            <p class="text-xs text-muted-foreground">ID: {{ auth.profile.userId }}</p>
          </div>

          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
            @click="settings.toggleTheme(); showMenu = false"
          >
            <Sun v-if="settings.theme === 'dark'" :size="14" />
            <Moon v-else :size="14" />
            {{ settings.theme === 'dark' ? '浅色模式' : '深色模式' }}
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
            @click="router.push('/settings'); showMenu = false"
          >
            <Settings :size="14" />
            全局设置
          </button>
          <div class="border-t border-border my-1" />
          <button
            v-if="auth.isLoggedIn"
            class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
            @click="handleLogout"
          >
            <LogOut :size="14" />
            退出登录
          </button>
          <button
            v-else
            class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
            @click="handleLogin"
          >
            <LogIn :size="14" />
            登录
          </button>
        </div>
      </Transition>
    </div>

    <!-- Electron Window Controls -->
    <div
      v-if="isElectron"
      class="flex items-center gap-0.5"
      :style="noDragStyle"
    >
      <button
        class="w-11 h-8 flex items-center justify-center text-muted-foreground
               hover:bg-accent transition-colors"
        @click="winMinimize"
      >
        <Minus :size="16" />
      </button>
      <button
        class="w-11 h-8 flex items-center justify-center text-muted-foreground
               hover:bg-accent transition-colors"
        @click="winMaximize"
      >
        <Square :size="14" />
      </button>
      <button
        class="w-11 h-8 flex items-center justify-center text-muted-foreground
               hover:bg-destructive hover:text-destructive-foreground transition-colors"
        @click="winClose"
      >
        <X :size="16" />
      </button>
    </div>
  </header>
</template>
