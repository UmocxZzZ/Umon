<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { usePlayerStore } from '@/stores/player'
import { useSongNavigate } from '@/lib/navigate'
import ArtistLinks from '@/components/ArtistLinks.vue'
import { formatTime } from '@/lib/utils'

const player = usePlayerStore()
const { goAlbum } = useSongNavigate()
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition-transform duration-300 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="player.showPlaylistDrawer"
      class="fixed right-0 top-14 bottom-20 w-80 bg-card border-l border-border
             z-30 flex flex-col shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="text-sm font-semibold">
          播放列表 ({{ player.playlist.length }})
        </span>
        <button
          class="p-1 rounded hover:bg-accent transition-colors"
          @click="player.togglePlaylistDrawer"
        >
          <X :size="16" />
        </button>
      </div>

      <!-- List -->
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="(song, i) in player.playlist"
          :key="song.id"
          class="flex items-center gap-3 px-4 py-2 hover:bg-accent cursor-pointer transition-colors"
          :class="{ 'bg-accent': i === player.currentIndex }"
          @click="player.setPlaylist(player.playlist, i); player.play()"
        >
          <div class="flex-1 min-w-0">
            <button
              class="text-sm truncate hover:text-primary transition-colors block max-w-full text-left"
              :class="i === player.currentIndex ? 'text-primary font-medium' : ''"
              @click.stop="goAlbum(song.albumId)"
            >
              {{ song.name }}
            </button>
            <ArtistLinks
              :artists="song.artists"
              :artist="song.artist"
              class="text-xs text-muted-foreground truncate block max-w-full text-left"
            />
          </div>
          <span class="text-xs text-muted-foreground shrink-0">
            {{ formatTime(song.duration) }}
          </span>
        </div>
        <div
          v-if="player.playlist.length === 0"
          class="py-12 text-center text-sm text-muted-foreground"
        >
          暂无播放歌曲
        </div>
      </div>
    </div>
  </Transition>
</template>
