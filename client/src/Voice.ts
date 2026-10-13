import { useCallback, useEffect, useRef, useState } from 'react'

// Speech-to-text uses the browser's built-in recognizer (Chrome, Edge, Safari). No extra service or key.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } }
type Recognizer = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
const RecognizerClass = (): (new () => Recognizer) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
  return w.SpeechRecognition || w.webkitSpeechRecognition
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the address bar, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in the address bar, then try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice typing needs an internet connection.',
  'no-speech': 'I didn’t hear anything. Tap the mic and try again.',
}

// Dictation: while listening, onText receives the text already in the box plus everything said so far.
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognizer = useRef<Recognizer | null>(null)
  const supported = Boolean(RecognizerClass())

  const stop = useCallback(() => { recognizer.current?.stop() }, [])
  const start = useCallback((existingText: string) => {
    const Recognition = RecognizerClass()
    if (!Recognition) return
    recognizer.current?.abort()
    const rec = new Recognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    const before = existingText.trim()
    rec.onresult = (event) => {
      const spoken = Array.from(event.results).map((result) => result[0].transcript).join('').replace(/\s+/g, ' ').trim()
      onText([before, spoken].filter(Boolean).join(' '))
    }
    rec.onerror = (event) => { if (event.error !== 'aborted') setError(ERRORS[event.error] || 'Voice typing stopped unexpectedly. Try again.') }
    rec.onend = () => { setListening(false); if (recognizer.current === rec) recognizer.current = null }
    recognizer.current = rec
    setError('')
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }, [onText])

  useEffect(() => () => recognizer.current?.abort(), [])
  return { supported, listening, error, start, stop }
}

// Markdown symbols would be read out loud ("asterisk asterisk"), so they are removed first.
const plain = (markdown: string) => markdown
  .replace(/```[\s\S]*?```/g, ' (code omitted) ')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`#>|]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

// Read-aloud: one message at a time; calling it again for the same message stops it.
export function useReadAloud() {
  const [speaking, setSpeaking] = useState<number | null>(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const toggle = useCallback((index: number, markdown: string) => {
    window.speechSynthesis.cancel()
    if (speaking === index) { setSpeaking(null); return }
    const utterance = new SpeechSynthesisUtterance(plain(markdown))
    utterance.lang = navigator.language || 'en-US'
    utterance.onend = () => setSpeaking((current) => (current === index ? null : current))
    utterance.onerror = () => setSpeaking((current) => (current === index ? null : current))
    setSpeaking(index)
    window.speechSynthesis.speak(utterance)
  }, [speaking])
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel() }, [supported])
  return { supported, speaking, toggle }
}
