import { useRouter } from 'vue-router'
import { getArtistDetail } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import { usePlayerStore } from '@/stores/player'

export function useSongNavigate() {
  const router = useRouter()
  const { showToast } = useToast()
  const player = usePlayerStore()

  function closeFullScreen() {
    if (player.showFullScreen) player.showFullScreen = false
  }

  async function goArtist(artistId: number) {
    if (!artistId) {
      showToast('该歌手还没有个人主页！')
      return
    }
    closeFullScreen()
    try {
      await getArtistDetail(artistId)
      router.push(`/artist/${artistId}`)
    } catch {
      showToast('该歌手还没有个人主页！')
    }
  }

  function goAlbum(albumId: number) {
    if (!albumId) return
    closeFullScreen()
    router.push(`/album/${albumId}`)
  }

  return { goArtist, goAlbum }
}
