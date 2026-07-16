<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef } from 'vue'
import * as THREE from 'three'
import { createMapShaderMaterial, type RippleData } from './shaderMaterial'
import { useAudioVisualizer } from '@/composables/useAudioVisualizer'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  active: boolean
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const player = usePlayerStore()
const settings = useSettingsStore()
const { getAudioData } = useAudioVisualizer()

// Three.js objects (shallowRef to avoid reactivity overhead)
const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
const scene = shallowRef<THREE.Scene | null>(null)
const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
const material = shallowRef<THREE.ShaderMaterial | null>(null)
const geometry = shallowRef<THREE.BoxGeometry | null>(null)
let animFrameId = 0

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

let lastRippleTime = 0

function getThemeBgColor(): number {
  // Use settings store to detect theme
  const isDark = settings.theme === 'dark'
  return isDark ? 0x0a0a0a : 0xffffff
}

function setupScene(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const width = rect.width || window.innerWidth
  const height = rect.height || window.innerHeight
  const bgColor = getThemeBgColor()

  const r = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: window.devicePixelRatio <= 1.5,
  })
  r.setSize(width, height)
  r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  r.setClearColor(bgColor, 1)
  renderer.value = r

  const s = new THREE.Scene()
  s.background = new THREE.Color(bgColor)
  s.fog = new THREE.Fog(bgColor, 50, 200)
  scene.value = s

  const cam = new THREE.PerspectiveCamera(50, width / height, 0.1, 200)
  cam.position.set(30, 35, 40)
  cam.lookAt(0, 0, 0)
  camera.value = cam

  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  s.add(ambient)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(10, 20, 10)
  s.add(dirLight)

  const mat = createMapShaderMaterial()
  material.value = mat

  const geo = new THREE.BoxGeometry(0.9, 1, 0.9)
  geometry.value = geo
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

  let angle = Math.atan2(cam.position.x, cam.position.z)
  const radius = Math.sqrt(cam.position.x ** 2 + cam.position.z ** 2)
  const autoRotateSpeed = 0.0003

  let currentWidth = 0
  let currentHeight = 0
  const parentEl = canvas.parentElement

  function animate() {
    animFrameId = requestAnimationFrame(animate)

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

      mat.uniforms.uRipples.value = ripples
    }

    angle += autoRotateSpeed
    cam.position.x = Math.sin(angle) * radius
    cam.position.z = Math.cos(angle) * radius
    cam.lookAt(0, 0, 0)

    r.render(s, cam)
  }

  animate()
}

function handleClick(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  addRipple(x * 40, y * 40, 1.5)
}

onMounted(() => {
  if (canvasRef.value) {
    setupScene(canvasRef.value)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animFrameId)
  geometry.value?.dispose()
  material.value?.dispose()
  scene.value?.clear()

  const activeRenderer = renderer.value
  if (activeRenderer) {
    activeRenderer.renderLists.dispose()
    activeRenderer.dispose()
    activeRenderer.forceContextLoss()
  }

  if (canvasRef.value) {
    canvasRef.value.width = 1
    canvasRef.value.height = 1
  }

  geometry.value = null
  material.value = null
  scene.value = null
  camera.value = null
  renderer.value = null
})
</script>

<template>
  <canvas
    ref="canvasRef"
    style="display: block; width: 100%; height: 100%; position: absolute; top: 0; left: 0;"
    @click="handleClick"
  />
</template>
