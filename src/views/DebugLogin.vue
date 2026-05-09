<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Loader2, RefreshCw, CheckCircle } from 'lucide-vue-next'
import { getQrKey, createQrCode, checkQrStatus, getUserAccount } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const qrImg = ref('')
const statusText = ref('加载中...')
const statusCode = ref(0)
const loading = ref(true)
const saved = ref(false)
const savedPath = ref('')

let qrKey = ''
let pollTimer: ReturnType<typeof setInterval> | null = null

async function initQr() {
  loading.value = true
  statusCode.value = 0
  statusText.value = '加载中...'
  saved.value = false
  try {
    qrKey = await getQrKey()
    qrImg.value = await createQrCode(qrKey)
    statusCode.value = 801
    statusText.value = '请使用网易云音乐 APP 扫码登录'
    startPolling()
  } catch (e) {
    statusText.value = '加载失败，请重试'
    console.error('[DebugLogin] init error:', e)
  } finally {
    loading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await checkQrStatus(qrKey)
      statusCode.value = res.code
      if (res.code === 801) {
        statusText.value = '请使用网易云音乐 APP 扫码登录'
      } else if (res.code === 802) {
        statusText.value = '已扫码，请在手机上确认'
      } else if (res.code === 803) {
        statusText.value = '登录成功！'
        stopPolling()
        if (res.cookie) {
          auth.setCookie(res.cookie)
          const profile = await getUserAccount(res.cookie)
          if (profile) auth.setProfile(profile)
          // Save to file
          try {
            const r = await fetch('/__debug-cookie', {
              method: 'POST',
              body: res.cookie,
            })
            const data = await r.json() as { ok: boolean; path: string }
            if (data.ok) {
              saved.value = true
              savedPath.value = data.path
            }
          } catch (e) {
            console.error('[DebugLogin] save cookie error:', e)
          }
        }
      } else if (res.code === 800) {
        statusText.value = '二维码已过期，请刷新'
        stopPolling()
      }
    } catch (e) {
      console.error('[DebugLogin] poll error:', e)
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(initQr)
onUnmounted(stopPolling)
</script>

<template>
  <div class="flex items-center justify-center h-full">
    <div class="w-96 p-8 bg-card rounded-2xl border border-border shadow-sm text-center space-y-6">
      <div>
        <h1 class="text-xl font-bold">Debug Login</h1>
        <p class="text-xs text-muted-foreground mt-1">扫码登录后 cookie 保存到项目根目录</p>
      </div>

      <!-- QR Code -->
      <div class="relative w-52 h-52 mx-auto">
        <div
          v-if="loading"
          class="w-full h-full flex items-center justify-center bg-muted rounded-xl"
        >
          <Loader2 :size="32" class="animate-spin text-muted-foreground" />
        </div>
        <template v-else>
          <img
            v-if="qrImg"
            :src="qrImg"
            alt="QR Code"
            class="w-full h-full rounded-xl"
            :class="{ 'opacity-40': statusCode === 800 || statusCode === 803 }"
          />
          <div
            v-if="statusCode === 800"
            class="absolute inset-0 flex flex-col items-center justify-center bg-background/80 rounded-xl"
          >
            <button
              class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground
                     rounded-full text-sm font-medium hover:scale-105 transition-transform"
              @click="initQr"
            >
              <RefreshCw :size="14" />
              刷新二维码
            </button>
          </div>
          <div
            v-if="statusCode === 803"
            class="absolute inset-0 flex items-center justify-center bg-background/80 rounded-xl"
          >
            <CheckCircle :size="48" class="text-green-500" />
          </div>
        </template>
      </div>

      <!-- Status -->
      <p
        class="text-sm"
        :class="{
          'text-muted-foreground': statusCode === 801,
          'text-yellow-500': statusCode === 802,
          'text-green-500': statusCode === 803,
          'text-orange-500': statusCode === 800,
        }"
      >
        {{ statusText }}
      </p>

      <!-- Saved info -->
      <div v-if="saved" class="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-left">
        <p class="text-xs text-green-600 dark:text-green-400 font-medium mb-1">
          Cookie 已保存到：
        </p>
        <p class="text-xs text-muted-foreground font-mono break-all">{{ savedPath }}</p>
      </div>

      <!-- User info -->
      <div v-if="auth.isLoggedIn && auth.profile" class="p-3 bg-accent rounded-lg text-left">
        <p class="text-xs text-muted-foreground mb-1">当前登录用户：</p>
        <div class="flex items-center gap-2">
          <img :src="auth.profile.avatarUrl" class="w-8 h-8 rounded-full" />
          <div>
            <p class="text-sm font-medium">{{ auth.profile.nickname }}</p>
            <p class="text-xs text-muted-foreground">UID: {{ auth.profile.userId }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
