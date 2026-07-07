import { ref, onUnmounted } from 'vue'

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

// Module-level singletons
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let streamSource: MediaStreamAudioSourceNode | null = null
let connectedElement: HTMLAudioElement | null = null
let dataArray: Uint8Array = new Uint8Array(0)
let refCount = 0

const smoothedData: AudioData = {
  bass: 0, mid: 0, treble: 0, energy: 0,
  subBass: 0, lowMid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
  warmth: 0, brightness: 0, sharpness: 0, smoothness: 0, density: 0, spectralCentroid: 0,
}

let prevData: number[] = new Array(512).fill(0)
let prevBrightness = 0

export function useAudioVisualizer() {
  const isInitialized = ref(false)
  refCount++

  function init(audioElement: HTMLAudioElement, force = false) {
    if (!force && audioCtx && connectedElement === audioElement && streamSource && analyser) {
      if (audioCtx.state === 'suspended') audioCtx.resume()
      isInitialized.value = true
      return
    }

    // Cleanup previous stream source
    if (streamSource) {
      try { streamSource.disconnect() } catch { /* ignore */ }
      streamSource = null
    }

    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new AC()
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }

    if (!analyser) {
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.8
    }

    // captureStream: doesn't take over audio output, works with cross-origin via proxy
    try {
      // Check if audio has data before calling captureStream
      if (audioElement.readyState < 2) {
        // Audio not ready yet - will be retried by caller
        connectedElement = audioElement
        dataArray = new Uint8Array(analyser?.frequencyBinCount ?? 512)
        isInitialized.value = false
        return
      }

      const stream = (audioElement as HTMLAudioElement & { captureStream(): MediaStream }).captureStream()
      const audioTracks = stream.getAudioTracks()

      if (audioTracks.length === 0) {
        // No audio tracks - stream is not ready
        connectedElement = audioElement
        dataArray = new Uint8Array(analyser?.frequencyBinCount ?? 512)
        isInitialized.value = false
        return
      }

      streamSource = audioCtx.createMediaStreamSource(stream)
      streamSource.connect(analyser)
      connectedElement = audioElement
      dataArray = new Uint8Array(analyser.frequencyBinCount)
      isInitialized.value = true
    } catch (e) {
      console.warn('[AudioViz] captureStream failed:', e)
      connectedElement = audioElement
      dataArray = new Uint8Array(analyser?.frequencyBinCount ?? 512)
      isInitialized.value = false
    }
  }

  function resume() {
    if (audioCtx?.state === 'suspended') {
      audioCtx.resume()
    }
  }

  function getAudioData(_isPlaying: boolean): AudioData {
    if (!analyser) return { ...smoothedData }

    let energySum = 0
    let centroidNum = 0
    let centroidDen = 0
    let subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0
    let highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0
    let jumpVolatilitySum = 0

    const binCount = dataArray.length

    if (analyser && binCount > 0) {
      analyser.getByteFrequencyData(dataArray)
      for (let i = 0; i < binCount; i++) {
        const val = dataArray[i] / 255.0
        energySum += val
        centroidNum += i * val
        centroidDen += val
        const prevVal = prevData[i] || 0
        jumpVolatilitySum += Math.abs(val - prevVal)
        prevData[i] = val
        if (i <= 1) subBassSum += val
        else if (i <= 3) bassSum += val
        else if (i <= 7) lowMidSum += val
        else if (i <= 18) midSum += val
        else if (i <= 46) highMidSum += val
        else if (i <= 93) presenceSum += val
        else if (i <= 186) brillianceSum += val
        else if (i <= 372) airSum += val
      }
    }

    const energy = energySum / (binCount || 1)
    const subBass = subBassSum / 2
    const bass = bassSum / 2
    const lowMid = lowMidSum / 4
    const mid = midSum / 11
    const highMid = highMidSum / 28
    const presence = presenceSum / 47
    const brilliance = brillianceSum / 93
    const air = airSum / 186
    const warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0
    const brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0
    const sharpness = Math.max(0, brightness - prevBrightness) * 10
    prevBrightness = brightness
    const smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / (binCount || 1)) * 2.0)
    const activeThreshold = energy * 1.5
    let activeBands = 0
    if (subBass > activeThreshold) activeBands++
    if (bass > activeThreshold) activeBands++
    if (lowMid > activeThreshold) activeBands++
    if (mid > activeThreshold) activeBands++
    if (highMid > activeThreshold) activeBands++
    if (presence > activeThreshold) activeBands++
    if (brilliance > activeThreshold) activeBands++
    if (air > activeThreshold) activeBands++
    const density = activeBands / 8
    const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0
    const dt = 0.3

    smoothedData.bass += (bass - smoothedData.bass) * dt
    smoothedData.mid += (mid - smoothedData.mid) * dt
    smoothedData.treble += ((brilliance + air) / 2 - smoothedData.treble) * dt
    smoothedData.energy += (energy - smoothedData.energy) * dt
    smoothedData.subBass += (subBass - smoothedData.subBass) * dt
    smoothedData.lowMid += (lowMid - smoothedData.lowMid) * dt
    smoothedData.highMid += (highMid - smoothedData.highMid) * dt
    smoothedData.presence += (presence - smoothedData.presence) * dt
    smoothedData.brilliance += (brilliance - smoothedData.brilliance) * dt
    smoothedData.air += (air - smoothedData.air) * dt
    smoothedData.warmth += (warmth - smoothedData.warmth) * dt
    smoothedData.brightness += (brightness - smoothedData.brightness) * dt
    smoothedData.sharpness += (sharpness - smoothedData.sharpness) * dt
    smoothedData.smoothness += (smoothnessVal - smoothedData.smoothness) * dt
    smoothedData.density += (density - smoothedData.density) * dt
    smoothedData.spectralCentroid += (spectralCentroid - smoothedData.spectralCentroid) * dt

    return { ...smoothedData }
  }

  function dispose() {
    refCount--
    if (refCount <= 0) {
      if (streamSource) { try { streamSource.disconnect() } catch { /* */ } streamSource = null }
      if (analyser) { try { analyser.disconnect() } catch { /* */ } analyser = null }
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
      connectedElement = null
      refCount = 0
    }
    isInitialized.value = false
  }

  onUnmounted(() => dispose())

  return { init, resume, getAudioData, dispose, isInitialized }
}
