import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { Annotation } from './Markup'

// Text box defaults: Times New Roman, 12 pt (measured on the lecture page itself), 1.5 line spacing.
export const TEXT_POINTS = 12
export const LINE_HEIGHT = 1.5
const TEXT_MAX_WIDTH = 0.48

const color = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// Times can't encode every character (arrows, emoji, Chinese…). Those text boxes are drawn as a picture instead.
function textAsImage(text: string, hex: string, pxSize: number, maxWidthPx: number) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${pxSize}px "Times New Roman", Times, serif`
  ctx.font = font
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > maxWidthPx) { lines.push(line.trimEnd()); line = word.trimStart() } else line += word
    }
    lines.push(line)
  }
  canvas.width = Math.ceil(Math.max(1, ...lines.map((line) => ctx.measureText(line).width))) + 4
  canvas.height = Math.ceil(lines.length * pxSize * LINE_HEIGHT) + 4
  ctx.font = font
  ctx.fillStyle = hex
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => ctx.fillText(line, 0, i * pxSize * LINE_HEIGHT + pxSize * 0.1))
  return canvas
}

async function drawPage(doc: PDFDocument, page: PDFPage, font: PDFFont, annotations: Annotation[]) {
  // pdf.js shows the crop box, with the origin at the top-left; PDF coordinates start bottom-left.
  const box = page.getCropBox()
  const X = (nx: number) => box.x + nx * box.width
  const Y = (ny: number) => box.y + box.height - ny * box.height

  for (const item of annotations.filter((a) => a.kind === 'highlight')) {
    if (item.kind !== 'highlight') continue
    for (const r of item.rects) {
      page.drawRectangle({ x: X(r.x), y: Y(r.y + r.h), width: r.w * box.width, height: r.h * box.height, color: color(item.color), opacity: 0.55, blendMode: BlendMode.Multiply })
    }
  }
  for (const item of annotations) {
    if (item.kind === 'ink' && item.points.length > 1) {
      const d = item.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * box.width).toFixed(2)} ${(y * box.height).toFixed(2)}`).join(' ')
      page.drawSvgPath(d, {
        x: box.x, y: box.y + box.height,
        borderColor: color(item.color),
        borderWidth: item.marker ? Math.max(8, box.height * 0.03) : Math.max(1.5, box.height * 0.004),
        borderOpacity: item.marker ? 0.4 : 1,
        borderLineCap: LineCapStyle.Round,
        blendMode: item.marker ? BlendMode.Multiply : BlendMode.Normal,
      })
    }
    if (item.kind === 'link') {
      // The sticky note is kept in the download as a small yellow label.
      const text = `Link: ${item.label.replace(' ·', ',')}`
      const size = 9
      let width = 90
      try { width = font.widthOfTextAtSize(text, size) + 12 } catch { /* non-Latin label: keep the default width */ }
      const left = X(item.x)
      const topY = Y(item.y)
      page.drawRectangle({ x: left, y: topY - 18, width, height: 18, color: rgb(1, 0.92, 0.42), borderColor: rgb(0.85, 0.72, 0.2), borderWidth: 0.6 })
      try { page.drawText(text, { x: left + 6, y: topY - 12.5, size, font, color: rgb(0.15, 0.2, 0.27) }) } catch { /* label can't be written in Times */ }
    }
    if (item.kind === 'text') {
      const size = TEXT_POINTS
      const left = X(item.x) + size * 0.35
      // The first line sits half a line-gap below the top of the box.
      const top = Y(item.y) - size * ((LINE_HEIGHT - 1) / 2 + 0.12)
      let encodable = true
      try { font.encodeText(item.text.replace(/\n/g, '')) } catch { encodable = false }
      if (encodable) {
        page.drawText(item.text, { x: left, y: top - size * 0.95, size, font, color: color(item.color), lineHeight: size * LINE_HEIGHT, maxWidth: box.width * TEXT_MAX_WIDTH })
      } else {
        const scale = 3 // sharper than screen resolution
        const canvas = textAsImage(item.text, item.color, size * scale, box.width * TEXT_MAX_WIDTH * scale)
        const image = await doc.embedPng(canvas.toDataURL('image/png'))
        page.drawImage(image, { x: left, y: top - canvas.height / scale, width: canvas.width / scale, height: canvas.height / scale })
      }
    }
  }
}

// Returns a copy of the PDF with every highlight, drawing and text box drawn onto its pages.
export async function exportWithMarkup(file: File, markupByPage: Record<number, Annotation[]>): Promise<Blob> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const pages = doc.getPages()
  for (const [pageNumber, annotations] of Object.entries(markupByPage)) {
    const page = pages[Number(pageNumber) - 1]
    if (page && annotations.length) await drawPage(doc, page, font, annotations)
  }
  return new Blob([await doc.save()], { type: 'application/pdf' })
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
