import { readPdfText } from './pdf'
import type { ChatMessage, CourseFile, FirstLecture, Link, Organized } from './types'

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export type ChatStatus = { via: string; model: string; label: string } | null
export async function health(): Promise<{ mock: boolean; chat: ChatStatus; canConvert: boolean }> {
  return (await fetch('/api/health')).json()
}

export function organize(files: CourseFile[]) {
  return post<{ source: string; files: Organized[]; leftOut: string[]; links: Link[] }>('/api/organize', {
    files: files.map((file) => ({ path: file.path, pageCount: file.pageCount, pages: file.pages.map((page) => page.slice(0, 3000)) })),
  })
}

export function findFirstLecture(files: CourseFile[]) {
  const syllabus = files.find((file) => file.category === 'Syllabus')
  return post<FirstLecture>('/api/first-lecture', {
    files: files.filter((file) => file.group === 'Learn').map((file) => ({ path: file.path, group: file.group, category: file.category, lectureNumber: file.lectureNumber, firstPage: file.pages[0] || '' })),
    syllabus: syllabus?.pages.join('\n') || '',
  })
}

export type ChatContext = { files: string[]; fileName?: string; page?: number; slideText?: string; fileText?: string; partnerName?: string }

// Streams the reply; onText receives the full text so far.
export type AnswerStyle = 'quick' | 'deep'

export async function streamChat(messages: ChatMessage[], context: ChatContext, onText: (text: string) => void, signal: AbortSignal, style: AnswerStyle = 'quick') {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })), context, style }),
    signal,
  })
  if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || 'Chat request failed')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
  return text
}

// PowerPoint and Word files are converted to PDF on the server so they can be shown as slides.
export const CONVERTIBLE = /\.(pptx?|ppsx?|potx?|key|odp|docx?|odt|rtf)$/i

export async function makeViewable(record: CourseFile): Promise<CourseFile> {
  const response = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(record.name) },
    body: record.file,
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Smazy couldn’t convert this file.')
  const pdf = new File([await response.blob()], record.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' })
  const text = await readPdfText(pdf)
  return { ...record, file: pdf, isPdf: true, ...text }
}

export type QuestionKind = 'meaning' | 'how' | 'stuck' | 'example' | 'check'

// Asks the model whether a new question is a new topic (parent -1) or a follow-up to an earlier one.
export function placeQuestion(question: string, turns: Array<{ title: string; question: string; answer: string }>) {
  return post<{ parent: number; title: string; kind?: QuestionKind; source: string }>('/api/place-question', { question, turns })
}
