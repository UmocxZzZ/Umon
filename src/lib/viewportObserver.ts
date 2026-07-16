type VisibilityCallback = (visible: boolean) => void

const callbacks = new WeakMap<Element, VisibilityCallback>()
let observer: IntersectionObserver | null = null

function getObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null
  if (observer) return observer

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      callbacks.get(entry.target)?.(entry.isIntersecting)
    }
  }, {
    // Preload a few rows before they enter the viewport without allowing a long
    // list to create every image at once.
    rootMargin: '192px 0px',
    threshold: 0.01,
  })

  return observer
}

export function observeViewportVisibility(
  element: Element,
  callback: VisibilityCallback,
): () => void {
  const sharedObserver = getObserver()
  if (!sharedObserver) {
    callback(true)
    return () => undefined
  }

  callbacks.set(element, callback)
  sharedObserver.observe(element)

  return () => {
    sharedObserver.unobserve(element)
    callbacks.delete(element)
  }
}
