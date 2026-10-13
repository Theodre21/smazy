import { BrowserLayer } from './Browser'
import { Companion, praise, usePartnerName } from './partner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONVERTIBLE, makeViewable } from './api'
import { ChatPanel } from './Chat'
import { SPREADSHEET, SheetView } from './Sheet'
import { exportWithMarkup, saveBlob } from './Export'
import { threadKey, useThreads } from './threads'
import { HIGHLIGHT_COLORS, INK_COLORS, MarkupLayer, MarkupToolbar, makeLink, makeTextBox, selectionToHighlight, useMarkup } from './Markup'
import type { LinkNote, Tool } from './Markup'
import { pdfjsLib } from './pdf'
import { CATEGORIES, groupOf } from './types'
import type { CourseFile, FirstLecture, Group, Link } from './types'

type Props = {
  files: CourseFile[]
  setFiles: (update: (files: CourseFile[]) => CourseFile[]) => void
  links: Link[]
  first: FirstLecture
  onReset: () => void
}

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>
const shortName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '')

// "K then a letter" opens the first file of a Course Info category.
const CATEGORY_KEYS: Array<{ key: string; category: string; label: string }> = [
  { key: 's', category: 'Syllabus', label: 'Syllabus' },
  { key: 'h', category: 'Homework', label: 'Homework' },
  { key: 'g', category: 'Guidelines', label: 'Guidelines' },
  { key: 'r', category: 'Rubric', label: 'Rubric' },
  { key: 'd', category: 'Readings', label: 'Readings' },
  { key: 'b', category: 'Books (references)', label: 'Books' },
]

export function Viewer({ files, setFiles, links, first, onReset }: Props) {
  const [path, setPath] = useState(first.path)
  const [page, setPage] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const partnerName = usePartnerName()
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserUsed, setBrowserUsed] = useState(false)
  const [categoryArmed, setCategoryArmed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [firstPrompt, setFirstPrompt] = useState<'ask' | 'pick' | 'done'>('ask')
  const [rendering, setRendering] = useState(true)
  const [renderError, setRenderError] = useState('')
  const [dismissedLinks, setDismissedLinks] = useState<string[]>([])
  const [jumpBuffer, setJumpBuffer] = useState<string | null>(null)
  const [stageSize, setStageSize] = useState('')
  // Conversion status per file path: 'busy' while LibreOffice works, or an error message.
  const [conversions, setConversions] = useState<Record<string, string>>({})
  const [tool, setToolState] = useState<Tool>('select')
  const [inkColor, setInkColor] = useState(INK_COLORS[0])
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [focusId, setFocusId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  // Where the pointer is on the slide (fractions), so ⌃⌘T can drop the text box there.
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  const current = files.find((file) => file.path === path) || files[0]
  const pageCount = current?.pageCount || 1
  const isSheet = Boolean(current && SPREADSHEET.test(current.name))
  const lectures = useMemo(() => files.filter((file) => file.category === 'Lecture').sort((a, b) => (a.lectureNumber ?? 999) - (b.lectureNumber ?? 999) || a.path.localeCompare(b.path, undefined, { numeric: true })), [files])
  const [markup, setMarkup, markupForFile] = useMarkup(current?.path || '', page)
  // Conversations are saved per slide; this is how many questions the open slide already has.
  const threads = useThreads()
  const savedQuestions = current ? threads[threadKey(current.path, page)]?.turns.length || 0 : 0
  const [fullscreen, setFullscreen] = useState(false)
  // In full screen the tools stay hidden until the cursor moves to the top edge, like Preview.
  const [toolsShown, setToolsShown] = useState(false)
  const [pageHeight, setPageHeight] = useState(540)
  const [webLinks, setWebLinks] = useState<WebLink[]>([])
  const [browserRequest, setBrowserRequest] = useState<{ url: string; id: number } | null>(null)
  // Linked slides: L starts typing "lecture slide", J follows a link, B goes back to where you were.
  const [linkEntry, setLinkEntry] = useState<string | null>(null)
  const [pickingLink, setPickingLink] = useState(false)
  const [returnStack, setReturnStack] = useState<Array<{ path: string; page: number; reason?: string }>>([])
  // The link whose "why" note is being written (right after creating it, or from its ✎ button).
  const [reasonFor, setReasonFor] = useState<{ id: string; label: string; text: string } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const visibleLinks = links.filter((link) => link.lecturePath === current?.path && link.page === page && !dismissedLinks.includes(`${link.lecturePath}|${link.page}|${link.targetPath}`))

  const open = useCallback((target: string, targetPage = 1) => {
    setPath(target)
    setPage(targetPage)
  }, [])

  // Re-fit the slide whenever the stage resizes (window resize, chat or sidebar opening).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let timer = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setStageSize(`${stage.clientWidth}x${stage.clientHeight}`), 120)
    })
    observer.observe(stage)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])

  // Confident picks get a quiet note that fades; unsure picks keep asking until answered.
  useEffect(() => {
    if (!first.confident) return
    const timer = window.setTimeout(() => setFirstPrompt((value) => (value === 'ask' ? 'done' : value)), 7000)
    return () => window.clearTimeout(timer)
  }, [first.confident])

  // The open lecture is parsed once and reused for every slide and every redraw.
  const docCache = useRef<{ file: File; doc: Promise<PdfDocument> } | null>(null)
  const shownSlide = useRef('')
  useEffect(() => () => {
    // Forget the document as well as closing it, so a later draw reopens it instead of using a closed one.
    void docCache.current?.doc.then((doc) => doc.destroy()).catch(() => {})
    docCache.current = null
    shownSlide.current = ''
  }, [])

  useEffect(() => {
    if (!current?.isPdf || !canvasRef.current) { setRendering(false); return }
    let cancelled = false
    let task: { cancel: () => void } | null = null
    const slideKey = `${current.path}#${page}`
    // Dots appear only if a new slide is slow to load. Redrawing the same slide at a new size is silent.
    const slowTimer = shownSlide.current === slideKey ? 0 : window.setTimeout(() => { if (!cancelled) setRendering(true) }, 400)
    setRenderError('')
    ;(async () => {
      try {
        if (docCache.current?.file !== current.file) {
          void docCache.current?.doc.then((old) => old.destroy()).catch(() => {})
          const file = current.file
          docCache.current = { file, doc: file.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise) }
        }
        const doc = await docCache.current.doc
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
        const base = pdfPage.getViewport({ scale: 1 })
        if (cancelled) return
        setPageHeight(base.height)
        const stage = stageRef.current
        // Leaves room under the slide for the markup toolbar.
        const scale = Math.min(((stage?.clientWidth || 900) - 48) / base.width, ((stage?.clientHeight || 600) - (fullscreen ? 48 : 112)) / base.height)
        const viewport = pdfPage.getViewport({ scale })
        const ratio = window.devicePixelRatio || 1
        // Draw off-screen first, then swap in one step, so the slide never flashes blank or half-drawn.
        const buffer = document.createElement('canvas')
        buffer.width = Math.floor(viewport.width * ratio)
        buffer.height = Math.floor(viewport.height * ratio)
        const renderTask = pdfPage.render({ canvasContext: buffer.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
        task = renderTask
        await renderTask.promise
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = buffer.width
        canvas.height = buffer.height
        // The slide is as wide as the stage's height allows; CSS caps it at the stage's width. So while a panel
        // slides open or closed the slide shrinks or grows with it, and this redraw only sharpens it.
        const heightLimit = (stage?.clientHeight || 600) - (fullscreen ? 48 : 112)
        canvas.style.width = `${Math.floor((heightLimit / base.height) * base.width)}px`
        canvas.style.height = ''
        canvas.getContext('2d')!.drawImage(buffer, 0, 0)
        shownSlide.current = slideKey
        window.clearTimeout(slowTimer)
        setRendering(false)
        // Web addresses on the slide become clickable and open in Smazy's own browser.
        void findWebLinks(pdfPage, base.width, base.height).then((found) => { if (!cancelled) setWebLinks(found) }).catch(() => {})
        // Invisible, selectable text on top of the slide: lets you select and highlight words.
        const textLayer = textLayerRef.current
        if (textLayer) {
          const fresh = document.createElement('div')
          fresh.style.setProperty('--scale-factor', String(viewport.scale))
          await new pdfjsLib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: fresh, viewport }).render()
          if (cancelled) return
          textLayer.style.setProperty('--scale-factor', String(viewport.scale))
          textLayer.replaceChildren(...Array.from(fresh.childNodes))
        }
      } catch (error) {
        if (cancelled || (error as Error)?.name === 'RenderingCancelledException') return
        window.clearTimeout(slowTimer)
        setRendering(false)
        setRenderError(`Couldn’t open ${current.name}.`)
        console.error(error)
      }
    })()
    return () => { cancelled = true; window.clearTimeout(slowTimer); task?.cancel() }
  }, [current, page, stageSize, fullscreen])

  const changePage = useCallback((delta: number) => setPage((value) => Math.max(1, Math.min(pageCount, value + delta))), [pageCount])

  const clearFocus = useCallback(() => setFocusId(null), [])
  const markupColor = tool === 'highlight' || tool === 'marker' ? highlightColor : inkColor
  const setMarkupColor = tool === 'highlight' || tool === 'marker' ? setHighlightColor : setInkColor
  const setTool = useCallback((next: Tool) => {
    window.getSelection()?.removeAllRanges()
    setToolState(next)
  }, [])

  const addTextBox = useCallback(() => {
    if (!current?.isPdf) return
    const textCount = markup.filter((item) => item.kind === 'text').length
    // Like Preview: at the pointer if it's on the slide, otherwise stacked down the right-hand side.
    const spot = pointerRef.current || { x: 0.66, y: Math.min(0.85, 0.1 + textCount * 0.08) }
    const box = makeTextBox(Math.min(0.85, spot.x), Math.min(0.92, spot.y), inkColor)
    setMarkup((list) => [...list, box])
    setFocusId(box.id)
  }, [current?.isPdf, inkColor, markup, setMarkup])

  const highlightSelection = useCallback(() => {
    if (!frameRef.current) return false
    const highlight = selectionToHighlight(frameRef.current, highlightColor)
    if (highlight) setMarkup((list) => [...list, highlight])
    return Boolean(highlight)
  }, [highlightColor, setMarkup])

  const undoMarkup = useCallback(() => setMarkup((list) => list.slice(0, -1)), [setMarkup])

  const jumpToCategory = useCallback((category: string, label: string) => {
    const matches = files.filter((file) => file.category === category)
    if (!matches.length) { setNotice(`No ${label.toLowerCase()} in this course`); return }
    // Always opens the first file; Shift+→ / Shift+← move through the rest.
    const target = matches[0]
    open(target.path)
    setNotice(matches.length > 1 ? `${label} 1 of ${matches.length}: ${shortName(target.name)}` : `${label}: ${shortName(target.name)}`)
  }, [files, open])

  const slideLinks = markup.filter((item): item is LinkNote => item.kind === 'link')
  const lectureLabel = useCallback((filePath: string) => {
    const file = files.find((item) => item.path === filePath)
    return file?.lectureNumber != null ? `Lecture ${file.lectureNumber}` : shortName(file?.name || 'Lecture')
  }, [files])

  // "L 1 12 Enter": pins a sticky note on this slide that links to Lecture 1, slide 12.
  const addLink = useCallback((entry: string) => {
    const match = entry.trim().match(/^(\d+)\s+(\d+)$/)
    if (!current || !match) { setNotice('Type the lecture number, a space, then the slide number, e.g. 1 12'); return false }
    const [lectureNumber, slideNumber] = [Number(match[1]), Number(match[2])]
    const target = lectures.find((file) => file.lectureNumber === lectureNumber)
    if (!target) { setNotice(`There is no Lecture ${lectureNumber} in this course`); return false }
    if (slideNumber < 1 || (target.pageCount > 0 && slideNumber > target.pageCount)) { setNotice(`Lecture ${lectureNumber} has ${target.pageCount} slides`); return false }
    if (target.path === current.path && slideNumber === page) { setNotice('That’s the slide you’re on'); return false }
    // At the pointer if it's on the slide, otherwise stacked down the right-hand edge.
    const spot = pointerRef.current || { x: 0.76, y: Math.min(0.85, 0.06 + slideLinks.length * 0.08) }
    const label = `Lecture ${lectureNumber} · slide ${slideNumber}`
    const link = makeLink(Math.min(0.9, spot.x), Math.min(0.92, spot.y), target.path, slideNumber, label)
    setMarkup((list) => [...list, link])
    setNotice(null)
    setReasonFor({ id: link.id, label, text: '' })
    return true
  }, [current, lectures, page, setMarkup, slideLinks.length])

  // Saves (or clears) the private note on a link. It stays hidden until you jump through the link.
  const saveReason = useCallback(() => {
    if (!reasonFor) return
    const text = reasonFor.text.trim()
    setMarkup((list) => list.map((item) => (item.id === reasonFor.id && item.kind === 'link' ? { ...item, reason: text || undefined } : item)))
    setReasonFor(null)
    setNotice(text ? `Note saved inside the link. Press J to jump and see it` : `Linked to ${reasonFor.label}. Press J to jump there`)
  }, [reasonFor, setMarkup])

  // Links are one level deep: while you're visiting a linked slide, no further links can be followed or added.
  const visiting = returnStack.length > 0
  const followLink = useCallback((link: LinkNote) => {
    if (!current) return
    if (visiting) { setNotice('You’re already inside a link. Press J to go back first'); return }
    if (!files.some((file) => file.path === link.targetPath)) { setNotice('That lecture isn’t in this course any more'); return }
    setReturnStack((stack) => [...stack, { path: current.path, page, reason: link.reason }])
    open(link.targetPath, link.targetPage)
    setNotice(`${link.label}. Press J again to go back`)
  }, [current, files, open, page, visiting])

  const goBack = useCallback(() => {
    const last = returnStack.at(-1)
    // Not inside a link: B does nothing, silently.
    if (!last) return
    setReturnStack((stack) => stack.slice(0, -1))
    open(last.path, last.page)
  }, [open, returnStack])

  // Shift+→ / Shift+← move through the other documents in the same category (e.g. every reading).
  const stepInCategory = useCallback((delta: number) => {
    if (!current) return
    const matches = files.filter((file) => file.category === current.category)
    const label = current.category === 'Books (references)' ? 'Books' : current.category
    if (matches.length < 2) { setNotice(`Only one file in ${label}`); return }
    const index = matches.findIndex((file) => file.path === current.path)
    const target = matches[(index + delta + matches.length) % matches.length]
    open(target.path)
    setNotice(`${label} ${matches.indexOf(target) + 1} of ${matches.length}: ${shortName(target.name)}`)
  }, [current, files, open])

  // F toggles the browser's full screen.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => setNotice('Full screen isn’t available in this browser'))
  }, [])
  useEffect(() => {
    const onChange = () => { setFullscreen(Boolean(document.fullscreenElement)); setToolsShown(false) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // The study partner notices good study habits. It waits until the student has paused, then looks at what was added.
  const noticed = useRef<{ key: string; highlights: number; ink: number; notes: number; links: number } | null>(null)
  useEffect(() => {
    if (!current?.isPdf || reasonFor) return
    const key = `${current.path}#${page}`
    const links = markup.filter((item) => item.kind === 'link')
    const now = {
      key,
      highlights: markup.filter((item) => item.kind === 'highlight' || (item.kind === 'ink' && item.marker)).length,
      ink: markup.filter((item) => item.kind === 'ink' && !item.marker).length,
      notes: markup.filter((item) => item.kind === 'text' && item.text.trim().length > 2).length,
      links: links.length,
    }
    if (noticed.current?.key !== key) { noticed.current = now; return }
    const timer = window.setTimeout(() => {
      const before = noticed.current
      noticed.current = now
      if (!before || before.key !== key) return
      const newest = links.at(-1)
      if (now.links > before.links && newest?.kind === 'link') praise({ kind: 'link', where: newest.label, withReason: Boolean(newest.reason?.trim()) })
      else if (now.notes > before.notes) praise({ kind: 'note' })
      else if (now.highlights > before.highlights) praise({ kind: 'highlight', count: now.highlights })
      else if (now.ink > before.ink) praise({ kind: 'ink' })
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [markup, current, page, reasonFor])

  // Reaching the last slide of a lecture by going through it is worth a word too.
  const lastPage = useRef({ path: '', page: 0 })
  useEffect(() => {
    if (!current) return
    const before = lastPage.current
    lastPage.current = { path: current.path, page }
    if (current.category === 'Lecture' && current.isPdf && pageCount > 3 && page === pageCount && before.path === current.path && before.page === pageCount - 1) {
      praise({ kind: 'finished', where: current.lectureNumber != null ? `Lecture ${current.lectureNumber}` : shortName(current.name) })
    }
  }, [current, page, pageCount])

  // Downloads the open lecture as a PDF with every highlight, drawing and text box included.
  const downloadWithMarkup = useCallback(async () => {
    if (!current?.isPdf || downloading) return
    setDownloading(true)
    try {
      const pages = markupForFile(current.path)
      const count = Object.values(pages).reduce((total, list) => total + list.length, 0)
      saveBlob(await exportWithMarkup(current.file, pages), `${shortName(current.name)} (Smazy notes).pdf`)
      praise({ kind: 'download', count })
      setNotice(count ? `Downloaded with ${count} note${count === 1 ? '' : 's'} and highlight${count === 1 ? '' : 's'}` : 'Downloaded (no markup on this file yet)')
    } catch (error) {
      console.error(error)
      setNotice('Smazy couldn’t build the download for this file')
    } finally {
      setDownloading(false)
    }
  }, [current, downloading, markupForFile])

  const closeChat = useCallback(() => {
    chatInputRef.current?.blur()
    setChatOpen(false)
  }, [])

  const openInBrowser = useCallback((url: string) => {
    setBrowserUsed(true)
    setBrowserOpen(true)
    setBrowserRequest({ url, id: Date.now() })
  }, [])

  const toggleBrowser = useCallback(() => {
    setBrowserUsed(true)
    setBrowserOpen((v) => !v)
  }, [])

  const openChat = useCallback(() => {
    setChatOpen(true)
    window.setTimeout(() => chatInputRef.current?.focus(), 50)
  }, [])

  // Keyboard: single keys are ignored while typing, so the chat box is always safe.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      // Markup shortcuts match macOS Preview: ⌃⌘T text box, ⌃⌘H highlight (Ctrl+Alt on Windows).
      const markupCombo = (event.metaKey && event.ctrlKey) || (event.ctrlKey && event.altKey && !event.metaKey)
      if (markupCombo && event.code === 'KeyT') { event.preventDefault(); addTextBox(); return }
      if (markupCombo && event.code === 'KeyH') { event.preventDefault(); if (!highlightSelection()) setTool(tool === 'highlight' ? 'select' : 'highlight'); return }
      if (markupCombo && event.code === 'KeyP') { event.preventDefault(); setTool(tool === 'pen' ? 'select' : 'pen'); return }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); undoMarkup(); return }
      // ⌘` (Ctrl+` on Windows) leaves the browser, even from its address bar.
      if (browserOpen && (event.metaKey || event.ctrlKey) && event.code === 'Backquote') { event.preventDefault(); setBrowserOpen(false); return }
      if (event.key === 'Escape') {
        if (helpOpen) setHelpOpen(false)
        else if (browserOpen) { /* Esc belongs to the web page; ⌘` closes the browser */ }
        else if (reasonFor) { setReasonFor(null); setNotice(`Linked to ${reasonFor.label}. Press J to jump there`) }
        else if (linkEntry !== null || pickingLink) { setLinkEntry(null); setPickingLink(false) }
        else if (categoryArmed || jumpBuffer !== null) { setCategoryArmed(false); setJumpBuffer(null) }
        else if (tool !== 'select' && !typing) setTool('select')
        else if (returnStack.length && !typing) goBack()
        else if (chatOpen && !typing) setChatOpen(false)
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      // "G then B" opens and closes the browser. While it covers the slide, the slide keys rest.
      if (jumpBuffer === '' && event.key.toLowerCase() === 'b') { event.preventDefault(); setJumpBuffer(null); toggleBrowser(); return }
      if (browserOpen) {
        if (event.key.toLowerCase() === 'g') setJumpBuffer('')
        else if (event.key === '/') { event.preventDefault(); if (chatOpen) closeChat(); else openChat() }
        else if (event.key === '?') setHelpOpen((v) => !v)
        return
      }
      // Typing a link: digits, one space between lecture and slide, Enter to add.
      if (linkEntry !== null) {
        event.preventDefault()
        if (event.key !== 'Enter') setNotice(null)
        if (/^\d$/.test(event.key)) setLinkEntry(linkEntry + event.key)
        else if (event.key === ' ' && /^\d+$/.test(linkEntry)) setLinkEntry(`${linkEntry} `)
        else if (event.key === 'Backspace') setLinkEntry(linkEntry.slice(0, -1))
        else if (event.key === 'Enter') { if (addLink(linkEntry)) setLinkEntry(null) }
        // L again cancels, the same key that started it.
        else if (event.key.toLowerCase() === 'l') { setLinkEntry(null); setNotice(null) }
        return
      }
      if (pickingLink) {
        setPickingLink(false)
        // J again (or any non-number key) cancels the choice.
        if (event.key.toLowerCase() === 'j') { event.preventDefault(); return }
        const chosen = slideLinks[Number(event.key) - 1]
        if (/^\d$/.test(event.key) && chosen) { event.preventDefault(); followLink(chosen); return }
      }
      if (jumpBuffer !== null && /^\d$/.test(event.key)) { setJumpBuffer(jumpBuffer + event.key); return }
      if (categoryArmed) {
        const choice = CATEGORY_KEYS.find((item) => item.key === event.key.toLowerCase())
        setCategoryArmed(false)
        if (choice) { event.preventDefault(); jumpToCategory(choice.category, choice.label); return }
      }
      if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); stepInCategory(event.key === 'ArrowRight' ? 1 : -1); return }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); changePage(1) }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); changePage(-1) }
      else if (event.key === '/') { event.preventDefault(); if (chatOpen) closeChat(); else openChat() }
      else if (event.key.toLowerCase() === 'k') { setJumpBuffer(null); setCategoryArmed(true) }
      else if (event.key.toLowerCase() === 'g') { setCategoryArmed(false); setJumpBuffer('') }
      else if (event.key === '?') setHelpOpen((v) => !v)
      else if (event.key.toLowerCase() === 'f') toggleFullscreen()
      else if (event.key.toLowerCase() === 'l') {
        setCategoryArmed(false); setJumpBuffer(null)
        if (visiting) setNotice('You’re inside a link. Press J to go back before adding a link')
        else if (current?.category === 'Lecture' && current.isPdf) { setNotice(null); setLinkEntry('') }
        else setNotice('Slide links work on lecture slides')
      }
      else if (event.key.toLowerCase() === 'j') {
        // J is a toggle: jump to the linked slide, then J again to come back.
        if (visiting) goBack()
        else if (slideLinks.length === 0) setNotice(current?.category === 'Lecture' ? 'No links on this slide. Press L to add one' : 'Slide links work on lecture slides')
        else if (slideLinks.length === 1) followLink(slideLinks[0])
        else setPickingLink(true)
      }
      else if (event.key.toLowerCase() === 'b') goBack()
      // ` (backtick) opens and closes the course file list; [ still works too.
      else if (event.key === '`' || event.code === 'Backquote' || event.key === '[') setSidebarOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addTextBox, categoryArmed, changePage, chatOpen, helpOpen, highlightSelection, jumpBuffer, jumpToCategory, openChat, setTool, stepInCategory, toggleFullscreen, tool, undoMarkup, addLink, current, followLink, goBack, linkEntry, pickingLink, returnStack.length, slideLinks, reasonFor, browserOpen, toggleBrowser, closeChat])

  // K waits briefly for its letter; notices fade on their own.
  useEffect(() => {
    if (!categoryArmed) return
    const timer = window.setTimeout(() => setCategoryArmed(false), 2500)
    return () => window.clearTimeout(timer)
  }, [categoryArmed])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timer)
  }, [notice])

  // "G then 2" jumps to Lecture 2.
  useEffect(() => {
    if (jumpBuffer === null) return
    const timer = window.setTimeout(() => {
      const target = lectures.find((file) => file.lectureNumber === Number(jumpBuffer))
      if (jumpBuffer && target) open(target.path)
      setJumpBuffer(null)
    }, jumpBuffer ? 600 : 1500)
    return () => window.clearTimeout(timer)
  }, [jumpBuffer, lectures, open])

  const convert = useCallback((record: CourseFile) => {
    setConversions((items) => ({ ...items, [record.path]: 'busy' }))
    makeViewable(record)
      .then((viewable) => {
        setFiles((items) => items.map((file) => (file.path === record.path ? viewable : file)))
        setConversions((items) => { const { [record.path]: _done, ...rest } = items; return rest })
      })
      .catch((error: Error) => setConversions((items) => ({ ...items, [record.path]: error.message })))
  }, [setFiles])

  // Convert the open PowerPoint, then get the next lecture ready in the background.
  useEffect(() => {
    if (!current) return
    if (!current.isPdf && CONVERTIBLE.test(current.name) && !conversions[current.path]) { convert(current); return }
    if (!current.isPdf) return
    const position = lectures.findIndex((file) => file.path === current.path)
    const next = position >= 0 ? lectures[position + 1] : undefined
    if (next && !next.isPdf && CONVERTIBLE.test(next.name) && !conversions[next.path]) convert(next)
  }, [current, lectures, conversions, convert])

  const moveFile = (filePath: string, category: string) =>
    setFiles((items) => items.map((file) => (file.path === filePath ? { ...file, category, group: groupOf(category), tag: category === 'Books (references)' ? 'Book' : category } : file)))

  const courseFiles = useMemo(() => files.map((file) => ({ path: file.path, label: file.category === 'Lecture' && file.lectureNumber != null ? `Lecture ${file.lectureNumber} · ${shortName(file.name)}` : `${file.category} · ${shortName(file.name)}` })), [files])

  const getContext = useCallback(() => ({
    files: files.map((file) => `${file.group} / ${file.category}: ${file.path}`),
    fileName: current ? shortName(current.name) : undefined,
    page,
    slideText: current?.pages[page - 1] || '',
    fileText: current?.pages.map((text, index) => `[slide ${index + 1}] ${text}`).join('\n') || '',
  }), [current, files, page])

  if (!current) return null
  const firstFile = files.find((file) => file.path === first.path)

  return (
    <div
      className={`viewer-shell ${chatOpen ? 'chat-open' : ''} ${sidebarOpen ? 'sidebar-open' : ''} ${fullscreen ? 'fullscreen' : ''} ${fullscreen && toolsShown ? 'tools-shown' : ''}`}
      onMouseMove={fullscreen ? (event) => {
        // Reveal near the top edge; stay open while the cursor is over the bars.
        // Not over the chat panel: that's the chat's own space, and its tabs and close button sit at the top.
        // Judged by position, because once the bar is showing it covers the top of the chat.
        const chatLeft = chatOpen ? event.currentTarget.querySelector('.chat-panel')?.getBoundingClientRect().left : undefined
        const overChat = chatLeft !== undefined && event.clientX >= chatLeft
        // The study partner sits in the top-right corner: reaching for it shouldn't pull the tools down over it.
        const overPartner = !chatOpen && !toolsShown && event.clientX > window.innerWidth - 130
        const show = !overChat && !overPartner && !browserOpen && event.clientY < (toolsShown ? 132 : 44)
        if (show !== toolsShown) setToolsShown(show)
      } : undefined}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button" onClick={() => setSidebarOpen((v) => !v)} title="Course files ( ` )">☰</button>
          <button className="wordmark" onClick={onReset} title="Upload a different course"><span className="wordmark-dot" />smazy</button>
        </div>
        <div className="topbar-center">
          <span className="crumb">{current.group} › {current.category}</span>
          <strong title={current.path}>{shortName(current.name)}</strong>
          {current.isPdf && <span className="slide-count">{page} / {pageCount}</span>}
          {isSheet && pageCount > 1 && <span className="slide-count">sheet {page} / {pageCount}</span>}
        </div>
        <div className="topbar-right">
          {current.isPdf && <button className="quiet-button" onClick={() => void downloadWithMarkup()} disabled={downloading} title="Download this file as a PDF with your highlights, drawings and text boxes">{downloading ? 'Preparing…' : '⤓ Download'}</button>}
          <button className={`quiet-button ${fullscreen ? 'active' : ''}`} onClick={toggleFullscreen} title="Full screen (F)">{fullscreen ? 'Exit full screen' : 'Full screen'} <kbd>F</kbd></button>
          <button className={`quiet-button ${browserOpen ? 'active' : ''}`} onClick={toggleBrowser} title="Search the web without leaving Smazy (G then B)">Browser <kbd>G</kbd> <kbd>B</kbd></button>
          <button className={`quiet-button ${helpOpen ? 'active' : ''}`} onClick={() => setHelpOpen((v) => !v)}>Shortcuts <kbd>?</kbd></button>
          <button className={`quiet-button ${chatOpen ? 'active' : ''}`} onClick={() => (chatOpen ? closeChat() : openChat())} title={`Talk to ${partnerName}, your study partner`}>Study Partner <kbd>/</kbd></button>
        </div>
      </header>

      <aside className="sidebar">
        {(['Learn', 'Course Info'] as Group[]).map((group) => (
          <section key={group} className="sidebar-group">
            <h2>{group}<span>{files.filter((file) => file.group === group).length}</span></h2>
            {CATEGORIES[group].map((category) => {
              const items = files.filter((file) => file.category === category)
              return (
                <div key={category} className="sidebar-category">
                  <h3>{category}</h3>
                  {items.length === 0 && <p className="empty-category">Nothing here</p>}
                  {items.map((file) => (
                    <div key={file.path} className={`file-row ${file.path === current.path ? 'selected' : ''}`}>
                      <button className="file-open" onClick={() => open(file.path)} title={file.path}>
                        <span className="file-name">{shortName(file.name)}</span>
                        {file.tag !== category && <small>{file.tag}</small>}
                      </button>
                      <select className="file-move" value={file.category} onChange={(event) => moveFile(file.path, event.target.value)} title="Wrong place? Move it">
                        {(['Learn', 'Course Info'] as Group[]).map((g) => (
                          <optgroup key={g} label={g}>{CATEGORIES[g].map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )
            })}
          </section>
        ))}
      </aside>

      <main className="stage" ref={stageRef}>
        {firstPrompt !== 'done' && firstFile && current.path === first.path && page === 1 && (
          <div className={`first-banner ${first.confident ? '' : 'unsure'}`} role="status">
            {firstPrompt === 'ask' ? (
              <>
                <span>✦ {first.confident ? 'Starting with your first lecture' : 'Is this the right first lecture?'} <b>{shortName(firstFile.name)}</b></span>
                <button onClick={() => setFirstPrompt('done')}>{first.confident ? 'Got it' : 'Yes'}</button>
                <button onClick={() => setFirstPrompt('pick')}>Pick another</button>
              </>
            ) : (
              <>
                <span>Start with:</span>
                {lectures.filter((file) => file.path !== first.path).slice(0, 4).map((file) => (
                  <button key={file.path} onClick={() => { open(file.path); setFirstPrompt('done') }}>{shortName(file.name)}</button>
                ))}
                <button onClick={() => { setSidebarOpen(true); setFirstPrompt('done') }}>Browse all…</button>
              </>
            )}
          </div>
        )}

        {isSheet ? (
          <SheetView key={current.path} file={current.file} sheetIndex={page - 1} onSheetChange={(index) => setPage(index + 1)} />
        ) : (
        <div
          className="slide-frame"
          ref={frameRef}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            pointerRef.current = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
          }}
          onPointerLeave={() => { pointerRef.current = null }}
          onMouseUp={() => { if (tool === 'highlight') highlightSelection() }}
        >
          {current.isPdf ? (
            <>
              <canvas ref={canvasRef} className={rendering ? 'loading' : ''} />
              <div ref={textLayerRef} className={`textLayer ${tool === 'select' || tool === 'highlight' ? '' : 'inactive'} ${tool === 'highlight' ? 'highlighting-text' : ''}`} />
              {tool === 'select' && shownSlide.current === `${current.path}#${page}` && webLinks.map((link, index) => (
                <a
                  key={index}
                  className="web-link"
                  href={link.url}
                  title={`Open in the Smazy browser: ${link.url}`}
                  style={{ left: `${link.x * 100}%`, top: `${link.y * 100}%`, width: `${link.w * 100}%`, height: `${link.h * 100}%` }}
                  onClick={(event) => { event.preventDefault(); openInBrowser(link.url) }}
                />
              ))}
              <MarkupLayer
                key={`${current.path}#${page}`}
                annotations={markup}
                setAnnotations={setMarkup}
                tool={tool}
                setTool={setTool}
                color={markupColor}
                focusId={focusId}
                clearFocus={clearFocus}
                onTextBoxCreated={setFocusId}
                pageHeight={pageHeight}
                onFollowLink={followLink}
                pickingLink={pickingLink}
                onEditLinkReason={(link) => setReasonFor({ id: link.id, label: link.label, text: link.reason || '' })}
                renderLinkPreview={(link) => {
                  const target = files.find((file) => file.path === link.targetPath)
                  return (
                    <>
                      <strong>{link.label}</strong>
                      <small>{target ? shortName(target.name) : 'Lecture not found'}</small>
                      {target?.isPdf ? <SlideThumb file={target.file} page={link.targetPage} /> : target ? <p>This PowerPoint lecture opens when you jump to it.</p> : null}
                      <small>Click or press J to jump</small>
                    </>
                  )
                }}
              />
              {rendering && <div className="slide-status"><span className="typing"><i /><i /><i /></span></div>}
              {renderError && <div className="slide-status">{renderError}</div>}
            </>
          ) : (
            <div className="no-preview">
              <strong>{current.name}</strong>
              {conversions[current.path] === 'busy'
                ? <p><span className="typing"><i /><i /><i /></span><br />Turning the slides into pages… this takes a few seconds.</p>
                : conversions[current.path]
                  ? <><p>{conversions[current.path]}</p><button className="text-button" onClick={() => convert(current)}>Try again</button></>
                  : <p>This file type can’t be shown as slides. Smazy still sorted it for you, and you can open it on your computer.</p>}
            </div>
          )}
          {visibleLinks.length > 0 && (
            <div className="link-chips">
              {visibleLinks.map((link) => {
                const target = files.find((file) => file.path === link.targetPath)
                const key = `${link.lecturePath}|${link.page}|${link.targetPath}`
                return (
                  <span key={key} className="link-chip">
                    <button onClick={() => open(link.targetPath)} title={`Opens ${target?.name || link.targetPath}`}>↗ {link.label}</button>
                    <button className="chip-x" title="Remove this link" onClick={() => setDismissedLinks((items) => [...items, key])}>×</button>
                  </span>
                )
              })}
            </div>
          )}
        </div>
        )}

        {current.isPdf && pageCount > 1 && (
          <>
            <button className="nav-button left" onClick={() => changePage(-1)} disabled={page <= 1} aria-label="Previous slide">‹</button>
            <button className="nav-button right" onClick={() => changePage(1)} disabled={page >= pageCount} aria-label="Next slide">›</button>
            <div className="progress-track"><div style={{ width: `${(page / pageCount) * 100}%` }} /></div>
          </>
        )}
        {current.isPdf && (
          <MarkupToolbar tool={tool} setTool={setTool} color={markupColor} setColor={setMarkupColor} onUndo={undoMarkup} onClear={() => setMarkup(() => [])} canUndo={markup.length > 0} />
        )}
        {!chatOpen && <Companion name={partnerName} slideKey={`${current.path}#${page}`} earlier={savedQuestions} onOpen={openChat} />}
        {jumpBuffer !== null && <div className="jump-toast">Go to lecture <b>{jumpBuffer || '…'}</b>{!jumpBuffer && <span className="toast-hint"> · <kbd>B</kbd> browser</span>}</div>}
        {linkEntry !== null && (
          <div className="jump-toast category-toast">
            <span>Link this slide to</span>
            <span>Lecture <kbd>{linkEntry.split(' ')[0] || '…'}</kbd></span>
            <span>slide <kbd>{linkEntry.includes(' ') ? linkEntry.split(' ')[1] || '…' : '…'}</kbd></span>
            {notice
              ? <span className="toast-error">{notice}</span>
              : <span className="toast-hint">{linkEntry.includes(' ') ? 'Enter to add' : 'Space, then the slide number'} · L or Esc cancels</span>}
          </div>
        )}
        {pickingLink && (
          <div className="jump-toast category-toast">
            <span>Press a number to jump · J cancels</span>
            {slideLinks.slice(0, 9).map((link, index) => <span key={link.id}><kbd>{index + 1}</kbd> {link.label}{link.reason && <em className="toast-reason"> “{link.reason.length > 34 ? `${link.reason.slice(0, 34)}…` : link.reason}”</em>}</span>)}
          </div>
        )}
        {reasonFor && (
          <form className="jump-toast reason-prompt" onSubmit={(event) => { event.preventDefault(); saveReason() }}>
            <label htmlFor="link-reason">Why link to {reasonFor.label}?</label>
            <input
              id="link-reason"
              autoFocus
              value={reasonFor.text}
              maxLength={300}
              placeholder="e.g. same formula, explained more simply here"
              onChange={(event) => setReasonFor({ ...reasonFor, text: event.target.value })}
            />
            <span className="toast-hint">Enter saves · Esc skips</span>
          </form>
        )}
        {returnStack.length > 0 && returnStack.at(-1)!.reason && (
          <div className="link-reason-card" role="note">
            <span className="eyebrow">Why you linked this</span>
            <p>{returnStack.at(-1)!.reason}</p>
          </div>
        )}
        {returnStack.length > 0 && (
          <button className="back-pill" onClick={goBack} title="Go back to the slide you came from (J, B or Esc)">
            ← Back to {lectureLabel(returnStack.at(-1)!.path)} · slide {returnStack.at(-1)!.page} <kbd>J</kbd>
          </button>
        )}
        {categoryArmed && (
          <div className="jump-toast category-toast">
            <span>Open</span>
            {CATEGORY_KEYS.map((item) => <span key={item.key}><kbd>{item.key.toUpperCase()}</kbd> {item.label}</span>)}
          </div>
        )}
        {notice && !categoryArmed && jumpBuffer === null && linkEntry === null && !pickingLink && !reasonFor && <div className="jump-toast">{notice}</div>}
      </main>

      {browserUsed && <BrowserLayer open={browserOpen} onClose={() => setBrowserOpen(false)} request={browserRequest} />}

      <ChatPanel open={chatOpen} onClose={closeChat} inputRef={chatInputRef} getContext={getContext} location={current.isPdf || isSheet ? { path: current.path, fileName: shortName(current.name), page, unit: isSheet ? 'sheet' : 'slide' } : null} courseFiles={courseFiles} onOpenLink={openInBrowser} />

      {helpOpen && <ShortcutsGuide onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

// Web addresses on a slide, as fractions of the page: real PDF hyperlinks first, then addresses that are only typed out.
type WebLink = { url: string; x: number; y: number; w: number; h: number }
const WEB_ADDRESS = /(?:https?:\/\/|www\.)[^\s<>"'()]+/gi
async function findWebLinks(pdfPage: PdfPage, pageWidth: number, pageHeight: number): Promise<WebLink[]> {
  const viewport = pdfPage.getViewport({ scale: 1 })
  const place = (url: string, rect: number[]): WebLink => {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect)
    return { url, x: Math.min(x1, x2) / pageWidth, y: Math.min(y1, y2) / pageHeight, w: Math.abs(x2 - x1) / pageWidth, h: Math.abs(y2 - y1) / pageHeight }
  }
  const links: WebLink[] = []
  for (const note of await pdfPage.getAnnotations()) {
    const url = note.subtype === 'Link' ? (note.url || note.unsafeUrl) : undefined
    if (typeof url === 'string' && /^https?:\/\//i.test(url) && Array.isArray(note.rect)) links.push(place(url, note.rect))
  }
  const covered = (link: WebLink) => links.some((other) => link.x + link.w / 2 >= other.x && link.x + link.w / 2 <= other.x + other.w && link.y + link.h / 2 >= other.y && link.y + link.h / 2 <= other.y + other.h)
  const text = await pdfPage.getTextContent()
  for (const item of text.items) {
    if (!('str' in item) || !item.str || !item.width) continue
    for (const match of item.str.matchAll(WEB_ADDRESS)) {
      const address = match[0].replace(/[.,;:!?\]]+$/, '')
      if (address.length < 8 && !address.includes('.')) continue
      // Position within the line of text, by share of its characters.
      const from = (match.index || 0) / item.str.length
      const share = address.length / item.str.length
      const [, , , , x, y] = item.transform
      const height = item.height || 10
      const link = place(/^www\./i.test(address) ? `https://${address}` : address, [x + item.width * from, y - height * 0.2, x + item.width * (from + share), y + height])
      if (!covered(link)) links.push(link)
    }
  }
  return links
}

// Small picture of another slide, shown when hovering over a link note.
const thumbDocs = new Map<File, Promise<PdfDocument>>()
function SlideThumb({ file, page }: { file: File; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    if (!thumbDocs.has(file)) {
      if (thumbDocs.size >= 3) thumbDocs.delete(thumbDocs.keys().next().value as File)
      thumbDocs.set(file, file.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise))
    }
    void thumbDocs.get(file)!.then(async (doc) => {
      const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: (280 / base.width) * (window.devicePixelRatio || 1) })
      const buffer = document.createElement('canvas')
      buffer.width = Math.floor(viewport.width)
      buffer.height = Math.floor(viewport.height)
      await pdfPage.render({ canvasContext: buffer.getContext('2d')!, viewport }).promise
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      canvas.width = buffer.width
      canvas.height = buffer.height
      canvas.getContext('2d')!.drawImage(buffer, 0, 0)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [file, page])
  return <canvas ref={canvasRef} className="slide-thumb" />
}

function ShortcutsGuide({ onClose }: { onClose: () => void }) {
  const sections: Array<{ title: string; rows: Array<[string[], string]> }> = [
    { title: 'Slides', rows: [[['←', '→'], 'Previous / next slide'], [['Space'], 'Next slide'], [['G', '2'], 'Go to Lecture 2 (any number)'], [['`'], 'Show / hide the course files (top left)']] },
    { title: 'Course Info', rows: CATEGORY_KEYS.map((item) => [['K', item.key.toUpperCase()], `Open ${item.label}${item.key === 'b' ? ' (references)' : ''}`] as [string[], string]).concat([[['Shift', '→'], 'Next document in the same category'], [['Shift', '←'], 'Previous document in the same category']]) },
    { title: 'Linked slides (lectures)', rows: [[['L', '1', 'Space', '12', '↵'], 'Link this slide to Lecture 1, slide 12'], [['L'], 'Press L again to cancel a link you’ve started'], [['J'], 'Jump to the linked slide and see your note on it'], [['J'], 'Press again to come back (or B / Esc)']] },
    { title: 'Markup', rows: [[['⌃', '⌘', 'T'], 'Add a text box'], [['⌃', '⌘', 'H'], 'Highlight selected text'], [['⌃', '⌘', 'P'], 'Pen on / off'], [['⌘', 'Z'], 'Undo last markup'], [['Esc'], 'Back to the pointer']] },
    { title: 'Study Partner', rows: [[['/'], 'Open / close your study partner (types a slash once you’ve started a message)'], [['Tab'], 'With your study partner: conversation ↔ this slide’s history tree'], [['Enter'], 'Choose the answer length, then Enter again to send'], [['←', '→'], 'Quick (key point) / Deep (full explanation)'], [['Shift', 'Enter'], 'New line']] },
    { title: 'General', rows: [[['F'], 'Full screen on / off'], [['G', 'B'], 'Open the web browser'], [['⌘', '`'], 'Close the web browser and return to your slide'], [['?'], 'Show / hide this guide'], [['Esc'], 'Close']] },
  ]
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="shortcuts-guide" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">User manual</span><h2>Keyboard shortcuts</h2></div>
          <button className="icon-button" onClick={onClose} title="Close (Esc)">×</button>
        </header>
        <div className="shortcut-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.rows.map(([keys, label]) => (
                <div key={label} className="shortcut-row">
                  <span className="shortcut-keys">{keys.map((key, i) => <kbd key={i}>{key}</kbd>)}</span>
                  <span>{label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer>Single-key shortcuts pause while you type to your study partner or in a text box. On Windows, use Ctrl+Alt in place of ⌃⌘.</footer>
      </div>
    </div>
  )
}
