import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

export type PickedFile = { path: string; file: File }

const isJunk = (path: string) => path.split('/').some((part) => part.startsWith('.') || part.startsWith('~$') || part === '__MACOSX') || /desktop\.ini$|thumbs\.db$/i.test(path)

// Walks a dropped folder (DataTransfer.files alone does not include folder contents).
async function readEntry(entry: FileSystemEntry): Promise<PickedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    return [{ path: entry.fullPath.replace(/^\//, ''), file }]
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    children.push(...batch)
  }
  return (await Promise.all(children.map(readEntry))).flat()
}

export function UploadScreen({ onFiles, error }: { onFiles: (files: PickedFile[]) => void; error: string }) {
  const [dragging, setDragging] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  const submit = (files: PickedFile[]) => {
    const kept = files.filter((item) => !isJunk(item.path))
    if (kept.length) onFiles(kept)
  }
  const fromInput = (list: FileList | null) => {
    submit(Array.from(list || []).map((file) => ({ path: file.webkitRelativePath || file.name, file })))
  }
  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const entries = Array.from(event.dataTransfer.items).map((item) => item.webkitGetAsEntry()).filter((entry): entry is FileSystemEntry => Boolean(entry))
    if (entries.length) submit((await Promise.all(entries.map(readEntry))).flat())
    else fromInput(event.dataTransfer.files)
  }

  return (
    <div className="upload-shell" onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={onDrop}>
      <header className="landing-nav">
        <span className="wordmark"><span className="wordmark-dot" />smazy</span>
        <span className="nav-note">smart about being lazy</span>
      </header>
      <main className="upload-main">
        <div className="upload-copy">
          <span className="kicker">Your study desk <span>✦</span></span>
          <h1>Let’s study<br /><em>together</em> with Smazy.</h1>
          <p>Drop in your whole course folder once. Smazy sorts it, finds your first lecture, and opens it for you.</p>
          <ol className="how-it-works">
            <li><b>1</b><span>Upload the course folder from your LMS</span></li>
            <li><b>2</b><span>Smazy sorts it into <i>Learn</i> and <i>Course Info</i></span></li>
            <li><b>3</b><span>Your first lecture opens, full screen</span></li>
          </ol>
        </div>
        <div className={`drop-card ${dragging ? 'dragging' : ''}`}>
          <div className="folder-icon" aria-hidden>
            <svg viewBox="0 0 48 40" width="44" height="36"><path d="M4 8a4 4 0 0 1 4-4h10l4 5h18a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" opacity=".18" /><path d="M4 14h40v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" opacity=".55" /></svg>
          </div>
          <h2>Drop your course folder here</h2>
          <p>Lecture slides, syllabus, homework, rubrics, textbooks. Bring all of it.</p>
          <button type="button" className="primary-button" onClick={() => folderInput.current?.click()}>Choose course folder</button>
          <button type="button" className="text-button" onClick={() => filesInput.current?.click()}>or pick individual files</button>
          <input ref={folderInput} hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => { fromInput(event.target.files); event.target.value = '' }} />
          <input ref={filesInput} hidden type="file" multiple onChange={(event) => { fromInput(event.target.files); event.target.value = '' }} />
          <small className="drop-hint">Files stay in your browser. PDFs open as slides.</small>
        </div>
      </main>
      {error && <div className="upload-error" role="alert">{error}</div>}
    </div>
  )
}
