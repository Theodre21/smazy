import { useCallback, useEffect, useRef, useState } from 'react'

// A mini web browser inside Smazy (G then B), so looking something up doesn't mean leaving the study desk.
// Pages are loaded through Smazy's server, because most websites refuse to be shown inside another page.
const SEARCH = 'https://html.duckduckgo.com/html/?q='
const STARTERS: Array<[string, string]> = [
  ['Wikipedia', 'https://en.wikipedia.org'],
  ['Project Gutenberg', 'https://www.gutenberg.org'],
  ['arXiv', 'https://arxiv.org'],
  ['Wiktionary', 'https://en.wiktionary.org'],
]

// What the student typed: an address if it looks like one, otherwise a search.
export function toAddress(text: string) {
  const entry = text.trim()
  if (!entry) return null
  if (/^https?:\/\//i.test(entry)) return entry
  if (!/\s/.test(entry) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(entry)) return `https://${entry}`
  return SEARCH + encodeURIComponent(entry)
}

// Show a search as the words searched for, not as a long address.
function display(url: string) {
  if (url.startsWith(SEARCH)) { try { return decodeURIComponent(url.slice(SEARCH.length).replace(/\+/g, ' ')) } catch { /* show the address */ } }
  return url
}

export function BrowserLayer({ open, onClose, request }: { open: boolean; onClose: () => void; request?: { url: string; id: number } | null }) {
  const [trail, setTrail] = useState<string[]>([])
  const [position, setPosition] = useState(-1)
  const [reload, setReload] = useState(0)
  const [entry, setEntry] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLInputElement>(null)
  const url = position >= 0 ? trail[position] : null

  const visit = useCallback((next: string) => {
    setTrail((items) => [...items.slice(0, position + 1), next])
    setPosition(position + 1)
    setEntry(display(next))
    setTitle('')
    setLoading(true)
  }, [position])

  // A link clicked on a slide or in the chat opens here.
  const requestId = request?.id
  useEffect(() => {
    if (request) visit(request.url)
  }, [requestId]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (by: number) => {
    const next = position + by
    if (next < -1 || next >= trail.length) return
    setPosition(next)
    setEntry(next >= 0 ? display(trail[next]) : '')
    setTitle('')
    setLoading(next >= 0)
  }

  const submit = (text: string) => {
    const next = toAddress(text)
    if (next) visit(next)
  }

  // The framed page reports what loaded and asks Smazy to follow its links.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !event.data?.smazyBrowser) return
      const message = event.data as { type: string; url?: string; title?: string }
      if (message.type === 'navigate' && message.url) visit(message.url)
      else if (message.type === 'close') onClose()
      else if (message.type === 'loaded') {
        setLoading(false)
        setTitle(message.title || '')
        // After a redirect, show where the page really ended up.
        if (message.url && message.url !== url) {
          setTrail((items) => items.map((item, index) => (index === position ? message.url! : item)))
          setEntry(display(message.url))
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onClose, position, url, visit])

  // Opening puts the cursor in the address bar; closing hands the keyboard back to Smazy.
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => { const input = url ? addressRef.current : startRef.current; input?.focus(); input?.select() }, 60)
      return () => window.clearTimeout(timer)
    }
    if (document.activeElement === frameRef.current || document.activeElement === addressRef.current || document.activeElement === startRef.current) (document.activeElement as HTMLElement).blur()
    window.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={`browser-layer ${open ? 'open' : ''}`} aria-label="Web browser" aria-hidden={!open}>
      <header className="browser-bar">
        <button className="icon-button" onClick={() => step(-1)} disabled={position < 0} title="Back">‹</button>
        <button className="icon-button" onClick={() => step(1)} disabled={position >= trail.length - 1} title="Forward">›</button>
        <button className="icon-button" onClick={() => { if (url) { setLoading(true); setReload((n) => n + 1) } }} disabled={!url} title="Reload">⟳</button>
        <form className="browser-address" onSubmit={(event) => { event.preventDefault(); submit(entry); addressRef.current?.blur() }}>
          <span className="browser-glyph">{loading ? <i className="browser-spinner" /> : '⌕'}</span>
          <input ref={addressRef} value={entry} onChange={(event) => setEntry(event.target.value)} onFocus={(event) => event.target.select()} placeholder="Search the web or type an address" spellCheck={false} autoComplete="off" aria-label="Search or address" />
        </form>
        {url && <a className="icon-button" href={url} target="_blank" rel="noreferrer" title="Open in a normal browser tab">↗</a>}
        <button className="icon-button" onClick={onClose} title="Close the browser (⌘ `)">×</button>
      </header>
      {title && <p className="browser-title" title={title}>{title}</p>}
      {url ? (
        // Sandboxed without same-origin: pages can run, but can't reach Smazy's own notes and chats.
        <iframe ref={frameRef} key={`${position}-${reload}`} className="browser-frame" src={`/api/browse?url=${encodeURIComponent(url)}`} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" title={title || 'Web page'} onLoad={() => setLoading(false)} />
      ) : (
        <div className="browser-start">
          <span className="eyebrow">Smazy browser</span>
          <h2>Look something up without leaving your slide</h2>
          <form onSubmit={(event) => { event.preventDefault(); submit(entry) }}>
            <input ref={startRef} value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="Search the web or type an address" spellCheck={false} autoComplete="off" aria-label="Search or address" />
            <button className="primary-button" type="submit">Search</button>
          </form>
          <div className="browser-starters">
            {STARTERS.map(([name, address]) => <button key={name} className="quiet-button" onClick={() => visit(address)}>{name}</button>)}
          </div>
          <p className="browser-hint"><kbd>⌘</kbd> <kbd>`</kbd> closes the browser and brings you back to your slide. <kbd>G</kbd> <kbd>B</kbd> opens it again where you left off.</p>
        </div>
      )}
    </section>
  )
}
