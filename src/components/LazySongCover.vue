<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getDisplayThumbnailUrl } from '@/lib/image'
import { observeViewportVisibility } from '@/lib/viewportObserver'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  size?: number
}>(), {
  src: '',
  alt: '',
  size: 32,
})

const hostRef = ref<HTMLElement | null>(null)
const isNearViewport = ref(false)
let stopObserving: (() => void) | null = null

const thumbnailUrl = computed(() => (
  props.src ? getDisplayThumbnailUrl(props.src, props.size) : ''
))

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

onMounted(() => {
  if (!hostRef.value) return
  stopObserving = observeViewportVisibility(hostRef.value, (visible) => {
    isNearViewport.value = visible
  })
})

onUnmounted(() => {
  stopObserving?.()
  stopObserving = null
})
</script>

<template>
  <span
    ref="hostRef"
    class="block shrink-0 overflow-hidden rounded bg-muted"
    :style="sizeStyle"
    aria-hidden="true"
  >
    <img
      v-if="isNearViewport && thumbnailUrl"
      :src="thumbnailUrl"
      :alt="alt"
      :width="size"
      :height="size"
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
    />
  </span>
</template>
