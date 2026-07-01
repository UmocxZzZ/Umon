<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef } from 'vue'
import * as THREE from 'three'
import { createMapShaderMaterial, type RippleData } from './shaderMaterial'
import { useAudioVisualizer } from '@/composables/useAudioVisualizer'
import { usePlayerStore } from '@/stores/player'

const props = defineProps<{
  active: boolean
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const player = usePlayerStore()
const { init: initAudio, resume, getAudioData } = useAudioVisualizer()
let audioInited = false

// Three.js objects (shallowRef to avoid reactivity overhead)
const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
const scene = shallowRef<THREE.Scene | null>(null)
const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
const material = shallowRef<THREE.ShaderMaterial | null>(null)
const animFrameId = ref(0)

const GRID_SIZE = 120
const SPACING = 1.05
const COUNT = GRID_SIZE * GRID_SIZE

// Ripples
const ripples: RippleData[] = Array.from({ length: 10 }, () => ({
  pos: new THREE.Vector2(0, 0),
  time: -100,
  strength: 0,
  isActive: 0,
  rippleType: 0,
}))
let rippleIndex = 0

function addRipple(x: number, y: number, strength: number, isWhite = false) {
  const idx = rippleIndex
  ripples[idx] = {
    pos: new THREE.Vector2(x, y),
    time: performance.now() / 1000,
    strength,
    isActive: 1,
    rippleType: isWhite ? 1 : 0,
  }
  rippleIndex = (idx + 1) % 10
}

// Auto-trigger ripples based on audio energy
let lastRippleTime = 0

function getThemeBgColor(): number {
  // Read CSS variable --color-background from document
  const style = getComputedStyle(document.documentElement)
  const bg = style.getPropertyValue('--color-background').trim()
  // Parse hex color (e.g., "#0a0a0a" or "#ffffff")
  if (bg.startsWith('#')) {
    return parseInt(bg.slice(1), 16)
  }
  // Default dark background
  return 0x0a0a0a
}

function setupScene(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const width = rect.width || window.innerWidth
  const height = rect.height || window.innerHeight
  const bgColor = getThemeBgColor()

  // Renderer - opaque background
  const r = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
  })
  r.setSize(width, height)
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  r.setClearColor(bgColor, 1)
  renderer.value = r

  // Scene with background color
  const s = new THREE.Scene()
  s.background = new THREE.Color(bgColor)
  s.fog = new THREE.Fog(bgColor, 50, 200)
  scene.value = s

  // Camera
  const cam = new THREE.PerspectiveCamera(50, width / height, 0.1, 200)
  cam.position.set(30, 35, 40)
  cam.lookAt(0, 0, 0)
  camera.value = cam

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  s.add(ambient)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(10, 20, 10)
  s.add(dirLight)

  // Material
  const mat = createMapShaderMaterial()
  material.value = mat

  // Instanced mesh
  const geo = new THREE.BoxGeometry(0.9, 1, 0.9)
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT)

  const tempMatrix = new THREE.Matrix4()
  const offset = (GRID_SIZE * SPACING) / 2
  let i = 0
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const px = x * SPACING - offset
      const pz = z * SPACING - offset
      tempMatrix.makeTranslation(px, 0.5, pz)
      mesh.setMatrixAt(i, tempMatrix)
      i++
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  s.add(mesh)

  // Simple auto-rotate via camera orbit
  let angle = Math.atan2(cam.position.x, cam.position.z)
  const radius = Math.sqrt(cam.position.x ** 2 + cam.position.z ** 2)
  const autoRotateSpeed = 0.0003

  // Track current size to detect changes
  let currentWidth = 0
  let currentHeight = 0

  // Get the parent element for size reference
  const parentEl = canvas.parentElement

  // Animation loop
  function animate() {
    animFrameId.value = requestAnimationFrame(animate)

    // Check for size changes using parent element
    const w = parentEl?.clientWidth || window.innerWidth
    const h = parentEl?.clientHeight || window.innerHeight
    if (w > 0 && h > 0 && (w !== currentWidth || h !== currentHeight)) {
      currentWidth = w
      currentHeight = h
      r.setSize(w, h)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }

    const now = performance.now() / 1000
    mat.uniforms.uTime.value = now

    if (props.active) {
      resume()

      // Get audio data
      const data = getAudioData(player.isPlaying)

      mat.uniforms.uBass.value = data.bass
      mat.uniforms.uMid.value = data.mid
      mat.uniforms.uEnergy.value = data.energy
      mat.uniforms.uSubBass.value = data.subBass
      mat.uniforms.uLowMid.value = data.lowMid
      mat.uniforms.uHighMid.value = data.highMid
      mat.uniforms.uPresence.value = data.presence
      mat.uniforms.uBrilliance.value = data.brilliance
      mat.uniforms.uAir.value = data.air
      mat.uniforms.uWarmth.value = data.warmth
      mat.uniforms.uBrightness.value = data.brightness
      mat.uniforms.uSharpness.value = data.sharpness
      mat.uniforms.uSmoothness.value = data.smoothness
      mat.uniforms.uDensity.value = data.density
      mat.uniforms.uSpectralCentroid.value = data.spectralCentroid

      // Auto-trigger ripples on beats
      if (player.isPlaying && now - lastRippleTime > 0.4 && data.energy > 0.05) {
        const angle2 = Math.random() * Math.PI * 2
        const dist = Math.random() * 25
        addRipple(
          Math.cos(angle2) * dist,
          Math.sin(angle2) * dist,
          Math.min(data.energy * 5.0, 3.0),
        )
        lastRippleTime = now
      }

      // Update ripples
      mat.uniforms.uRipples.value = ripples
    }

    // Auto-rotate camera
    angle += autoRotateSpeed
    cam.position.x = Math.sin(angle) * radius
    cam.position.z = Math.cos(angle) * radius
    cam.lookAt(0, 0, 0)

    r.render(s, cam)
  }

  animate()
}

// Click to add ripple
function handleClick(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  // Project to ground plane approximately
  addRipple(x * 40, y * 40, 1.5)
}

// Re-initialize audio when song changes (called from switchAudio after activeAudio changes)
player.setOnAudioSwitch((newAudio) => {
  if (!audioInited) return
  // Wait for audio to have data before connecting visualizer
  const tryConnect = () => {
    if (newAudio.readyState >= 2) {
      initAudio(newAudio, true)
    } else {
      newAudio.addEventListener('canplay', () => initAudio(newAudio, true), { once: true })
    }
  }
  tryConnect()
})

onMounted(() => {
  if (canvasRef.value) {
    setupScene(canvasRef.value)

    // Initialize audio on mount (user already interacted to enter fullscreen)
    initAudio(player.audio)
    audioInited = true
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animFrameId.value)
  renderer.value?.dispose()
  material.value?.dispose()
})
</script>

<template>
  <canvas
    ref="canvasRef"
    style="display: block; width: 100%; height: 100%; position: absolute; top: 0; left: 0;"
    @click="handleClick"
  />
</template>
