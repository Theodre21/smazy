import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export { pdfjsLib }

// Long books only need their opening pages for sorting; lectures are read in full.
const MAX_PAGES_READ = 40

export async function readPdfText(file: File): Promise<{ pageCount: number; pages: string[] }> {
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES_READ); n += 1) {
    const content = await (await doc.getPage(n)).getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim())
  }
  const pageCount = doc.numPages
  void doc.destroy()
  return { pageCount, pages }
}
