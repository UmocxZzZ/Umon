import api from './axios'
import type {
  AudioQuality,
  Album,
  Song,
  Playlist,
  LyricLine,
  Comment,
  RawTrack,
  RawPlaylistDetail,
} from '@/types'
import { DEFAULT_AUDIO_QUALITY } from '@/lib/audioQuality'
import type { UserProfile } from '@/stores/auth'

export function transformTrack(track: RawTrack): Song {
  return {
    id: track.id,
    name: track.name,
    artist: track.ar.map((a) => a.name).join(' / '),
    artistId: track.ar[0]?.id ?? 0,
    artists: track.ar.map((a) => ({ id: a.id, name: a.name })),
    album: track.al.name,
    albumId: track.al.id,
    cover: track.al.picUrl,
    duration: Math.round(track.dt / 1000),
  }
}

export async function getPersonalized(limit = 8): Promise<Playlist[]> {
  const res = (await api.get('/personalized')) as { result?: Record<string, unknown>[] }
  return (res.result ?? []).slice(0, limit).map((item) => ({
    id: item.id as number,
    name: item.name as string,
    cover: item.picUrl as string,
    trackCount: item.trackCount as number,
    playCount: item.playCount as number,
  }))
}

export async function getNewSongs(): Promise<Song[]> {
  const res = (await api.get('/personalized/newsong')) as { result: Record<string, unknown>[] }
  return res.result.map((item) => {
    const song = item.song as Record<string, unknown>
    const artists = song.artists as { id: number; name: string }[]
    const album = song.album as { id: number; name: string; picUrl: string }
    return {
      id: song.id as number,
      name: song.name as string,
      artist: artists.map((a) => a.name).join(' / '),
      artistId: artists[0]?.id ?? 0,
      artists: artists.map((a) => ({ id: a.id, name: a.name })),
      album: album.name,
      albumId: album.id,
      cover: album.picUrl,
      duration: Math.round((song.duration as number) / 1000),
    }
  })
}

export async function getTopPlaylists(limit = 8): Promise<Playlist[]> {
  const res = (await api.get('/top/playlist', { params: { limit } })) as {
    playlists: Record<string, unknown>[]
  }
  return res.playlists.map((pl) => ({
    id: pl.id as number,
    name: pl.name as string,
    cover: pl.coverImgUrl as string,
    trackCount: pl.trackCount as number,
    playCount: pl.playCount as number,
    creator: (pl.creator as Record<string, unknown>)?.nickname as string,
    description: pl.description as string,
    tags: pl.tags as string[],
  }))
}

export async function getPlaylistDetail(id: number): Promise<{
  playlist: Playlist
  tracks: Song[]
}> {
  const res = (await api.get('/playlist/detail', { params: { id } })) as RawPlaylistDetail
  const pl = res.playlist
  return {
    playlist: {
      id: pl.id,
      name: pl.name,
      cover: pl.coverImgUrl,
      trackCount: pl.trackCount,
      playCount: pl.playCount,
      creator: pl.creator.nickname,
      description: pl.description,
      tags: pl.tags,
    },
    tracks: pl.tracks.map(transformTrack),
  }
}

export interface SongUrlInfo {
  url: string | null
  type: string | null
  level: string | null
}

export async function getSongUrlInfo(
  id: number,
  quality: AudioQuality = DEFAULT_AUDIO_QUALITY,
): Promise<SongUrlInfo> {
  const res = (await api.get('/song/url/v1', {
    params: { id, level: quality },
  })) as { data: { url?: string | null; type?: string | null; level?: string | null }[] }
  const data = res.data[0]
  return {
    url: data?.url ?? null,
    type: data?.type ?? null,
    level: data?.level ?? null,
  }
}

export async function getSongUrl(
  id: number,
  quality: AudioQuality = DEFAULT_AUDIO_QUALITY,
): Promise<string | null> {
  return (await getSongUrlInfo(id, quality)).url
}

export async function getLyric(id: number): Promise<LyricLine[]> {
  const res = (await api.get('/lyric', { params: { id } })) as {
    lrc?: { lyric?: string }
    tlyric?: { lyric?: string }
  }
  const lrcText = res.lrc?.lyric ?? ''
  return parseLrc(lrcText)
}

function parseLrc(text: string): LyricLine[] {
  const lines = text.split('\n')
  const result: LyricLine[] = []
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/
  for (const line of lines) {
    const match = timeReg.exec(line)
    if (!match) continue
    const m = Number(match[1])
    const s = Number(match[2])
    const ms = Number(match[3].padEnd(3, '0'))
    const time = m * 60 + s + ms / 1000
    const textContent = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/, '').trim()
    if (textContent) {
      result.push({ time, text: textContent })
    }
  }
  return result
}

export async function getHotComments(id: number): Promise<Comment[]> {
  const res = (await api.get('/comment/hot', { params: { id, type: 0 } })) as {
    hotComments: Record<string, unknown>[]
  }
  return (res.hotComments ?? []).map((c) => {
    const user = c.user as Record<string, unknown>
    return {
      id: c.commentId as number,
      user: user.nickname as string,
      avatar: user.avatarUrl as string,
      content: c.content as string,
      likedCount: c.likedCount as number,
      time: formatTimestamp(c.time as number),
    }
  })
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function getSearchDefault(): Promise<string> {
  try {
    const res = (await api.get('/search/default')) as { data: { realkeyword: string } }
    return res.data?.realkeyword || ''
  } catch {
    return ''
  }
}

export async function searchSongs(keywords: string, limit = 30): Promise<Song[]> {
  const res = (await api.get('/cloudsearch', { params: { keywords, limit } })) as {
    result: { songs: RawTrack[] }
  }
  return res.result.songs.map(transformTrack)
}

export interface SearchResult {
  id: number
  name: string
  cover: string
  artist?: string
  description?: string
  trackCount?: number
  playCount?: number
}

export async function searchArtists(keywords: string, limit = 30): Promise<SearchResult[]> {
  const res = (await api.get('/cloudsearch', { params: { keywords, limit, type: 100 } })) as {
    result: { artists: Record<string, unknown>[] }
  }
  return (res.result.artists ?? []).map((a) => ({
    id: a.id as number,
    name: a.name as string,
    cover: (a.picUrl as string) ?? '',
    artist: (a.alias as string[])?.[0] ?? '',
  }))
}

export async function searchAlbums(keywords: string, limit = 30): Promise<SearchResult[]> {
  const res = (await api.get('/cloudsearch', { params: { keywords, limit, type: 10 } })) as {
    result: { albums: Record<string, unknown>[] }
  }
  return (res.result.albums ?? []).map((a) => {
    const artist = a.artist as Record<string, unknown> | undefined
    return {
      id: a.id as number,
      name: a.name as string,
      cover: (a.picUrl as string) ?? '',
      artist: artist?.name as string ?? '',
    }
  })
}

export async function searchPlaylists(keywords: string, limit = 30): Promise<SearchResult[]> {
  const res = (await api.get('/cloudsearch', { params: { keywords, limit, type: 1000 } })) as {
    result: { playlists: Record<string, unknown>[] }
  }
  return (res.result.playlists ?? []).map((p) => ({
    id: p.id as number,
    name: p.name as string,
    cover: (p.coverImgUrl as string) ?? '',
    trackCount: p.trackCount as number,
    playCount: p.playCount as number,
  }))
}

export async function getArtistDetail(id: number): Promise<{ name: string; cover: string; songs: Song[] }> {
  const res = (await api.get('/artists', { params: { id } })) as {
    artist: { name: string; picUrl: string }
    hotSongs: RawTrack[]
  }
  return {
    name: res.artist.name,
    cover: res.artist.picUrl,
    songs: res.hotSongs.map(transformTrack),
  }
}

export interface ArtistAlbumPage {
  albums: Album[]
  more: boolean
}

export async function getArtistAlbums(
  id: number,
  limit = 24,
  offset = 0,
): Promise<ArtistAlbumPage> {
  const res = (await api.get('/artist/album', {
    params: { id, limit, offset },
  })) as {
    hotAlbums?: Array<{
      id: number
      name: string
      picUrl?: string
      publishTime?: number
      artist?: { name?: string }
    }>
    more?: boolean
  }
  const hotAlbums = res.hotAlbums ?? []

  return {
    albums: hotAlbums.map((album) => ({
      id: album.id,
      name: album.name,
      artist: album.artist?.name ?? '',
      cover: album.picUrl ?? '',
      publishTime: album.publishTime,
    })),
    more: typeof res.more === 'boolean' ? res.more : hotAlbums.length === limit,
  }
}

export async function getAllArtistAlbums(id: number, batchSize = 50): Promise<Album[]> {
  const albums: Album[] = []
  const albumIds = new Set<number>()
  let offset = 0

  // The endpoint is paged, but the UI intentionally exposes a complete list
  // like the hot-song list. Stop on an empty/duplicate page as protection for
  // older API implementations that ignore offset.
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const page = await getArtistAlbums(id, batchSize, offset)
    const newAlbums = page.albums.filter((album) => !albumIds.has(album.id))
    for (const album of newAlbums) {
      albumIds.add(album.id)
      albums.push(album)
    }

    if (!page.more || page.albums.length === 0 || newAlbums.length === 0) break
    offset += page.albums.length
  }

  return albums
}

export async function getAlbumDetail(id: number): Promise<{ name: string; artist: string; cover: string; songs: Song[] }> {
  const res = (await api.get('/album', { params: { id } })) as {
    album: { name: string; picUrl: string; artist: { name: string } }
    songs: RawTrack[]
  }
  return {
    name: res.album.name,
    artist: res.album.artist.name,
    cover: res.album.picUrl,
    songs: res.songs.map(transformTrack),
  }
}

// Login APIs
export async function getQrKey(): Promise<string> {
  const res = (await api.get('/login/qr/key', {
    params: { timestamp: Date.now() },
  })) as { data: { unikey: string } }
  return res.data.unikey
}

export async function createQrCode(key: string): Promise<string> {
  const res = (await api.get('/login/qr/create', {
    params: { key, qrimg: true, timestamp: Date.now() },
  })) as { data: { qrimg: string } }
  return res.data.qrimg
}

export interface QrCheckResult {
  code: number
  message: string
  cookie?: string
}

export async function checkQrStatus(key: string): Promise<QrCheckResult> {
  return (await api.get('/login/qr/check', {
    params: { key, timestamp: Date.now() },
  })) as QrCheckResult
}

export async function getUserAccount(): Promise<UserProfile | null> {
  try {
    const res = (await api.get('/user/account', {
      params: { timestamp: Date.now() },
    })) as {
      account: { vipType: number } | null
      profile: { userId: number; nickname: string; avatarUrl: string } | null
    }
    if (!res.profile) return null
    return {
      userId: res.profile.userId,
      nickname: res.profile.nickname,
      avatarUrl: res.profile.avatarUrl,
      vipType: res.account?.vipType ?? 0,
    }
  } catch (e) {
    console.error('[API] getUserAccount failed:', e)
    return null
  }
}

export async function likeSong(id: number, like: boolean): Promise<boolean> {
  const res = (await api.get('/like', {
    params: { id, like, timestamp: Date.now() },
  })) as { code: number }
  return res.code === 200
}

export async function getLikedSongIds(uid: number): Promise<Set<number>> {
  const playlists = await getUserPlaylists(uid)
  const liked = playlists.find((p) => p.specialType === 5)
  if (!liked) return new Set()
  // Use paginated API to avoid timeout on large playlists
  const ids: number[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const res = (await api.get('/playlist/track/all', {
      params: { id: liked.id, limit, offset, timestamp: Date.now() },
    })) as { songs: { id: number }[] }
    for (const s of res.songs) ids.push(s.id)
    if (res.songs.length < limit) break
    offset += limit
  }
  return new Set(ids)
}

export async function getPlaylistTracks(
  id: number,
  offset = 0,
  limit = 300,
): Promise<{ songs: Song[]; hasMore: boolean }> {
  const res = (await api.get('/playlist/track/all', {
    params: { id, limit, offset, timestamp: Date.now() },
  })) as { songs?: RawTrack[] }
  const songs = res.songs ?? []
  return {
    songs: songs.map(transformTrack),
    hasMore: songs.length === limit,
  }
}

export async function getUserPlaylists(uid: number): Promise<Playlist[]> {
  const res = (await api.get('/user/playlist', {
    params: { uid, timestamp: Date.now() },
  })) as { playlist?: Record<string, unknown>[] }
  return (res.playlist ?? []).map((pl) => {
    const creator = pl.creator as Record<string, unknown> | undefined
    return {
      id: pl.id as number,
      name: pl.name as string,
      cover: pl.coverImgUrl as string,
      trackCount: pl.trackCount as number,
      playCount: pl.playCount as number,
      creator: creator?.nickname as string,
      creatorId: creator?.userId as number,
      subscribed: pl.subscribed as boolean,
      specialType: pl.specialType as number,
      description: pl.description as string,
    }
  })
}
