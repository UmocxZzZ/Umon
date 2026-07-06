import { ref, onUnmounted, type Ref } from 'vue'

interface UseDragOptions {
  onDragStart?: (ratio: number) => void
  onDragMove?: (ratio: number) => void
  onDragEnd?: (ratio: number) => void
  onHover?: (ratio: number | null) => void
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val))
}

export function useDrag(container: Ref<HTMLElement | null>, options: UseDragOptions = {}) {
  const isDragging = ref(false)
  const hoverRatio = ref<number | null>(null)

  function calcRatio(clientX: number): number {
    if (!container.value) return 0
    const rect = container.value.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width, 0, 1)
  }

  // Mouse events
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    isDragging.value = true
    const ratio = calcRatio(e.clientX)
    options.onDragStart?.(ratio)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging.value) return
    options.onDragMove?.(calcRatio(e.clientX))
  }

  function onMouseUp(e: MouseEvent) {
    if (!isDragging.value) return
    options.onDragEnd?.(calcRatio(e.clientX))
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  // Touch events
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    e.preventDefault()
    isDragging.value = true
    const ratio = calcRatio(e.touches[0].clientX)
    options.onDragStart?.(ratio)
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging.value || e.touches.length !== 1) return
    options.onDragMove?.(calcRatio(e.touches[0].clientX))
  }

  function onTouchEnd(_e: TouchEvent) {
    if (!isDragging.value) return
    // Use the last known position
    isDragging.value = false
  }

  // Hover events
  function onMouseEnter() {
    // Don't set hover on enter, wait for move
  }

  function onMouseMoveHover(e: MouseEvent) {
    if (isDragging.value) return
    hoverRatio.value = calcRatio(e.clientX)
    options.onHover?.(hoverRatio.value)
  }

  function onMouseLeave() {
    hoverRatio.value = null
    options.onHover?.(null)
  }

  // Bind events to container
  function bindEvents(el: HTMLElement | null) {
    if (!el) return
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove)
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('mouseenter', onMouseEnter)
    el.addEventListener('mousemove', onMouseMoveHover)
    el.addEventListener('mouseleave', onMouseLeave)
  }

  // Cleanup
  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  onUnmounted(cleanup)

  return {
    isDragging,
    hoverRatio,
    bindEvents,
    cleanup,
  }
}
