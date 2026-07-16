<script setup lang="ts">
import { ref, computed } from 'vue'
import { X, Download, HardDrive } from 'lucide-vue-next'
import { useDownloadsStore } from '@/stores/downloads'
import { useSettingsStore } from '@/stores/settings'
import { AUDIO_QUALITY_OPTIONS } from '@/lib/audioQuality'
import { getDisplayThumbnailUrl } from '@/lib/image'
import type { AudioQuality, Song } from '@/types'

const props = defineProps<{
  song: Song
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const downloads = useDownloadsStore()
const settings = useSettingsStore()

const isElectron = computed(() => !!window.electronAPI)
const quality = ref<AudioQuality>(settings.playbackQuality)

function handleDownload() {
  downloads.downloadSong(props.song, quality.value)
  emit('close')
}

async function selectFolder() {
  if (!window.electronAPI?.selectFolder) return
  const folder = await window.electronAPI.selectFolder()
  if (folder) settings.setDownloadDir(folder)
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
        @click.self="emit('close')"
      >
        <div class="bg-card rounded-xl border border-border shadow-xl w-80 p-5 space-y-4">
          <!-- Header -->
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">下载歌曲</h3>
            <button
              class="p-1 rounded-full hover:bg-accent transition-colors"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </div>

          <!-- Song info -->
          <div class="flex items-center gap-3">
            <img
              v-if="song.cover"
              :src="getDisplayThumbnailUrl(song.cover, 48)"
              decoding="async"
              class="w-12 h-12 rounded-lg object-cover"
            />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">{{ song.name }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ song.artist }}</p>
            </div>
          </div>

          <!-- Quality -->
          <div>
            <p class="text-xs text-muted-foreground mb-2">音质选择</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="opt in AUDIO_QUALITY_OPTIONS"
                :key="opt.value"
                class="px-3 py-2 rounded-lg text-xs border transition-colors"
                :class="quality === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50'"
                @click="quality = opt.value"
              >
                <span class="font-medium">{{ opt.label }}</span>
                <span class="text-muted-foreground ml-1">{{ opt.description }}</span>
              </button>
            </div>
          </div>

          <!-- Download path (Electron only) -->
          <div v-if="isElectron">
            <p class="text-xs text-muted-foreground mb-2">下载路径</p>
            <div class="flex items-center gap-2">
              <div class="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-xs truncate">
                <HardDrive :size="14" class="shrink-0 text-muted-foreground" />
                <span class="truncate">{{ settings.downloadDir || '默认下载文件夹' }}</span>
              </div>
              <button
                class="px-3 py-2 rounded-lg bg-muted text-xs hover:bg-accent transition-colors"
                @click="selectFolder"
              >
                更改
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-1">
            <button
              class="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform"
              @click="handleDownload"
            >
              <Download :size="14" />
              下载
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
