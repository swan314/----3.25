import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

const MAX_CANVAS_SIDE = 8192
const MAX_EXPORT_WIDTH = 1400
const PDF_CAPTURE_GRID_CSS = `
.mm-pdf-capture-active .mm-score-row {
  display: grid !important;
  grid-template-columns: 118px repeat(5, minmax(0, 1fr)) 88px !important;
  justify-content: unset !important;
  justify-items: center;
  align-items: center;
  column-gap: 10px;
}
.mm-pdf-capture-active .mm-score-step {
  justify-self: start;
  width: 100%;
  text-align: left;
}
.mm-pdf-capture-active .mm-score-points {
  justify-self: center;
  text-align: center;
  min-width: 0;
}
`

const INLINE_STYLE_PROPS = [
  ['color', 'color'],
  ['backgroundColor', 'background-color'],
  ['borderTopColor', 'border-top-color'],
  ['borderRightColor', 'border-right-color'],
  ['borderBottomColor', 'border-bottom-color'],
  ['borderLeftColor', 'border-left-color'],
]

const LAYOUT_STYLE_PROPS = [
  ['width', 'width'],
  ['height', 'height'],
  ['display', 'display'],
  ['flex', 'flex'],
  ['flexDirection', 'flex-direction'],
  ['gap', 'gap'],
  ['gridTemplateColumns', 'grid-template-columns'],
  ['padding', 'padding'],
  ['margin', 'margin'],
  ['borderRadius', 'border-radius'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['textAlign', 'text-align'],
]

function isSafeCssValue(value) {
  const v = String(value || '').trim()
  if (!v) return false
  return !/oklch|oklab|color-mix|lab\(|lch\(/i.test(v)
}

function stripClonedDocumentStyles(clonedDoc) {
  clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => node.remove())
}

function syncInlineStylesFromSource(sourceRoot, cloneRoot) {
  const sourceNodes = [sourceRoot, ...sourceRoot.querySelectorAll('*')]
  const cloneNodes = [cloneRoot, ...cloneRoot.querySelectorAll('*')]
  const len = Math.min(sourceNodes.length, cloneNodes.length)

  for (let i = 0; i < len; i++) {
    const src = sourceNodes[i]
    const cl = cloneNodes[i]
    if (!(src instanceof HTMLElement) || !(cl instanceof HTMLElement)) continue
    const cs = window.getComputedStyle(src)

    for (const [jsProp, cssProp] of INLINE_STYLE_PROPS) {
      const val = cs[jsProp]
      if (isSafeCssValue(val)) {
        cl.style.setProperty(cssProp, val)
      } else if (cssProp === 'color') {
        cl.style.setProperty(cssProp, '#0f172a')
      } else if (cssProp === 'background-color') {
        cl.style.setProperty(cssProp, '#ffffff')
      }
    }

    for (const [jsProp, cssProp] of LAYOUT_STYLE_PROPS) {
      const val = cs[jsProp]
      if (val) cl.style.setProperty(cssProp, val)
    }

    cl.style.boxShadow = 'none'
    cl.style.filter = 'none'
  }

  const rootCs = window.getComputedStyle(sourceRoot)
  cloneRoot.style.backgroundColor = isSafeCssValue(rootCs.backgroundColor)
    ? rootCs.backgroundColor
    : '#ffffff'
}

async function embedImagesAsDataUrls(root) {
  const imgs = root.querySelectorAll('img')
  await Promise.all(
    Array.from(imgs).map(async (img) => {
      const src = (img.currentSrc || img.src || '').trim()
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) return
      try {
        const res = await fetch(src, { credentials: 'same-origin' })
        if (!res.ok) return
        const blob = await res.blob()
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        if (dataUrl) img.src = dataUrl
      } catch (err) {
        console.warn('[pdf] image embed skipped:', src, err)
      }
    }),
  )
}

async function waitForImages(root) {
  const imgs = root.querySelectorAll('img')
  await Promise.all(
    Array.from(imgs).map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve()
            return
          }
          const done = () => resolve()
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
          window.setTimeout(done, 10000)
        }),
    ),
  )
}

function resolveCaptureScale(width, height, preserveStyles) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  let scale = preserveStyles ? 2 : h > 1600 ? 1.25 : 1.5
  while (scale > 1 && (w * scale > MAX_CANVAS_SIDE || h * scale > MAX_CANVAS_SIDE)) {
    scale -= 0.25
  }
  return Math.min(preserveStyles ? 2 : 1.5, Math.max(1, scale))
}

function downscaleCanvas(canvas, maxWidth = MAX_EXPORT_WIDTH) {
  if (canvas.width <= maxWidth) return canvas
  const ratio = maxWidth / canvas.width
  const next = document.createElement('canvas')
  next.width = maxWidth
  next.height = Math.max(1, Math.round(canvas.height * ratio))
  const ctx = next.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, next.width, next.height)
  ctx.drawImage(canvas, 0, 0, next.width, next.height)
  return next
}

/**
 * @param {HTMLElement} target
 * @param {number} scale
 * @param {HTMLElement} styleSource
 * @param {{ preserveStyles?: boolean }} opts
 */
function buildHtml2CanvasOptions(target, scale, styleSource, opts = {}) {
  const { preserveStyles = false } = opts
  const options = {
    scale,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 20000,
  }

  options.onclone = (clonedDoc, clonedRoot) => {
    if (preserveStyles) {
      clonedRoot.classList.add('mm-pdf-capture-active')
      const styleEl = clonedDoc.createElement('style')
      styleEl.textContent = PDF_CAPTURE_GRID_CSS
      clonedDoc.head.appendChild(styleEl)
      return
    }
    stripClonedDocumentStyles(clonedDoc)
    syncInlineStylesFromSource(styleSource, clonedRoot)
  }

  return options
}

/**
 * @param {HTMLElement} target
 * @param {{ preserveStyles?: boolean }} opts
 */
async function captureElementCanvas(target, opts = {}) {
  const { preserveStyles = false } = opts
  const styleSource = target

  await embedImagesAsDataUrls(target)
  await waitForImages(target)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  const scale = resolveCaptureScale(
    Math.max(target.scrollWidth, target.offsetWidth, 1),
    Math.max(target.scrollHeight, target.offsetHeight, 1),
    preserveStyles,
  )

  try {
    return await html2canvas(target, buildHtml2CanvasOptions(target, scale, styleSource, opts))
  } catch (strictErr) {
    console.warn('[pdf] strict capture failed', strictErr)
    return html2canvas(target, {
      ...buildHtml2CanvasOptions(target, 1, styleSource, opts),
      scale: 1,
      allowTaint: true,
      useCORS: false,
    })
  }
}

function saveCanvasAsPdf(imgData, canvas, filename) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 10
  const printableHeight = pageHeight - margin * 2
  const imgWidth = pageWidth - margin * 2
  const imgHeight = (canvas.height * imgWidth) / canvas.width
  const format = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG'

  let heightLeft = imgHeight
  let offsetY = margin
  pdf.addImage(imgData, format, margin, offsetY, imgWidth, imgHeight, undefined, 'FAST')
  heightLeft -= printableHeight

  while (heightLeft > 0) {
    pdf.addPage()
    offsetY = margin - (imgHeight - heightLeft)
    pdf.addImage(imgData, format, margin, offsetY, imgWidth, imgHeight, undefined, 'FAST')
    heightLeft -= printableHeight
  }

  const safeName = String(filename || 'export.pdf').replace(/[<>:"/\\|?*]+/g, '_')
  pdf.save(safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`)
}

/**
 * @param {HTMLElement} element
 * @param {string} filename
 * @param {{ preserveStyles?: boolean }} [options]
 */
export async function downloadElementAsPdf(element, filename = 'export.pdf', options = {}) {
  if (!element) throw new Error('missing_element')

  const preserveStyles = options.preserveStyles === true

  const canvas = downscaleCanvas(
    await captureElementCanvas(element, { preserveStyles }),
    preserveStyles ? 1600 : MAX_EXPORT_WIDTH,
  )
  if (!canvas?.width || !canvas?.height) throw new Error('empty_canvas')

  let imgData = ''
  try {
    imgData = canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    imgData = canvas.toDataURL('image/png')
  }
  if (!imgData || imgData.length < 32) throw new Error('empty_image_data')

  saveCanvasAsPdf(imgData, canvas, filename)
}
