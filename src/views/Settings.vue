<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { Settings, AudioLines, HardDrive, Info, ExternalLink, RefreshCw, Trash2, Speaker, ListRestart } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { usePlaylistCacheStore } from '@/stores/playlistCache'
import { useToast } from '@/composables/useToast'
import { AUDIO_QUALITY_OPTIONS } from '@/lib/audioQuality'
import { supportsAudioOutputDeviceSelection } from '@/lib/audioEngine'
import type { AudioQuality } from '@/types'
import logoUrl from '@/assets/logo.png'

const version = __APP_VERSION__

declare const __APP_VERSION__: string

const settings = useSettingsStore()
const playlistCache = usePlaylistCacheStore()
const toast = useToast()
const isElectron = computed(() => !!window.electronAPI)

const apiBaseInput = ref(settings.apiBase)
const isEditingApi = ref(false)
const checkingUpdate = ref(false)
const audioOutputDevices = ref<Array<{ deviceId: string; label: string }>>([])
const isRefreshingAudioOutputs = ref(false)
const isSelectingAudioOutput = ref(false)
const audioOutputError = ref('')
const canSelectAudioOutput = computed(() => {
  return isElectron.value
    && supportsAudioOutputDeviceSelection()
    && typeof navigator.mediaDevices?.enumerateDevices === 'function'
})

type AudioOutputMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>
}

async function saveApiBase() {
  try {
    await settings.setApiBase(apiBaseInput.value)
    apiBaseInput.value = settings.apiBase
    isEditingApi.value = false
    toast.showToast('API 地址已生效')
  } catch (error) {
    toast.showToast(error instanceof Error ? error.message : 'API 地址无效')
  }
}

async function selectFolder() {
  if (!window.electronAPI?.selectFolder) return
  const folder = await window.electronAPI.selectFolder()
  if (folder) settings.setDownloadDir(folder)
}

async function checkUpdate() {
  checkingUpdate.value = true
  try {
    const result = await window.electronAPI?.checkUpdate?.()
    if (!result) return

    if (result.status === 'update-available') {
      toast.showToast(`发现新版本 v${result.latestVersion}，正在打开下载页面`)
    } else if (result.status === 'up-to-date') {
      toast.showToast(`当前 v${result.currentVersion} 已是最新版本`)
    } else if (result.status === 'no-release') {
      toast.showToast('GitHub 暂无已发布的正式版本')
    } else {
      toast.showToast(result.error ? `检查更新失败：${result.error}` : '检查更新失败')
    }
  } catch (error) {
    toast.showToast(error instanceof Error ? `检查更新失败：${error.message}` : '检查更新失败')
  } finally {
    setTimeout(() => { checkingUpdate.value = false }, 1500)
  }
}

function clearCache() {
  playlistCache.clearAll()
  toast.showToast('缓存已清除')
}

function selectPlaybackQuality(quality: AudioQuality) {
  if (settings.playbackQuality === quality) return
  settings.setPlaybackQuality(quality)
  toast.showToast('在线播放音质已切换')
}
async function refreshAudioOutputs() {
  if (!canSelectAudioOutput.value) return
  isRefreshingAudioOutputs.value = true
  audioOutputError.value = ''
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const seenDeviceIds = new Set<string>()
    const outputs = devices
      .filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default')
      .filter((device) => {
        if (!device.deviceId || seenDeviceIds.has(device.deviceId)) return false
        seenDeviceIds.add(device.deviceId)
        return true
      })
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `音频输出设备 ${index + 1}`,
      }))

    audioOutputDevices.value = [
      { deviceId: '', label: '系统默认输出' },
      ...outputs,
    ]

    if (
      settings.audioOutputDeviceId
      && !audioOutputDevices.value.some((device) => device.deviceId === settings.audioOutputDeviceId)
    ) {
      audioOutputDevices.value.push({
        deviceId: settings.audioOutputDeviceId,
        label: '已断开或未获授权的输出设备',
      })
    }
  } catch (error) {
    audioOutputError.value = error instanceof Error ? error.message : '无法读取音频输出设备'
  } finally {
    isRefreshingAudioOutputs.value = false
  }
}

async function selectAudioOutput(deviceId: string) {
  if (deviceId === settings.audioOutputDeviceId) return
  audioOutputError.value = ''
  try {
    await settings.setAudioOutputDevice(deviceId)
    toast.showToast(deviceId ? '音频输出设备已切换' : '已改为跟随系统默认输出')
  } catch (error) {
    audioOutputError.value = error instanceof Error ? error.message : '切换音频输出设备失败'
    await refreshAudioOutputs()
  }
}

function handleAudioOutputChange(event: Event) {
  const select = event.target
  if (!(select instanceof HTMLSelectElement)) return
  void selectAudioOutput(select.value)
}

async function openSystemAudioOutputPicker() {
  const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices
  if (typeof mediaDevices.selectAudioOutput !== 'function') {
    audioOutputError.value = '当前 Electron 运行环境无法打开系统输出设备选择器'
    return
  }

  isSelectingAudioOutput.value = true
  audioOutputError.value = ''
  try {
    const device = await mediaDevices.selectAudioOutput()
    await selectAudioOutput(device.deviceId)
    await refreshAudioOutputs()
  } catch (error) {
    // AbortError is the normal result when the user dismisses the system picker.
    if (error instanceof DOMException && error.name === 'AbortError') return
    audioOutputError.value = error instanceof Error ? error.message : '无法选择音频输出设备'
  } finally {
    isSelectingAudioOutput.value = false
  }
}

async function revealAllAudioOutputs() {
  if (!navigator.mediaDevices?.getUserMedia) {
    audioOutputError.value = '当前环境无法请求完整设备列表'
    return
  }

  audioOutputError.value = ''
  try {
    // Chromium only exposes all output devices after an input permission grant.
    // Stop immediately: Umon never records microphone audio.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    await refreshAudioOutputs()
  } catch (error) {
    audioOutputError.value = error instanceof Error ? error.message : '未获得读取完整设备列表的权限'
  }
}

function handleAudioDeviceChange() {
  void refreshAudioOutputs()
}

onMounted(() => {
  if (!canSelectAudioOutput.value) return
  void refreshAudioOutputs()
  navigator.mediaDevices.addEventListener('devicechange', handleAudioDeviceChange)
})

onBeforeUnmount(() => {
  navigator.mediaDevices?.removeEventListener('devicechange', handleAudioDeviceChange)
})
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto space-y-8">
    <h1 class="text-2xl font-bold flex items-center gap-3">
      <Settings :size="24" />
      全局设置
    </h1>

    <!-- API Path -->
    <section v-if="isElectron" class="bg-card rounded-xl border border-border p-5 space-y-3">
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
        留空使用构建时的默认地址，保存后立即生效。
      </p>
    </section>

    <!-- Audio output device (Electron) -->
    <section v-if="isElectron" class="bg-card rounded-xl border border-border p-5 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <Speaker :size="14" />
        音频输出设备
      </h2>
      <template v-if="canSelectAudioOutput">
        <div class="flex flex-col gap-2 sm:flex-row">
          <select
            :value="settings.audioOutputDeviceId"
            :disabled="isRefreshingAudioOutputs || isSelectingAudioOutput"
            class="min-w-0 flex-1 h-9 px-3 rounded-lg bg-muted text-sm outline-none
                   focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            @change="handleAudioOutputChange"
          >
            <option
              v-for="device in audioOutputDevices"
              :key="device.deviceId"
              :value="device.deviceId"
            >
              {{ device.label }}
            </option>
          </select>
          <button
            class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm
                   hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            :disabled="isRefreshingAudioOutputs || isSelectingAudioOutput"
            @click="openSystemAudioOutputPicker"
          >
            <Speaker :size="14" />
            {{ isSelectingAudioOutput ? '选择中...' : '系统选择' }}
          </button>
          <button
            class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm
                   hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            :disabled="isRefreshingAudioOutputs || isSelectingAudioOutput"
            @click="refreshAudioOutputs"
          >
            <ListRestart :size="14" :class="{ 'animate-spin': isRefreshingAudioOutputs }" />
            刷新
          </button>
        </div>
        <p class="text-xs text-muted-foreground">
          切换会立刻作用于当前歌曲和无缝播放。若列表只显示默认设备，可点击“系统选择”或授权显示完整设备列表。
        </p>
        <button
          class="text-xs text-muted-foreground hover:text-primary transition-colors"
          :disabled="isRefreshingAudioOutputs || isSelectingAudioOutput"
          @click="revealAllAudioOutputs"
        >
          授权显示完整设备列表（不会录音）
        </button>
        <p v-if="audioOutputError" class="text-xs text-destructive">
          {{ audioOutputError }}
        </p>
      </template>
      <p v-else class="text-xs text-muted-foreground">
        当前 Electron 运行环境不支持音频输出设备切换。
      </p>
    </section>

    <!-- Online playback quality -->
    <section class="bg-card rounded-xl border border-border p-5 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <AudioLines :size="14" />
        在线播放音质
      </h2>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="option in AUDIO_QUALITY_OPTIONS"
          :key="option.value"
          class="px-3 py-2 rounded-lg text-left text-xs border transition-colors"
          :class="settings.playbackQuality === option.value
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border hover:border-primary/50'"
          @click="selectPlaybackQuality(option.value)"
        >
          <span class="font-medium">{{ option.label }}</span>
          <span class="text-muted-foreground ml-1">{{ option.description }}</span>
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        默认使用极高音质。切换后会重新加载当前歌曲，并应用于后续预加载。
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

    <!-- Cache -->
    <section class="bg-card rounded-xl border border-border p-5 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <Trash2 :size="14" />
        缓存管理
      </h2>
      <p class="text-xs text-muted-foreground">
        清除歌单缓存数据，释放本地存储空间。
      </p>
      <button
        class="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-accent transition-colors"
        @click="clearCache"
      >
        清除缓存
      </button>
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
