export interface AudioSpectrumSnapshot {
  bins: Uint8Array
  sampleRate: number
}

interface AudioGraph {
  context: AudioContext
  analyser: AnalyserNode
  output: GainNode
}

let graph: AudioGraph | null = null
let spectrumBuffer = new Uint8Array(0)
let outputVolume = 0.7

const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

function createAudioContext(): AudioContext {
  const AudioContextClass = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new AudioContextClass({ latencyHint: 'playback' })
}

function ensureGraph(): AudioGraph {
  if (graph) return graph

  const context = createAudioContext()
  const analyser = context.createAnalyser()
  const output = context.createGain()

  analyser.fftSize = 2048
  analyser.minDecibels = -90
  analyser.maxDecibels = -10
  analyser.smoothingTimeConstant = 0.72

  output.gain.value = outputVolume
  analyser.connect(output)
  output.connect(context.destination)

  graph = { context, analyser, output }
  spectrumBuffer = new Uint8Array(analyser.frequencyBinCount)
  return graph
}

/**
 * Routes an HTML media element through the shared analysis/output graph.
 * Each media element can only be wrapped by createMediaElementSource once.
 */
export function attachMediaElement(element: HTMLMediaElement): void {
  if (mediaSources.has(element)) return

  const { context, analyser } = ensureGraph()
  const source = context.createMediaElementSource(element)
  source.connect(analyser)
  mediaSources.set(element, source)

  // Volume is owned by the graph so every playback source has identical output.
  element.volume = 1

  // Browsers may suspend an AudioContext while a tab or output device changes.
  // Re-arm it whenever the media element actually starts producing samples.
  const resumeWithPlayback = () => { void resumeAudioEngine() }
  element.addEventListener('play', resumeWithPlayback)
  element.addEventListener('playing', resumeWithPlayback)
}

/** Connects short-lived sources such as AudioBufferSourceNode to the same graph. */
export function connectAudioSource(source: AudioNode): void {
  source.connect(ensureGraph().analyser)
}

export function getPlaybackContext(): AudioContext {
  return ensureGraph().context
}

export async function resumeAudioEngine(): Promise<void> {
  const { context } = ensureGraph()
  if (context.state !== 'running' && context.state !== 'closed') {
    await context.resume()
  }
}

export async function suspendAudioEngine(): Promise<void> {
  const { context } = ensureGraph()
  if (context.state === 'running') {
    await context.suspend()
  }
}

export function setAudioOutputVolume(value: number, immediate = false): void {
  outputVolume = Math.max(0, Math.min(1, value))
  if (!graph) return

  const now = graph.context.currentTime
  graph.output.gain.cancelScheduledValues(now)
  if (immediate) {
    graph.output.gain.setValueAtTime(outputVolume, now)
  } else {
    graph.output.gain.setTargetAtTime(outputVolume, now, 0.015)
  }
}

/**
 * Reads the analyser owned by the player. The returned buffer is reused between
 * frames and must be consumed synchronously by callers.
 */
export function readAudioSpectrum(): AudioSpectrumSnapshot | null {
  if (!graph || graph.context.state !== 'running') return null

  if (spectrumBuffer.length !== graph.analyser.frequencyBinCount) {
    spectrumBuffer = new Uint8Array(graph.analyser.frequencyBinCount)
  }
  graph.analyser.getByteFrequencyData(spectrumBuffer)

  return {
    bins: spectrumBuffer,
    sampleRate: graph.context.sampleRate,
  }
}
