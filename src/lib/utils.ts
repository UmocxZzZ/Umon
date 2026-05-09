export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function getSongUrl(id: number): string {
  return `/api/song/url/v1?id=${id}&level=exhigh`
}

export function getCoverUrl(id: number): string {
  return `https://p1.music.126.net/${id}/${id}.jpg`
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.require
}
