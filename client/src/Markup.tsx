import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { LINE_HEIGHT, TEXT_POINTS } from './Export'

// All positions are fractions of the slide (0–1), so markup stays put when the slide is resized.
export type Tool = 'select' | 'highlight' | 'pen' | 'marker' | 'text' | 'eraser'
type Rect = { x: number; y: number; w: number; h: number }
export type Annotation =
  | { id: string; kind: 'text'; x: number; y: number; text: string; color: string }
  | { id: string; kind: 'ink'; points: Array<[number, number]>; color: string; marker: boolean }
  | { id: string; kind: 'highlight'; rects: Rect[]; color: string }
  // A sticky note that connects this slide to a slide in another lecture.
  // `reason` is the student's private note on why they made the link. It is only shown after jumping (J).
  | { id: string; kind: 'link'; x: number; y: number; targetPath: string; targetPage: number; label: string; reason?: string }
export type LinkNote = Annotation & { kind: 'link' }

export const HIGHLIGHT_COLORS = ['#ffe14d', '#7ee08a', '#ff9ec7', '#7cc7ff']
export const INK_COLORS = ['#e2453c', '#2e6f95', '#1d2b3a', '#3f8a6b']
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ---------- Saving ----------
const STORAGE_KEY = 'smazy-markup'
type Store = Record<string, Annotation[]>
const loadStore = (): Store => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}

export function useMarkup(path: string, page: number) {
  const [store, setStore] = useState<Store>(loadStore)
  const key = `${path}#${page}`
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) } catch { /* storage full or blocked: markup lasts for this session */ }
  }, [store])
  const setList = useCallback((update: (list: Annotation[]) => Annotation[]) => {
    setStore((current) => {
      const next = update(current[key] || [])
      const { [key]: _old, ...rest } = current
      return next.length ? { ...rest, [key]: next } : rest
    })
  }, [key])
  // Every marked-up page of one file, keyed by page number (used when downloading the file).
  const forFile = useCallback((filePath: string) => {
    const pages: Record<number, Annotation[]> = {}
    for (const [storeKey, list] of Object.entries(store)) {
      const split = storeKey.lastIndexOf('#')
      if (storeKey.slice(0, split) === filePath) pages[Number(storeKey.slice(split + 1))] = list
    }
    return pages
  }, [store])
  return [store[key] || [], setList, forFile] as const
}

// Turns the current text selection on the slide into highlight rectangles.
export function selectionToHighlight(frame: HTMLElement, color: string): Annotation | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!frame.contains(range.commonAncestorContainer)) return null
  const box = frame.getBoundingClientRect()
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }))
  selection.removeAllRanges()
  return rects.length ? { id: newId(), kind: 'highlight', rects, color } : null
}

export const makeLink = (x: number, y: number, targetPath: string, targetPage: number, label: string): LinkNote => ({ id: newId(), kind: 'link', x, y, targetPath, targetPage, label })
export const makeTextBox = (x: number, y: number, color: string): Annotation => ({ id: newId(), kind: 'text', x, y, text: 'Text', color })

// ---------- Toolbar ----------
const TOOLS: Array<{ tool: Tool; label: string; icon: string; keys?: string }> = [
  { tool: 'select', label: 'Select text', icon: 'I' },
  { tool: 'highlight', label: 'Highlight text', icon: '▮', keys: '⌃⌘H' },
  { tool: 'pen', label: 'Draw', icon: '✎', keys: '⌃⌘P' },
  { tool: 'marker', label: 'Marker', icon: '▌' },
  { tool: 'text', label: 'Text box', icon: 'T', keys: '⌃⌘T' },
  { tool: 'eraser', label: 'Eraser: click markup to remove', icon: '⌫' },
]

type ToolbarProps = {
  tool: Tool
  setTool: (tool: Tool) => void
  color: string
  setColor: (color: string) => void
  onUndo: () => void
  onClear: () => void
  canUndo: boolean
}

export function MarkupToolbar({ tool, setTool, color, setColor, onUndo, onClear, canUndo }: ToolbarProps) {
  const colors = tool === 'highlight' || tool === 'marker' ? HIGHLIGHT_COLORS : INK_COLORS
  return (
    <div className="markup-toolbar" role="toolbar" aria-label="Markup">
      {TOOLS.map((item) => (
        <button key={item.tool} className={`tool-button ${tool === item.tool ? 'active' : ''}`} onClick={() => setTool(item.tool)} title={item.keys ? `${item.label} (${item.keys})` : item.label} aria-pressed={tool === item.tool}>
          <span className={`tool-icon tool-${item.tool}`}>{item.icon}</span>
        </button>
      ))}
      {tool !== 'select' && tool !== 'eraser' && (
        <>
          <span className="toolbar-divider" />
          {colors.map((swatch) => (
            <button key={swatch} className={`swatch ${color === swatch ? 'active' : ''}`} style={{ background: swatch }} onClick={() => setColor(swatch)} title="Colour" aria-label={`Colour ${swatch}`} />
          ))}
        </>
      )}
      <span className="toolbar-divider" />
      <button className="tool-button" onClick={onUndo} disabled={!canUndo} title="Undo last markup (⌘Z)">↶</button>
      <button className="tool-button" onClick={onClear} disabled={!canUndo} title="Clear this slide’s markup">✕</button>
    </div>
  )
}

// ---------- Layer drawn on top of the slide ----------
type LayerProps = {
  annotations: Annotation[]
  setAnnotations: (update: (list: Annotation[]) => Annotation[]) => void
  tool: Tool
  setTool: (tool: Tool) => void
  color: string
  focusId: string | null
  clearFocus: () => void
  onTextBoxCreated: (id: string) => void
  // Height of the lecture page in PDF points, so 12 pt text is 12 pt on the page at any zoom.
  pageHeight: number
  onFollowLink: (link: LinkNote) => void
  renderLinkPreview: (link: LinkNote) => ReactNode
  // True after J on a slide with several links: the notes light up in blue so you can see which number to press.
  pickingLink: boolean
  onEditLinkReason: (link: LinkNote) => void
}

export function MarkupLayer({ annotations, setAnnotations, tool, setTool, color, focusId, clearFocus, onTextBoxCreated, pageHeight, onFollowLink, renderLinkPreview, pickingLink, onEditLinkReason }: LayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [drawing, setDrawing] = useState<Annotation & { kind: 'ink' } | null>(null)

  useLayoutEffect(() => {
    const el = layerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const point = (event: ReactPointerEvent): [number, number] => {
    const box = layerRef.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))]
  }
  const remove = (id: string) => setAnnotations((list) => list.filter((item) => item.id !== id))

  const onPointerDown = (event: ReactPointerEvent) => {
    if (tool === 'text') {
      const [x, y] = point(event)
      const box = makeTextBox(x, y, color)
      setAnnotations((list) => [...list, box])
      onTextBoxCreated(box.id)
      setTool('select')
      return
    }
    if (tool !== 'pen' && tool !== 'marker') return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawing({ id: newId(), kind: 'ink', points: [point(event)], color, marker: tool === 'marker' })
  }
  const onPointerMove = (event: ReactPointerEvent) => {
    if (drawing) setDrawing({ ...drawing, points: [...drawing.points, point(event)] })
  }
  const onPointerUp = () => {
    if (drawing && drawing.points.length > 1) setAnnotations((list) => [...list, drawing])
    setDrawing(null)
  }

  const toPath = (points: Array<[number, number]>) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * size.w).toFixed(1)} ${(y * size.h).toFixed(1)}`).join(' ')
  const highlights = annotations.filter((a): a is Annotation & { kind: 'highlight' } => a.kind === 'highlight')
  const inks = [...annotations.filter((a): a is Annotation & { kind: 'ink' } => a.kind === 'ink'), ...(drawing ? [drawing] : [])]
  const texts = annotations.filter((a): a is Annotation & { kind: 'text' } => a.kind === 'text')
  const linkNotes = annotations.filter((a): a is LinkNote => a.kind === 'link')
  const capturing = tool === 'pen' || tool === 'marker' || tool === 'text'

  return (
    <div ref={layerRef} className={`markup-layer tool-${tool}`}>
      <svg className="markup-highlights" width={size.w} height={size.h}>
        {highlights.map((h) => (
          <g key={h.id} onClick={() => tool === 'eraser' && remove(h.id)}>
            {h.rects.map((r, i) => <rect key={i} x={r.x * size.w} y={r.y * size.h} width={r.w * size.w} height={r.h * size.h} rx={2} fill={h.color} />)}
          </g>
        ))}
      </svg>
      <svg
        className={`markup-ink ${capturing ? 'capturing' : ''}`}
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {inks.map((ink) => (
          <path
            key={ink.id}
            d={toPath(ink.points)}
            stroke={ink.color}
            strokeWidth={ink.marker ? Math.max(14, size.h * 0.03) : Math.max(2.5, size.h * 0.004)}
            strokeOpacity={ink.marker ? 0.4 : 1}
            className={ink.marker ? 'marker-stroke' : ''}
            onClick={() => tool === 'eraser' && remove(ink.id)}
          />
        ))}
      </svg>
      {texts.map((box) => (
        <TextBox
          key={box.id}
          box={box}
          size={size}
          fontPx={TEXT_POINTS * (size.h / (pageHeight || 540))}
          tool={tool}
          autoFocus={focusId === box.id}
          onFocused={clearFocus}
          onChange={(change) => setAnnotations((list) => list.map((item) => (item.id === box.id ? { ...box, ...change } : item)))}
          onRemove={() => remove(box.id)}
        />
      ))}
      {linkNotes.map((link, index) => (
        <StickyLink
          key={link.id}
          link={link}
          number={linkNotes.length > 1 ? index + 1 : 0}
          picking={pickingLink}
          size={size}
          tool={tool}
          onMove={(x, y) => setAnnotations((list) => list.map((item) => (item.id === link.id ? { ...link, x, y } : item)))}
          onFollow={() => onFollowLink(link)}
          onEdit={() => onEditLinkReason(link)}
          onRemove={() => remove(link.id)}
          preview={renderLinkPreview(link)}
        />
      ))}
    </div>
  )
}

type StickyLinkProps = { link: LinkNote; number: number; picking: boolean; size: { w: number; h: number }; tool: Tool; onMove: (x: number, y: number) => void; onFollow: () => void; onEdit: () => void; onRemove: () => void; preview: ReactNode }

// Looks like a Preview sticky note. Click to jump to the linked slide; hover to peek at it; drag to move.
function StickyLink({ link, number, picking, size, tool, onMove, onFollow, onEdit, onRemove, preview }: StickyLinkProps) {
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState(false)
  return (
    <div
      className={`sticky-link ${picking ? 'picking' : ''} ${tool === 'pen' || tool === 'marker' ? 'passive' : ''} ${link.x > 0.55 ? 'opens-left' : ''} ${link.y > 0.5 ? 'opens-up' : ''}`}
      style={{ left: link.x * size.w, top: link.y * size.h }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className="sticky-link-note"
        title="Click to jump to this slide (J). Drag to move."
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { dx: event.clientX - link.x * size.w, dy: event.clientY - link.y * size.h, moved: false } }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const x = (event.clientX - drag.current.dx) / size.w
          const y = (event.clientY - drag.current.dy) / size.h
          if (Math.abs(x - link.x) * size.w > 3 || Math.abs(y - link.y) * size.h > 3) drag.current.moved = true
          if (drag.current.moved) onMove(Math.min(0.95, Math.max(0, x)), Math.min(0.95, Math.max(0, y)))
        }}
        onPointerUp={() => {
          const wasDrag = drag.current?.moved
          drag.current = null
          if (wasDrag) return
          if (tool === 'eraser') onRemove()
          else onFollow()
        }}
      >
        {number > 0 && <b className="sticky-link-number">{number}</b>}
        <span className="sticky-link-arrow">↗</span>
        {link.label}
      </button>
      <button className="sticky-link-edit" onClick={onEdit} title={link.reason ? 'Edit your note on why you made this link' : 'Add a note on why you made this link'}>✎</button>
      <button className="sticky-link-delete" onClick={onRemove} title="Remove this link">×</button>
      {hover && !picking && !drag.current && <div className="sticky-link-preview">{preview}</div>}
    </div>
  )
}

type TextBoxProps = {
  box: Annotation & { kind: 'text' }
  size: { w: number; h: number }
  fontPx: number
  tool: Tool
  autoFocus: boolean
  onFocused: () => void
  onChange: (change: Partial<{ x: number; y: number; text: string }>) => void
  onRemove: () => void
}

function TextBox({ box, size, fontPx, tool, autoFocus, onFocused, onChange, onRemove }: TextBoxProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  // The editor is uncontrolled so the caret never jumps while typing.
  useLayoutEffect(() => {
    if (editorRef.current && editorRef.current.innerText !== box.text) editorRef.current.innerText = box.text
  }, [box.text])

  // New boxes start with "Text" selected, like Preview, so typing replaces it.
  useEffect(() => {
    if (!autoFocus || !editorRef.current) return
    const editor = editorRef.current
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    onFocused()
  }, [autoFocus, onFocused])

  const startDrag = (event: ReactPointerEvent) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { dx: event.clientX - box.x * size.w, dy: event.clientY - box.y * size.h }
  }
  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag.current) return
    onChange({ x: Math.min(0.97, Math.max(0, (event.clientX - drag.current.dx) / size.w)), y: Math.min(0.97, Math.max(0, (event.clientY - drag.current.dy) / size.h)) })
  }

  return (
    <div
      className={`text-box ${tool === 'pen' || tool === 'marker' ? 'passive' : ''}`}
      style={{ left: box.x * size.w, top: box.y * size.h, color: box.color, fontSize: fontPx, lineHeight: LINE_HEIGHT }}
      onClick={() => tool === 'eraser' && onRemove()}
    >
      <div className="text-box-handle" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} title="Drag to move">⋮⋮</div>
      <div
        ref={editorRef}
        className="text-box-editor"
        contentEditable={tool !== 'eraser'}
        suppressContentEditableWarning
        spellCheck={false}
        onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur() }}
        onBlur={(event) => {
          const text = event.currentTarget.innerText.trim()
          if (!text) onRemove()
          else if (text !== box.text) onChange({ text })
        }}
      />
      <button className="text-box-delete" onMouseDown={(event) => event.preventDefault()} onClick={onRemove} title="Delete text box">×</button>
    </div>
  )
}

