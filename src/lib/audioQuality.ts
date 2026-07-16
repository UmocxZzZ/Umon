import type { AudioQuality } from '@/types'

export interface AudioQualityOption {
  value: AudioQuality
  label: string
  description: string
}

export const DEFAULT_AUDIO_QUALITY: AudioQuality = 'exhigh'

export const AUDIO_QUALITY_OPTIONS: readonly AudioQualityOption[] = [
  { value: 'standard', label: '标准', description: '128 kbps' },
  { value: 'higher', label: '较高', description: '192 kbps' },
  { value: 'exhigh', label: '极高', description: '320 kbps' },
  { value: 'lossless', label: '无损', description: 'FLAC' },
]

const AUDIO_QUALITY_VALUES = new Set<AudioQuality>(
  AUDIO_QUALITY_OPTIONS.map((option) => option.value),
)

export function normalizeAudioQuality(value: string | null | undefined): AudioQuality {
  return AUDIO_QUALITY_VALUES.has(value as AudioQuality)
    ? value as AudioQuality
    : DEFAULT_AUDIO_QUALITY
}
