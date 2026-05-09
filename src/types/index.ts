export interface SongArtist {
  id: number
  name: string
}

export interface Song {
  id: number
  name: string
  artist: string
  artistId: number
  artists: SongArtist[]
  album: string
  albumId: number
  cover: string
  duration: number
  url?: string
}

export interface Playlist {
  id: number
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator?: string
  creatorId?: number
  subscribed?: boolean
  specialType?: number
  description?: string
  tags?: string[]
}

export interface Artist {
  id: number
  name: string
  avatar: string
}

export interface Album {
  id: number
  name: string
  artist: string
  cover: string
}

export interface LyricLine {
  time: number
  text: string
}

export interface Comment {
  id: number
  user: string
  avatar: string
  content: string
  likedCount: number
  time: string
}

export type PlayMode = 'single' | 'list' | 'shuffle'

export type ThemeMode = 'light' | 'dark'

// Raw API types
export interface RawTrack {
  id: number
  name: string
  ar: { id: number; name: string }[]
  al: { id: number; name: string; picUrl: string }
  dt: number
  [key: string]: unknown
}

export interface RawPlaylistDetail {
  playlist: {
    id: number
    name: string
    coverImgUrl: string
    trackCount: number
    playCount: number
    creator: { nickname: string }
    description: string
    tags: string[]
    tracks: RawTrack[]
  }
}
