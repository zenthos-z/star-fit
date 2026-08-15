import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import './style.css'

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()

    const initLightbox = () => {
      // Clean up previous listeners if any (optional, but good practice)
      // Since we clone the node for lightbox, we just need to attach click listeners to the original

      const attachListeners = () => {
        const mermaids = document.querySelectorAll('.mermaid')
        mermaids.forEach((el) => {
          if (el.hasAttribute('data-zoom-init')) return
          el.setAttribute('data-zoom-init', 'true')

          el.addEventListener('click', () => {
            const svg = el.querySelector('svg')
            if (svg) {
              openLightbox(svg.cloneNode(true) as SVGElement)
            }
          })
        })
      }

      // Polling for async mermaid rendering
      const intervals = [100, 500, 1500, 3000]
      intervals.forEach(t => setTimeout(attachListeners, t))
    }

    const wrapTables = () => {
      const tables = document.querySelectorAll('.vp-doc table')
      tables.forEach((table) => {
        if (table.parentElement?.classList.contains('table-wrapper')) return

        const wrapper = document.createElement('div')
        wrapper.className = 'table-wrapper'
        table.parentNode?.insertBefore(wrapper, table)
        wrapper.appendChild(table)
      })
    }

    onMounted(() => {
      createLightboxDOM()
      initLightbox()
      wrapTables()
    })

    watch(
      () => route.path,
      () => nextTick(() => {
        initLightbox()
        wrapTables()
      })
    )
  }
}

let lightboxOverlay: HTMLElement | null = null
let lightboxContent: HTMLElement | null = null
let currentScale = 1
let currentTranslateX = 0
let currentTranslateY = 0
let isDragging = false
let startX = 0
let startY = 0

function createLightboxDOM() {
  if (typeof document === 'undefined') return
  if (document.getElementById('mermaid-lightbox')) return

  const overlay = document.createElement('div')
  overlay.id = 'mermaid-lightbox'
  overlay.className = 'mermaid-lightbox-overlay'

  const content = document.createElement('div')
  content.className = 'mermaid-lightbox-content'

  const closeBtn = document.createElement('div')
  closeBtn.className = 'mermaid-lightbox-close'
  closeBtn.innerHTML = '&times;'
  closeBtn.onclick = closeLightbox

  const hint = document.createElement('div')
  hint.className = 'mermaid-lightbox-hint'
  hint.innerText = 'Scroll to Zoom • Drag to Pan'

  overlay.appendChild(content)
  overlay.appendChild(closeBtn)
  overlay.appendChild(hint)
  document.body.appendChild(overlay)

  lightboxOverlay = overlay
  lightboxContent = content

  // Close on background click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === content) {
      closeLightbox()
    }
  })

  // Wheel Zoom
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = currentScale * delta

    // Limit zoom
    if (newScale > 0.1 && newScale < 10) {
      currentScale = newScale
      updateTransform()
    }
  }, { passive: false })

  // Pan Logic
  content.addEventListener('mousedown', (e) => {
    isDragging = true
    startX = e.clientX - currentTranslateX
    startY = e.clientY - currentTranslateY
    content.style.cursor = 'grabbing'
  })

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    e.preventDefault()
    currentTranslateX = e.clientX - startX
    currentTranslateY = e.clientY - startY
    updateTransform()
  })

  window.addEventListener('mouseup', () => {
    isDragging = false
    if (content) content.style.cursor = 'grab'
  })
}

function openLightbox(svgNode: SVGElement) {
  if (!lightboxContent || !lightboxOverlay) return

  lightboxContent.innerHTML = ''
  // Reset transform
  currentScale = 1
  currentTranslateX = 0
  currentTranslateY = 0

  // Make SVG responsive
  svgNode.removeAttribute('width')
  svgNode.removeAttribute('height')
  svgNode.style.width = '100%'
  svgNode.style.height = '100%'
  svgNode.style.transform = 'translate(0px, 0px) scale(1)'

  lightboxContent.appendChild(svgNode)
  lightboxOverlay.classList.add('active')
  document.body.style.overflow = 'hidden' // Prevent scrolling body
}

function closeLightbox() {
  if (lightboxOverlay) {
    lightboxOverlay.classList.remove('active')
    document.body.style.overflow = ''
  }
}

function updateTransform() {
  const svg = lightboxContent?.querySelector('svg')
  if (svg) {
    svg.style.transform = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${currentScale})`
  }
}
