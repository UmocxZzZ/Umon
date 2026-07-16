<script setup lang="ts">
import { onMounted, watch } from 'vue'
import TopBar from '@/components/layout/TopBar.vue'
import SideBar from '@/components/layout/SideBar.vue'
import BottomPlayer from '@/components/layout/BottomPlayer.vue'
import FullScreenPlayer from '@/components/layout/FullScreenPlayer.vue'
import PlaylistDrawer from '@/components/layout/PlaylistDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { useLikesStore } from '@/stores/likes'
import { useToast } from '@/composables/useToast'
import { useMediaSession } from '@/composables/useMediaSession'

const auth = useAuthStore()
const likes = useLikesStore()
const toast = useToast()

useMediaSession()

onMounted(async () => {
  // Restore and verify only after the environment-specific session is ready.
  try {
    await auth.restoreSession()
  } catch (e) {
    console.error('[Auth] session restore failed:', e)
  }
})

watch(() => auth.isLoggedIn, (loggedIn) => {
  if (loggedIn) likes.loadLikes()
  else likes.likedIds.clear()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-background text-foreground overflow-hidden">
    <!-- TopBar -->
    <TopBar />

    <!-- Body: Sidebar + Main -->
    <div class="flex-1 flex overflow-hidden">
      <SideBar />

      <!-- Main Content -->
      <main class="flex-1 overflow-y-auto">
        <router-view />
      </main>
    </div>

    <!-- Bottom Player -->
    <BottomPlayer />

    <!-- Overlays -->
    <FullScreenPlayer />
    <PlaylistDrawer />

    <!-- Toast -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div
        v-if="toast.message.value"
        class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100]
               px-4 py-2 bg-foreground text-background text-sm rounded-lg shadow-lg
               pointer-events-none select-none"
      >
        {{ toast.message.value }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
