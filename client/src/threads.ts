import { useSyncExternalStore } from 'react'

// Every conversation is pinned to the slide it happened on. Inside a slide's conversation, a question is
// either a main question about the slide or a follow-up that branches off an earlier one (parentId).
// style: how long an answer the student chose (Quick = key point, Deep = full explanation).
export type Turn = { id: string; question: string; answer: string; parentId: string | null; title: string; createdAt: number; style?: 'quick' | 'deep'; deepens?: string; kind?: 'meaning' | 'how' | 'stuck' | 'example' | 'check'; saved?: boolean }
// kind: the sort of question (colour in the history tree). saved: the student marked it as important.
// deepens: set on a "Go deeper" turn, to the id of the Quick answer it expands.
export type SlideThread = { path: string; page: number; fileName: string; unit: string; turns: Turn[]; updatedAt: number }
type Store = Record<string, SlideThread>

const STORAGE_KEY = 'smazy-threads'
export const threadKey = (path: string, page: number) => `${path}#${page}`

let store: Store = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Store } catch { return {} }
})()
const listeners = new Set<() => void>()

function commit(next: Store) {
  store = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) } catch { /* storage full or blocked: chats last for this session */ }
  listeners.forEach((listener) => listener())
}

export function updateThread(key: string, seed: Omit<SlideThread, 'turns' | 'updatedAt'>, change: (turns: Turn[]) => Turn[]) {
  const existing = store[key]
  const turns = change(existing?.turns || [])
  if (!turns.length) {
    const { [key]: _removed, ...rest } = store
    commit(rest)
    return
  }
  commit({ ...store, [key]: { ...(existing || seed), ...seed, turns, updatedAt: Date.now() } })
}

export function useThreads(): Store {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => store)
}

// How deep a turn sits in its branch tree (0 = main question).
export function depthOf(turn: Turn, turns: Turn[]): number {
  let depth = 0
  let current: Turn | undefined = turn
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    current = turns.find((item) => item.id === current!.parentId)
    if (current) depth += 1
  }
  return depth
}
