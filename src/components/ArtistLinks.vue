<script setup lang="ts">
import { computed } from 'vue'
import { useSongNavigate } from '@/lib/navigate'
import type { SongArtist } from '@/types'

const props = defineProps<{
  artists?: SongArtist[]
  artist?: string
  class?: string
}>()

const { goArtist } = useSongNavigate()

const list = computed(() => {
  if (props.artists?.length) return props.artists
  // Fallback: parse artist string like "A / B / C"
  if (props.artist) {
    return props.artist.split(/\s*\/\s*/).map((name, i) => ({ id: i === 0 ? 0 : -1, name: name.trim() }))
  }
  return []
})
</script>

<template>
  <div :class="props.class">
    <template v-for="(a, i) in list" :key="a.id + '-' + i">
      <button
        class="hover:text-foreground transition-colors whitespace-nowrap"
        @click.stop="goArtist(a.id)"
      >
        {{ a.name }}
      </button>
      <span v-if="i < list.length - 1" class="text-muted-foreground"> / </span>
    </template>
  </div>
</template>
