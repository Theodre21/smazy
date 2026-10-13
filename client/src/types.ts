export type Group = 'Learn' | 'Course Info'

export const CATEGORIES: Record<Group, string[]> = {
  Learn: ['Lecture'],
  'Course Info': ['Syllabus', 'Homework', 'Guidelines', 'Rubric', 'Readings', 'Books (references)'],
}
export const groupOf = (category: string): Group => (CATEGORIES['Course Info'].includes(category) ? 'Course Info' : 'Learn')

export type CourseFile = {
  path: string
  name: string
  file: File
  isPdf: boolean
  pageCount: number
  pages: string[]
  group: Group
  category: string
  tag: string
  lectureNumber: number | null
}

export type Organized = Pick<CourseFile, 'path' | 'group' | 'category' | 'tag' | 'lectureNumber'> & { reason?: string }
export type Link = { lecturePath: string; page: number; targetPath: string; label: string }
export type FirstLecture = { path: string; lectureNumber: number | null; confident: boolean; reason: string; alternatives: string[]; source: string }

export type ChatMessage = { role: 'user' | 'assistant'; content: string; context?: { fileName: string; page: number; unit?: string } }
export type Conversation = { id: string; title: string; updatedAt: number; messages: ChatMessage[] }
