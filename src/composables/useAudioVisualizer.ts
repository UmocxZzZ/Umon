import { readAudioSpectrum } from '@/lib/audioEngine'

export interface AudioData {
  bass: number
  mid: number
  treble: number
  energy: number
  subBass: number
  lowMid: number
  highMid: number
  presence: number
  brilliance: number
  air: number
  warmth: number
  brightness: number
  sharpness: number
  smoothness: number
  density: number
  spectralCentroid: number
}

const smoothedData: AudioData = {
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  subBass: 0,
  lowMid: 0,
  highMid: 0,
  presence: 0,
  brilliance: 0,
  air: 0,
  warmth: 0,
  brightness: 0,
  sharpness: 0,
  smoothness: 0,
  density: 0,
  spectralCentroid: 0,
}

let previousSpectrum = new Float32Array(0)
let normalizedSpectrum = new Float32Array(0)
let previousBrightness = 0

interface BandDefinition {
  key: 'subBass' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'presence' | 'brilliance' | 'air'
  minHz: number
  maxHz: number
}

const BANDS: BandDefinition[] = [
  { key: 'subBass', minHz: 20, maxHz: 60 },
  { key: 'bass', minHz: 60, maxHz: 250 },
  { key: 'lowMid', minHz: 250, maxHz: 500 },
  { key: 'mid', minHz: 500, maxHz: 2000 },
  { key: 'highMid', minHz: 2000, maxHz: 4000 },
  { key: 'presence', minHz: 4000, maxHz: 6000 },
  { key: 'brilliance', minHz: 6000, maxHz: 12000 },
  { key: 'air', minHz: 12000, maxHz: 24000 },
]

function smoothValue(current: number, target: number, attack: number, release: number): number {
  const factor = target > current ? attack : release
  return current + (target - current) * factor
}

function decayToIdle(): AudioData {
  const release = 0.1
  for (const key of Object.keys(smoothedData) as (keyof AudioData)[]) {
    const idleTarget = key === 'smoothness' ? 0.65 : 0
    smoothedData[key] = smoothValue(smoothedData[key], idleTarget, release, release)
  }
  previousBrightness = smoothValue(previousBrightness, 0, release, release)
  return { ...smoothedData }
}

function averageBand(
  spectrum: Float32Array,
  minHz: number,
  maxHz: number,
  sampleRate: number,
): number {
  const nyquist = sampleRate / 2
  const start = Math.max(0, Math.floor((minHz / nyquist) * spectrum.length))
  const end = Math.min(
    spectrum.length - 1,
    Math.max(start, Math.ceil((Math.min(maxHz, nyquist) / nyquist) * spectrum.length)),
  )

  let sum = 0
  for (let i = start; i <= end; i++) sum += spectrum[i]
  return sum / Math.max(1, end - start + 1)
}

export function useAudioVisualizer() {
  function getAudioData(isPlaying: boolean): AudioData {
    const snapshot = readAudioSpectrum()
    if (!isPlaying || !snapshot || snapshot.bins.length === 0) {
      return decayToIdle()
    }

    if (previousSpectrum.length !== snapshot.bins.length) {
      previousSpectrum = new Float32Array(snapshot.bins.length)
      normalizedSpectrum = new Float32Array(snapshot.bins.length)
    }

    let energySquared = 0
    let spectralWeight = 0
    let spectralMagnitude = 0
    let movement = 0

    for (let i = 0; i < snapshot.bins.length; i++) {
      const value = snapshot.bins[i] / 255
      normalizedSpectrum[i] = value
      energySquared += value * value
      spectralWeight += i * value
      spectralMagnitude += value
      movement += Math.abs(value - previousSpectrum[i])
      previousSpectrum[i] = value
    }

    const bands = {} as Record<BandDefinition['key'], number>
    for (const band of BANDS) {
      bands[band.key] = averageBand(
        normalizedSpectrum,
        band.minHz,
        band.maxHz,
        snapshot.sampleRate,
      )
    }

    const energy = Math.sqrt(energySquared / normalizedSpectrum.length)
    const lowEnergy = bands.subBass + bands.bass + bands.lowMid + bands.mid
    const highEnergy = bands.presence + bands.brilliance + bands.air
    const totalBandEnergy = lowEnergy + bands.highMid + highEnergy
    const warmth = totalBandEnergy > 0 ? lowEnergy / totalBandEnergy : 0
    const brightness = totalBandEnergy > 0 ? highEnergy / totalBandEnergy : 0
    const sharpness = Math.max(0, brightness - previousBrightness) * 5
    const smoothness = Math.max(0, 1 - (movement / normalizedSpectrum.length) * 4)
    const activeThreshold = Math.max(energy * 0.75, 0.035)
    const activeBands = BANDS.reduce(
      (count, band) => count + (bands[band.key] >= activeThreshold ? 1 : 0),
      0,
    )
    const density = activeBands / BANDS.length
    const spectralCentroid = spectralMagnitude > 0
      ? spectralWeight / spectralMagnitude / normalizedSpectrum.length
      : 0

    previousBrightness = brightness

    const targets: AudioData = {
      subBass: bands.subBass,
      bass: bands.bass,
      lowMid: bands.lowMid,
      mid: bands.mid,
      highMid: bands.highMid,
      presence: bands.presence,
      brilliance: bands.brilliance,
      air: bands.air,
      treble: (bands.brilliance + bands.air) / 2,
      energy,
      warmth,
      brightness,
      sharpness,
      smoothness,
      density,
      spectralCentroid,
    }

    for (const key of Object.keys(targets) as (keyof AudioData)[]) {
      smoothedData[key] = smoothValue(smoothedData[key], targets[key], 0.38, 0.16)
    }

    return { ...smoothedData }
  }

  return { getAudioData }
}
