<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useDrag } from '@/composables/useDrag'

const player = usePlayerStore()
const containerRef = ref<HTMLElement | null>(null)

// Drag state
const isDragging = ref(false)
const dragRatio = ref(0)

const displayVolume = computed(() =>
  isDragging.value ? dragRatio.value : player.volume,
)

const volumePercent = computed(() =>
  Math.round((isDragging.value ? dragRatio.value : player.volume) * 100),
)

// Drag handling
const { bindEvents } = useDrag(containerRef, {
  onDragStart(ratio) {
    isDragging.value = true
    dragRatio.value = ratio
    player.setVolume(ratio)
  },
  onDragMove(ratio) {
    dragRatio.value = ratio
    player.setVolume(ratio)
  },
  onDragEnd(ratio) {
    player.setVolume(ratio)
    isDragging.value = false
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
    class="group relative h-4 flex items-center cursor-pointer select-none w-20"
  >
    <!-- Track background -->
    <div class="absolute left-0 right-0 h-1 rounded-full bg-muted" />

    <!-- Volume fill -->
    <div
      class="absolute left-0 h-1 rounded-full bg-primary"
      :style="{ width: `${displayVolume * 100}%` }"
    />

    <!-- Thumb -->
    <div
      class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary
             shadow-sm transition-opacity duration-150
             opacity-0 group-hover:opacity-100"
      :class="{ 'opacity-100': isDragging }"
      :style="{ left: `calc(${displayVolume * 100}% - 5px)` }"
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
        v-if="isDragging"
        class="absolute -top-7 px-2 py-0.5 text-xs bg-foreground text-background
               rounded shadow-sm pointer-events-none whitespace-nowrap"
        :style="{ left: `${displayVolume * 100}%`, transform: 'translateX(-50%)' }"
      >
        {{ volumePercent }}%
      </div>
    </Transition>
  </div>
</template>
