<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Loader2, RefreshCw } from 'lucide-vue-next'
import { getQrKey, createQrCode, checkQrStatus, getUserAccount } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const qrImg = ref('')
const statusText = ref('加载中...')
const statusCode = ref(0) // 0=loading, 801=waiting, 802=scanned, 803=success, 800=expired
const loading = ref(true)

let qrKey = ''
let pollTimer: ReturnType<typeof setInterval> | null = null

async function initQr() {
  loading.value = true
  statusCode.value = 0
  statusText.value = '加载中...'
  try {
    qrKey = await getQrKey()
    qrImg.value = await createQrCode(qrKey)
    statusCode.value = 801
    statusText.value = '请使用网易云音乐 APP 扫码登录'
    startPolling()
  } catch (e) {
    statusText.value = '加载失败，请重试'
    console.error('[Login] init error:', e)
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
          // Small delay to ensure cookie is saved before fetching profile
          await new Promise(resolve => setTimeout(resolve, 200))
          try {
            const profile = await getUserAccount(res.cookie)
            if (profile) {
              auth.setProfile(profile)
            }
          } catch {
            // Ignore error
          }
        }
        setTimeout(() => router.push('/discover'), 800)
      } else if (res.code === 800) {
        statusText.value = '二维码已过期，请刷新'
        stopPolling()
      }
    } catch (e) {
      console.error('[Login] poll error:', e)
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function refreshQr() {
  initQr()
}

onMounted(initQr)
onUnmounted(stopPolling)
</script>

<template>
  <div class="flex items-center justify-center h-full">
    <div class="w-80 p-8 bg-card rounded-2xl border border-border shadow-sm text-center space-y-6">
      <h1 class="text-xl font-bold">登录 Umon</h1>

      <!-- QR Code -->
      <div class="relative w-48 h-48 mx-auto">
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
          <!-- Expired overlay -->
          <div
            v-if="statusCode === 800"
            class="absolute inset-0 flex flex-col items-center justify-center bg-background/80 rounded-xl"
          >
            <button
              class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground
                     rounded-full text-sm font-medium hover:scale-105 transition-transform"
              @click="refreshQr"
            >
              <RefreshCw :size="14" />
              刷新二维码
            </button>
          </div>
          <!-- Success overlay -->
          <div
            v-if="statusCode === 803"
            class="absolute inset-0 flex items-center justify-center bg-background/80 rounded-xl"
          >
            <span class="text-4xl">✓</span>
          </div>
        </template>
      </div>

      <!-- Status text -->
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

      <!-- Back -->
      <button
        class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        @click="router.back()"
      >
        返回
      </button>
    </div>
  </div>
</template>
