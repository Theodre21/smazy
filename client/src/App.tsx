import { useState } from 'react'
import * as api from './api'
import { OrganizingScreen } from './Organizing'
import type { Phase } from './Organizing'
import { readPdfText } from './pdf'
import { SPREADSHEET, readSheetText } from './Sheet'
import { UploadScreen } from './Upload'
import type { PickedFile } from './Upload'
import { Viewer } from './Viewer'
import type { CourseFile, FirstLecture, Link } from './types'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Teachers often upload the same file twice, e.g. "Syllabus.pdf" and "Syllabus.docx".
// Files whose names match apart from the extension count as one; the PDF version wins.
const sameDocumentKey = (path: string) => path.split('/').pop()!.replace(/\.[a-z0-9]+$/i, '').replace(/[\s_]+/g, ' ').trim().toLowerCase()
const isPdfName = (path: string) => /\.pdf$/i.test(path)
function dropDuplicateVersions(files: PickedFile[]) {
  const versions = new Map<string, PickedFile[]>()
  for (const file of files) {
    const key = sameDocumentKey(file.path)
    versions.set(key, [...(versions.get(key) || []), file])
  }
  const dropped = new Set<PickedFile>()
  for (const group of versions.values()) {
    const pdfs = group.filter((file) => isPdfName(file.path))
    if (pdfs.length && pdfs.length < group.length) group.filter((file) => !isPdfName(file.path)).forEach((file) => dropped.add(file))
  }
  return { kept: files.filter((file) => !dropped.has(file)), dropped: [...dropped] }
}

type Screen = { name: 'upload' } | { name: 'organizing'; phase: Phase } | { name: 'viewer' }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'upload' })
  const [files, setFiles] = useState<CourseFile[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [first, setFirst] = useState<FirstLecture | null>(null)
  const [error, setError] = useState('')


  const start = async (uploaded: PickedFile[]) => {
    setError('')
    const { kept: picked, dropped } = dropDuplicateVersions(uploaded)
    const show = (phase: Phase) => setScreen({ name: 'organizing', phase: { ...phase, duplicates: dropped.length } })
    try {
      // 1. Read every file (text from PDFs; other formats are sorted by name only).
      const read: CourseFile[] = new Array(picked.length)
      let done = 0
      let next = 0
      show({ step: 'reading', read: 0, total: picked.length, files: [] })
      const worker = async () => {
        while (next < picked.length) {
          const index = next++
          const { path, file } = picked[index]
          const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
          let text = { pageCount: 0, pages: [] as string[] }
          if (isPdf) {
            try { text = await readPdfText(file) } catch (problem) { console.warn('Could not read', path, problem) }
          } else if (SPREADSHEET.test(file.name)) {
            try { text = await readSheetText(file) } catch (problem) { console.warn('Could not read', path, problem) }
          }
          read[index] = { path, name: file.name, file, isPdf: isPdf && text.pageCount > 0, ...text, group: 'Course Info', category: 'Readings', tag: 'Readings', lectureNumber: null }
          show({ step: 'reading', read: ++done, total: picked.length, files: [] })
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))

      // 2. Sort into Learn and Course Info.
      show({ step: 'sorting', read: read.length, total: read.length, files: [] })
      const organized = await api.organize(read)
      // Practice material (past exams, tutorials, solutions) is left out of the course.
      const sorted = read.flatMap((file) => {
        const entry = organized.files.find((item) => item.path === file.path)
        return entry ? [{ ...file, group: entry.group, category: entry.category, tag: entry.tag, lectureNumber: entry.lectureNumber }] : []
      }).sort((a, b) => (a.lectureNumber ?? Infinity) - (b.lectureNumber ?? Infinity) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      show({ step: 'sorting', read: read.length, total: read.length, files: sorted, leftOut: organized.leftOut.length })
      await pause(900 + sorted.length * 60)

      // 3. Search Learn for the first lecture.
      if (!sorted.some((file) => file.group === 'Learn')) throw new Error('Smazy couldn’t find any lecture slides in that folder.')
      show({ step: 'searching', read: read.length, total: read.length, files: sorted, leftOut: organized.leftOut.length })
      const [picked1] = await Promise.all([api.findFirstLecture(sorted), pause(1200)])
      show({ step: 'opening', read: read.length, total: read.length, files: sorted, firstPath: picked1.path, leftOut: organized.leftOut.length })

      // PowerPoint lectures are converted to PDF before opening, so they show as real slides.
      const firstIndex = sorted.findIndex((file) => file.path === picked1.path)
      const firstFile = sorted[firstIndex]
      if (firstFile && !firstFile.isPdf && api.CONVERTIBLE.test(firstFile.name)) {
        show({ step: 'opening', read: read.length, total: read.length, files: sorted, firstPath: picked1.path, leftOut: organized.leftOut.length, note: 'Converting the PowerPoint to slides…' })
        try { sorted[firstIndex] = await api.makeViewable(firstFile) } catch (problem) { console.warn('Conversion failed', problem) }
      } else {
        await pause(1300)
      }

      // 4. Open it full screen.
      setFiles(sorted)
      setLinks(organized.links)
      setFirst(picked1)
      setScreen({ name: 'viewer' })
    } catch (problem) {
      console.error(problem)
      setError((problem as Error).message || 'Something went wrong while reading that folder.')
      setScreen({ name: 'upload' })
    }
  }

  if (screen.name === 'organizing') return <OrganizingScreen phase={screen.phase} />
  if (screen.name === 'viewer' && first) {
    return <Viewer files={files} setFiles={setFiles} links={links} first={first} onReset={() => { setScreen({ name: 'upload' }); setFiles([]); setFirst(null) }} />
  }
  return <UploadScreen onFiles={(picked) => void start(picked)} error={error} />
}
