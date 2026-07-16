const NETEASE_IMAGE_HOST_SUFFIX = '.music.126.net'

function isNeteaseImageHost(hostname: string): boolean {
  return hostname === 'music.126.net' || hostname.endsWith(NETEASE_IMAGE_HOST_SUFFIX)
}

/**
 * Ask the NetEase image CDN for a bounded square thumbnail. Unknown/local
 * sources are returned unchanged so downloaded covers and app assets continue
 * to work.
 */
export function getImageThumbnailUrl(source: string, targetPixels: number): string {
  if (!source || !Number.isFinite(targetPixels) || targetPixels <= 0) return source

  try {
    const url = new URL(source, window.location.href)
    if (!isNeteaseImageHost(url.hostname)) return source

    const size = Math.max(1, Math.ceil(targetPixels))
    url.protocol = 'https:'
    url.searchParams.set('param', `${size}y${size}`)
    return url.toString()
  } catch {
    return source
  }
}

export function getDisplayThumbnailUrl(source: string, cssPixels: number): string {
  const pixelRatio = typeof window === 'undefined'
    ? 2
    : Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  return getImageThumbnailUrl(source, cssPixels * pixelRatio)
}
