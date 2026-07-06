<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useDrag } from '@/composables/useDrag'
import { formatTime } from '@/lib/utils'

const player = usePlayerStore()
const containerRef = ref<HTMLElement | null>(null)
const isHovering = ref(false)
const hoverRatio = ref(0)
const tooltipRef = ref<HTMLElement | null>(null)

// Drag state
const isDragging = ref(false)
const dragRatio = ref(0)

const displayProgress = computed(() =>
  isDragging.value ? dragRatio.value : player.progress,
)

const tooltipText = computed(() => {
  const ratio = isDragging.value ? dragRatio.value : hoverRatio.value
  const time = ratio * player.duration
  return formatTime(time)
})

const tooltipLeft = computed(() => {
  const ratio = isDragging.value ? dragRatio.value : hoverRatio.value
  return `${ratio * 100}%`
})

// Buffer progress
const bufferProgress = ref(0)
watch(() => player.audio, (audio) => {
  audio.addEventListener('progress', () => {
    if (audio.buffered.length > 0) {
      bufferProgress.value = audio.buffered.end(audio.buffered.length - 1) / audio.duration
    }
  })
}, { immediate: true })

// Drag handling
const { bindEvents } = useDrag(containerRef, {
  onDragStart(ratio) {
    isDragging.value = true
    dragRatio.value = ratio
  },
  onDragMove(ratio) {
    dragRatio.value = ratio
  },
  onDragEnd(ratio) {
    player.seek(ratio)
    isDragging.value = false
  },
  onHover(ratio) {
    if (ratio !== null) {
      isHovering.value = true
      hoverRatio.value = ratio
    } else {
      isHovering.value = false
    }
  },
})

onMounted(() => {
  if (containerRef.value) {
    bindEvents(containerRef.value)
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="group relative h-5 cursor-pointer select-none"
  >
    <!-- Track background (visible) - positioned at top -->
    <div
      class="absolute top-0 left-0 right-0 h-1 rounded-full bg-muted transition-all duration-150 group-hover:h-1.5"
      :class="{ 'h-1.5': isDragging }"
    />

    <!-- Buffer progress -->
    <div
      class="absolute top-0 left-0 h-1 rounded-full bg-muted-foreground/20 transition-all duration-150 group-hover:h-1.5"
      :class="{ 'h-1.5': isDragging }"
      :style="{ width: `${bufferProgress * 100}%` }"
    />

    <!-- Played progress -->
    <div
      class="absolute top-0 left-0 h-1 rounded-full bg-primary transition-all duration-150 group-hover:h-1.5"
      :class="{ 'h-1.5': isDragging }"
      :style="{ width: `${displayProgress * 100}%` }"
    />

    <!-- Thumb -->
    <div
      class="absolute top-0 left-0 w-3 h-3 rounded-full bg-primary
             shadow-sm transition-all duration-150 -translate-y-1/4
             opacity-0 group-hover:opacity-100 group-hover:scale-110"
      :class="{ 'opacity-100 scale-110': isDragging }"
      :style="{ left: `calc(${displayProgress * 100}% - 6px)` }"
    />

    <!-- Tooltip -->
    <Transition
      enter-active-class="transition-opacity duration-100"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isHovering || isDragging"
        ref="tooltipRef"
        class="absolute -top-8 px-2 py-1 text-xs bg-foreground text-background
               rounded shadow-sm pointer-events-none whitespace-nowrap"
        :style="{ left: tooltipLeft, transform: 'translateX(-50%)' }"
      >
        {{ tooltipText }}
      </div>
    </Transition>
  </div>
</template>
