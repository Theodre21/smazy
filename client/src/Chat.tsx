import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { health, placeQuestion, streamChat } from './api'
import type { AnswerStyle, ChatContext, ChatStatus } from './api'
import { depthOf, threadKey, updateThread, useThreads } from './threads'
import type { Turn } from './threads'
import { useDictation, useReadAloud } from './Voice'
import { HistoryTree } from './HistoryTree'

const SUGGESTIONS = ['Explain this slide like I’m new to it', 'Quiz me on this slide', 'Summarize this lecture in 5 bullets', 'What should I know before the exam?']
const firstWords = (text: string) => {
  const words = text.replace(/[?.!]+$/, '').split(/\s+/)
  return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '')
}

type Props = {
  open: boolean
  onClose: () => void
  inputRef: RefObject<HTMLTextAreaElement>
  getContext: () => ChatContext
  // The slide (or sheet) the chat is pinned to.
  location: { path: string; fileName: string; page: number; unit?: string } | null
  // Files of the open course, used to label the history (e.g. "Lecture 3 · L3_students").
  courseFiles: Array<{ path: string; label: string }>
}

export function ChatPanel({ open, onClose, inputRef, getContext, location, courseFiles }: Props) {
  const threads = useThreads()
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<ChatStatus | 'unknown'>('unknown')
  const [focusTurn, setFocusTurn] = useState<string | null>(null)
  // After Enter, the student picks the answer length with ← → before the question is sent. Quick is preselected.
  const [choosing, setChoosing] = useState<AnswerStyle | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dictation = useDictation(setDraft)
  const readAloud = useReadAloud()

  const unit = location?.unit || 'slide'
  const key = location ? threadKey(location.path, location.page) : ''
  const turns = (key && threads[key]?.turns) || []

  // Closing the chat also stops the microphone and any read-aloud.
  useEffect(() => { if (!open) { dictation.stop(); if (readAloud.speaking !== null) window.speechSynthesis.cancel() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // Checked each time the chat opens, so a key added to .env shows up without reloading.
  useEffect(() => { if (open) health().then((h) => setStatus(h.chat)).catch(() => setStatus(null)) }, [open])
  // Moving to another slide ends the reply in progress there and shows that slide's own conversation.
  useEffect(() => { abortRef.current?.abort() }, [key])
  useEffect(() => {
    if (view !== 'chat') return
    if (focusTurn) {
      document.getElementById(`turn-${focusTurn}`)?.scrollIntoView({ block: 'start' })
      setFocusTurn(null)
    } else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [key, view, turns.length, turns.at(-1)?.answer]) // eslint-disable-line react-hooks/exhaustive-deps
  // The message box grows with its text (up to 180px). It is re-measured whenever its width changes,
  // e.g. while the panel slides open, since a narrow box measures too tall.
  useEffect(() => {
    const box = inputRef.current
    if (!box) return
    const fit = () => {
      box.style.height = 'auto'
      box.style.height = `${Math.min(box.scrollHeight, 180)}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box.parentElement || box)
    return () => observer.disconnect()
  }, [draft, inputRef, view])

  const showHistory = () => { setView('history'); window.setTimeout(() => panelRef.current?.focus(), 0) }
  const showChat = () => { setView('chat'); window.setTimeout(() => inputRef.current?.focus(), 0) }

  // options.deepen: "Go deeper" on an earlier answer. It is filed straight under that answer as a branch.
  const send = async (text: string, style: AnswerStyle = 'quick', options?: { deepen: Turn }) => {
    const question = text.trim()
    if (!question || streaming || !location) return
    dictation.stop()
    setChoosing(null)
    const seed = { path: location.path, page: location.page, fileName: location.fileName, unit }
    const earlier = turns
    const turn: Turn = options
      ? { id: crypto.randomUUID(), question, answer: '', parentId: options.deepen.id, title: `Deeper: ${options.deepen.title}`.slice(0, 60), createdAt: Date.now(), style, deepens: options.deepen.id, kind: 'how' }
      : { id: crypto.randomUUID(), question, answer: '', parentId: null, title: firstWords(question), createdAt: Date.now(), style }
    const edit = (change: (item: Turn) => Turn) => updateThread(key, seed, (list) => list.map((item) => (item.id === turn.id ? change(item) : item)))
    updateThread(key, seed, (list) => [...list, turn])
    setDraft('')
    setStreaming(true)

    // While the answer streams, the model decides whether this is a new topic or a branch off an earlier answer.
    if (options) { /* already placed under the answer it deepens */ } else if (earlier.length) {
      void placeQuestion(question, earlier.map(({ title, question: q, answer }) => ({ title, question: q, answer })))
        .then((placed) => edit((item) => ({ ...item, title: placed.title || item.title, kind: placed.kind, parentId: earlier[placed.parent]?.id || null })))
        .catch(() => {})
    } else {
      void placeQuestion(question, []).then((placed) => edit((item) => ({ ...item, title: placed.title || item.title, kind: placed.kind }))).catch(() => {})
    }

    const controller = new AbortController()
    abortRef.current = controller
    const asked = options ? `Go deeper on your answer to: “${options.deepen.question}”. Explain it fully.` : question
    const history = [...earlier.filter((item) => item.answer).flatMap((item) => [{ role: 'user' as const, content: item.question }, { role: 'assistant' as const, content: item.answer }]), { role: 'user' as const, content: asked }]
    let received = ''
    const setReply = (answer: string) => { received = answer; edit((item) => ({ ...item, answer })) }
    try {
      await streamChat(history, getContext(), setReply, controller.signal, style)
    } catch (error) {
      if (!controller.signal.aborted) setReply(`_Couldn’t get a reply: ${(error as Error).message}. Is the Smazy server running?_`)
      // Stopped (or the slide changed) before any text arrived: don't leave the answer loading forever.
      else if (!received) setReply('_Stopped before answering._')
    } finally {
      setStreaming(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  // ★ Save: marks a question as important, so it stands out in the history tree.
  const toggleSaved = (turn: Turn) => { if (location) updateThread(key, { path: location.path, page: location.page, fileName: location.fileName, unit }, (list) => list.map((item) => (item.id === turn.id ? { ...item, saved: !item.saved } : item))) }

  const clearSlide = () => { if (location) updateThread(key, { path: location.path, page: location.page, fileName: location.fileName, unit }, () => []) }

  // History shows only the slide you're on: its questions as a tree, follow-ups branching under them.
  const slideThread = key ? threads[key] : undefined
  const fileLabel = courseFiles.find((file) => file.path === location?.path)?.label || location?.fileName || ''

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={`chat-panel ${open ? 'open' : ''}`}
      aria-hidden={!open}
      onKeyDown={(event) => {
        // Tab flips between this slide's chat and the history of all slides.
        if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); if (view === 'chat') showHistory(); else showChat() }
        else if (event.key === 'Escape' && view === 'history') { event.preventDefault(); event.nativeEvent.stopImmediatePropagation(); showChat() }
      }}
    >
      <header className="chat-header">
        <div className="chat-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'chat'} className={view === 'chat' ? 'active' : ''} onClick={showChat}>
            {location ? `This ${unit}` : 'Chat'}{turns.length > 0 && <b>{turns.length}</b>}
          </button>
          <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={showHistory} title={`This ${unit}’s questions as a tree (Tab)`}>
            History <kbd>Tab</kbd>
          </button>
        </div>
        <span className={`chat-status ${status && status !== 'unknown' ? 'live' : ''}`} title={status && status !== 'unknown' ? `${status.model} via ${status.via}` : 'No chat model connected: replies are samples'}>
          {status === 'unknown' ? '' : status ? status.label : 'Sample replies'}
        </span>
        <div className="chat-header-actions">
          <button className="icon-button" onClick={onClose} title="Close chat (/ or Esc)">×</button>
        </div>
      </header>

      {view === 'history' ? (
        <div className="chat-scroll history-view">
          {!slideThread ? (
            <div className="chat-empty">
              <span className="chat-logo">✦</span>
              <h2>No questions on this {unit} yet</h2>
              <p>Ask something here and it’s kept with this {unit}. Its questions and follow-ups will be drawn here as a tree.</p>
            </div>
          ) : (
            <section className="history-file">
              <h3>{fileLabel}</h3>
              <HistoryTree slide={slideThread} onOpen={(turnId) => { setFocusTurn(turnId || null); showChat() }} />
            </section>
          )}
        </div>
      ) : (
        <>
          <div className="chat-scroll" ref={scrollRef}>
            {turns.length === 0 ? (
              <div className="chat-empty">
                <span className="chat-logo">✦</span>
                <h2>How can I help?</h2>
                <p>Ask about this {unit}. Your conversation is saved with it, so it’s here when you come back.</p>
                {status === null && (
                  <div className="connect-note">
                    <strong>You’ll get sample replies until a chat model is connected.</strong>
                    <span>Free: open the Ollama app (and set <code>CHAT_PROVIDER=ollama</code> in <code>smazy/.env</code>).</span>
                    <span>Or Claude: add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to <code>smazy/.env</code>. No restart needed.</span>
                  </div>
                )}
                {location && <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} onClick={() => void send(s)}>{s}</button>)}</div>}
              </div>
            ) : turns.map((turn, index) => {
              const parent = turn.parentId ? turns.find((item) => item.id === turn.parentId) : undefined
              const depth = Math.min(3, depthOf(turn, turns))
              const answering = streaming && index === turns.length - 1
              return (
                <div key={turn.id} id={`turn-${turn.id}`} className={`turn ${depth ? 'branch' : ''}`} style={{ marginLeft: depth * 14 }}>
                  {parent && <span className="branch-label" title={parent.question}>↳ Follow-up on “{parent.title}”</span>}
                  <div className="message user"><div className="bubble">{turn.question}</div></div>
                  <div className="message assistant">
                    <div className="markdown">
                      {turn.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown> : <span className="typing"><i /><i /><i /></span>}
                    </div>
                    {turn.answer && !answering && (
                      <div className="message-actions">
                        {turn.style && <span className={`style-tag ${turn.style}`}>{turn.style === 'deep' ? 'Deep' : 'Quick'}</span>}
                        {turn.style === 'quick' && !streaming && !turns.some((item) => item.deepens === turn.id) && (
                          <button className="go-deeper" onClick={() => void send('Go deeper', 'deep', { deepen: turn })} title="Get the full explanation of this answer">Go deeper →</button>
                        )}
                        <button className={`save-turn ${turn.saved ? 'saved' : ''}`} onClick={() => toggleSaved(turn)} aria-pressed={Boolean(turn.saved)} title={turn.saved ? 'Saved as important. Click to unsave' : 'Save this as important: it will stand out in History'}>{turn.saved ? '★ Saved' : '☆ Save'}</button>
                        <button onClick={() => void navigator.clipboard?.writeText(turn.answer)}>Copy</button>
                        {readAloud.supported && <button onClick={() => readAloud.toggle(index, turn.answer)} title="Read this answer aloud">{readAloud.speaking === index ? '■ Stop' : '🔊 Listen'}</button>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); if (choosing) void send(draft, choosing); else if (draft.trim() && !streaming) { setChoosing('quick'); inputRef.current?.focus() } }}>
            {location && (
              <div className="pinned-row">
                <span className="context-chip on" title="This conversation is saved with this slide">📌 Saved with {location.fileName} · {unit} {location.page}</span>
                {turns.length > 0 && !streaming && <button type="button" className="clear-thread" onClick={clearSlide} title={`Delete this ${unit}’s conversation`}>Clear</button>}
              </div>
            )}
            {choosing && (
              <div className="style-chooser" role="radiogroup" aria-label="Answer length">
                <button type="button" role="radio" aria-checked={choosing === 'quick'} className={choosing === 'quick' ? 'selected' : ''} onClick={() => void send(draft, 'quick')}>
                  <kbd>←</kbd><span><strong>Quick</strong><small>the key point, in a few lines</small></span>
                </button>
                <button type="button" role="radio" aria-checked={choosing === 'deep'} className={choosing === 'deep' ? 'selected' : ''} onClick={() => void send(draft, 'deep')}>
                  <span><strong>Deep</strong><small>full explanation with an example</small></span><kbd>→</kbd>
                </button>
              </div>
            )}
            <div className="composer-box">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                disabled={!location}
                placeholder={!location ? 'Open a slide to chat about it' : dictation.listening ? 'Listening… speak now' : 'Message Smazy…'}
                onChange={(event) => { setDraft(event.target.value); setChoosing(null) }}
                onKeyDown={(event) => {
                  // Step 2 of sending: ← Quick / Deep →, Enter confirms, Esc goes back to editing.
                  if (choosing) {
                    if (event.key === 'ArrowLeft') { event.preventDefault(); setChoosing('quick'); return }
                    if (event.key === 'ArrowRight') { event.preventDefault(); setChoosing('deep'); return }
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft, choosing); return }
                    if (event.key === 'Escape') { event.preventDefault(); setChoosing(null); return }
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.trim() && !streaming) setChoosing('quick') }
                  if (event.key === 'Escape') { event.currentTarget.blur() }
                  // "/" toggles the chat: with an empty message box it closes the chat instead of typing a slash.
                  if (event.key === '/' && !draft && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); onClose() }
                }}
              />
              {dictation.supported && !streaming && location && (
                <button
                  type="button"
                  className={`mic-button ${dictation.listening ? 'listening' : ''}`}
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start(draft))}
                  title={dictation.listening ? 'Stop listening' : 'Speak your question'}
                  aria-pressed={dictation.listening}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V22a1 1 0 1 1-2 0v-2.56a8 8 0 0 1-7-7.94 1 1 0 1 1 2 0 6 6 0 0 0 12 0Z" /></svg>
                </button>
              )}
              {streaming
                ? <button type="button" className="send-button stop" onClick={() => abortRef.current?.abort()} title="Stop">■</button>
                : <button className="send-button" disabled={!draft.trim() || !location} title="Send (Enter)">↑</button>}
            </div>
            {dictation.error
              ? <small className="composer-note voice-error" role="alert">{dictation.error}</small>
              : <small className="composer-note">{choosing ? '← → to choose · Enter to send · Esc to edit' : dictation.listening ? 'Listening. Tap the mic to stop, then press Enter to send.' : 'Smazy can make mistakes. Check important info against your course files.'}</small>}
          </form>
        </>
      )}
    </aside>
  )
}
