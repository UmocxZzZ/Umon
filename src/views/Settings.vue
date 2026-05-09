<script setup lang="ts">
import { ref, computed } from 'vue'
import { Settings, HardDrive, Info, ExternalLink, RefreshCw } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import logoUrl from '@/assets/logo.png'

const version = __APP_VERSION__

declare const __APP_VERSION__: string

const settings = useSettingsStore()
const isElectron = computed(() => !!window.electronAPI)

const apiBaseInput = ref(settings.apiBase)
const isEditingApi = ref(false)
const checkingUpdate = ref(false)

function saveApiBase() {
  settings.setApiBase(apiBaseInput.value.trim())
  isEditingApi.value = false
}

async function selectFolder() {
  if (!window.electronAPI?.selectFolder) return
  const folder = await window.electronAPI.selectFolder()
  if (folder) settings.setDownloadDir(folder)
}

async function checkUpdate() {
  checkingUpdate.value = true
  try {
    await window.electronAPI?.checkUpdate?.()
  } finally {
    setTimeout(() => { checkingUpdate.value = false }, 1500)
  }
}
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto space-y-8">
    <h1 class="text-2xl font-bold flex items-center gap-3">
      <Settings :size="24" />
      全局设置
    </h1>

    <!-- API Path -->
    <section class="bg-card rounded-xl border border-border p-5 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">API 路径</h2>
      <div class="flex items-center gap-2">
        <input
          v-model="apiBaseInput"
          type="text"
          placeholder="默认"
          class="flex-1 h-9 px-3 rounded-lg bg-muted text-sm outline-none
                 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground"
          @focus="isEditingApi = true"
          @keyup.enter="saveApiBase"
        />
        <button
          v-if="isEditingApi"
          class="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                 hover:scale-[1.02] active:scale-[0.98] transition-transform"
          @click="saveApiBase"
        >
          保存
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        留空使用默认地址。修改后需重启应用生效。
      </p>
    </section>

    <!-- Download Folder (Electron only) -->
    <section v-if="isElectron" class="bg-card rounded-xl border border-border p-5 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <HardDrive :size="14" />
        下载文件夹
      </h2>
      <div class="flex items-center gap-2">
        <div class="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm truncate">
          <HardDrive :size="14" class="shrink-0 text-muted-foreground" />
          <span class="truncate">{{ settings.downloadDir || '默认下载文件夹' }}</span>
        </div>
        <button
          class="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-accent transition-colors"
          @click="selectFolder"
        >
          更改
        </button>
      </div>
    </section>

    <!-- About -->
    <section class="bg-card rounded-xl border border-border p-5 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <Info :size="14" />
        关于 Umon
      </h2>
      <div class="flex items-center gap-4">
        <img :src="logoUrl" alt="Umon" class="w-16 h-16 rounded-2xl object-cover" />
        <div>
          <p class="text-lg font-bold">Umon</p>
          <p class="text-sm text-muted-foreground">Ver.{{ version }}</p>
        </div>
      </div>
      <p class="text-sm text-muted-foreground leading-relaxed">
        Umon 诞生于
        <a
          href="https://uuuuu.su"
          target="_blank"
          class="text-primary hover:underline inline-flex items-center gap-1"
        >
          UmocxZzZ
          <ExternalLink :size="12" />
        </a>
      </p>
      <p class="text-xs text-muted-foreground">
        未来将加入更多功能，实现简洁高效的听歌体验。
      </p>
      <a
        href="https://github.com/UmocxZzZ/Umon"
        target="_blank"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
        </svg>
        GitHub 项目地址
        <ExternalLink :size="12" />
      </a>
      <button
        v-if="isElectron"
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-sm
               hover:bg-accent transition-colors"
        :disabled="checkingUpdate"
        @click="checkUpdate"
      >
        <RefreshCw :size="14" :class="{ 'animate-spin': checkingUpdate }" />
        {{ checkingUpdate ? '检查中...' : '检查更新' }}
      </button>
      <a
        v-else
        href="https://github.com/UmocxZzZ/Umon/releases"
        target="_blank"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-sm
               hover:bg-accent transition-colors"
      >
        <RefreshCw :size="14" />
        检查更新
      </a>
    </section>
  </div>
</template>
