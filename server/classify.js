// Rule-based course sorter. Used on its own in mock mode, and as the safety net
// whenever the model is unavailable or skips a file.

export const LEARN = 'Learn'
export const COURSE_INFO = 'Course Info'

export const CATEGORIES = {
  [LEARN]: ['Lecture'],
  [COURSE_INFO]: ['Syllabus', 'Homework', 'Guidelines', 'Rubric', 'Readings', 'Books (references)'],
}
export const ALL_CATEGORIES = [...CATEGORIES[LEARN], ...CATEGORIES[COURSE_INFO]]
// Practice material (past exams, tutorials, solutions) is recognised so it can be left out of the course.
export const PRACTICE = 'Practice'
export const groupOf = (category) => (category === PRACTICE ? null : CATEGORIES[COURSE_INFO].includes(category) ? COURSE_INFO : LEARN)

const baseName = (path = '') => String(path).split('/').pop().replace(/\.[a-z0-9]+$/i, '')
// Folder names inside the course folder ("Lecture Slides", "Course Info"...). The top folder is the
// course name itself, so it is skipped: a course called "Project Management" says nothing about its files.
const innerFolders = (path = '') => {
  const parts = String(path).split('/').slice(0, -1)
  return (parts.length > 1 ? parts.slice(1) : []).join('/').toLowerCase()
}
const SLIDE_FILE = /\.(pptx?|key|odp)$/i

const LECTURE_WORDS = 'lecture|lectures|lect|lec|week|wk|session|class|module|mod|unit|lesson|topic|day|seminar|slides?|deck|chapter|ch'
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1 }

// Returns the lecture's position, plus a part letter for split lectures ("01a", "02b").
export function lectureOrder(name, title = '') {
  const n = baseName(name).toLowerCase()
  const patterns = [
    new RegExp(`(?:^|[^a-z])(?:${LECTURE_WORDS})[\\s_.-]*0*(\\d{1,3})([a-z])?(?![\\d])`),
    /(?:^|[^a-z])[lw][\s_.-]?0*(\d{1,3})([a-z])?(?![\da-z])/,
    /(?:^|[\s_-])0*(\d{1,2})([a-z])?(?=[\s_.-]|$)/,
  ]
  for (const pattern of patterns) {
    const match = n.match(pattern)
    if (match) return { number: Number(match[1]), part: match[2] || '' }
  }
  const t = String(title).toLowerCase()
  const titleMatch = t.match(new RegExp(`(?:lecture|week|session|class|module|unit|lesson|chapter)\\s*0*(\\d{1,3}|${Object.keys(WORD_NUMBERS).join('|')})\\b`))
  if (titleMatch) return { number: WORD_NUMBERS[titleMatch[1]] ?? Number(titleMatch[1]), part: '' }
  return null
}
export const lectureNumber = (name, title = '') => lectureOrder(name, title)?.number ?? null

export function classifyFile(file) {
  const name = baseName(file.path).toLowerCase()
  const folder = innerFolders(file.path)
  // Only the title area of page 1 is trusted: lecture slides routinely *mention* the syllabus or rubric.
  const title = String(file.pages?.[0] || '').slice(0, 160).toLowerCase()
  const allText = (file.pages || []).join(' ').toLowerCase()
  const pageCount = Number(file.pageCount) || (file.pages || []).length
  const slides = SLIDE_FILE.test(file.path)
  const explicitLecture = new RegExp(`^(?:[a-z]{2,5}\\s?\\d{3,4}[\\s_-]+)?(?:lecture|lect|lec|week|wk|session|class|lesson|l)[\\s_.-]*\\d`).test(name)
  const lectureInName = new RegExp(`(?:^|[^a-z])(?:${LECTURE_WORDS})(?:[^a-z]|$)`).test(name) || lectureNumber(file.path) !== null
  const result = (category, tag, reason) => ({
    path: file.path,
    group: groupOf(category),
    category,
    tag,
    lectureNumber: category === 'Lecture' ? lectureNumber(file.path, title) : null,
    reason,
  })

  if (/rubric|marking (scheme|criteria|guide)|grading (criteria|scheme)|assessment criteria/.test(name) || /^\s*\S*\s*rubric/.test(title)) {
    return result('Rubric', 'Rubric', 'Grading rubric')
  }
  if (/syllabus|syllabi|course (outline|info|information|schedule|overview)|unit guide|module guide|subject outline|\bschedule\b|\bpolicy\b|\bpolicies\b/.test(name) || /\bsyllabus\b/.test(title)) {
    return result('Syllabus', 'Syllabus', 'Describes how the course runs')
  }
  if (/solution|answer key|answers|past (exam|paper)|midterm|mid-term|final exam|\bexam\b|\bquiz\b|practice|tutorial|\btut\b|worksheet|\blab\b|revision|mock/.test(name) ||
      /solution|tutorial|practice|past (exam|paper)/.test(folder) ||
      (!explicitLecture && /exercise|problems\b/.test(name))) {
    const pastExam = /past|midterm|mid-term|exam|quiz|mock/.test(name)
    return result(PRACTICE, pastExam ? 'Past exam' : /solution|answer/.test(`${folder} ${name}`) ? 'Solutions' : 'Practice', 'Practice material, left out')
  }
  if (/homework|\bhw\s?\d|assignment|problem ?set|\bps\s?\d|coursework/.test(name) || /homework|assignment/.test(folder)) {
    return result('Homework', 'Homework', 'Work to hand in')
  }
  if (/guideline|project|brief|requirements|instructions|specification|\bspec\b|handbook|template/.test(name) || /project/.test(folder)) {
    return result('Guidelines', 'Guidelines', 'Explains what is expected')
  }
  if (/\b(text ?books?|e-?books?|books?)\b|\bedition\b|\b\d+(st|nd|rd|th) ed\b|\bisbn\b/.test(name) ||
      /reference|text ?book|\bbooks?\b/.test(folder) ||
      (/\bisbn\b/.test(allText) && pageCount >= 30) ||
      (!lectureInName && !slides && pageCount >= 80 && /table of contents|\bcontents\b|\bchapter 1\b/.test(allText))) {
    return result('Books (references)', 'Book', 'Looks like a textbook or reference book')
  }
  if (/course ?info|course information|admin|course docs|course documents|syllabus/.test(folder)) {
    return result('Syllabus', 'Course info', 'Kept in the course info folder')
  }
  if (!lectureInName && !slides && /reading|paper|article|chapter|notes|essay|case study/.test(name)) {
    return result('Readings', 'Readings', 'Reading material')
  }
  if (lectureInName || slides || /lecture|slides|notes/.test(folder) || /^\W*(lecture|week|session|class)\s*\d/.test(title) || /\b(learning objectives|today'?s agenda)\b/.test(title)) {
    return result('Lecture', 'Lecture', slides ? 'Slide deck' : 'Lecture slides')
  }
  if (/reading/.test(folder)) {
    return result('Readings', 'Readings', 'Reading material')
  }
  return result('Readings', 'Readings', 'Other course material')
}

export function classifyAll(files) {
  return files.map(classifyFile)
}

// Picks the first lecture from files already sorted into Learn.
export function findFirstLecture(learnFiles) {
  const lectures = learnFiles.filter((file) => file.category === 'Lecture')
  const pool = lectures.length ? lectures : learnFiles
  const introScore = (file) => (/intro|introduction|orientation|welcome|overview|getting started|foundations/.test(baseName(file.path).toLowerCase()) ? 1 : 0)
  const part = (file) => (file.lectureNumber !== null ? lectureOrder(file.path)?.part || '' : '')
  const sorted = pool.slice().sort((a, b) => {
    const an = a.lectureNumber ?? Infinity
    const bn = b.lectureNumber ?? Infinity
    if (an !== bn) return an - bn
    if (part(a) !== part(b)) return part(a).localeCompare(part(b))
    if (introScore(a) !== introScore(b)) return introScore(b) - introScore(a)
    return baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true })
  })
  const pick = sorted[0]
  if (!pick) return null
  const tied = sorted.filter((file) => file !== pick && file.lectureNumber === pick.lectureNumber && part(file) === part(pick))
  const confident = lectures.length > 0 && pick.lectureNumber !== null && pick.lectureNumber <= 1 && tied.length === 0
  return {
    path: pick.path,
    lectureNumber: pick.lectureNumber,
    confident,
    reason: pick.lectureNumber !== null ? `Lowest lecture number in the file names (${pick.lectureNumber})` : 'No numbered lectures found; picked the most introductory file',
    alternatives: sorted.slice(1, 4).map((file) => file.path),
  }
}

// Link buttons: a lecture page that mentions a Course Info file gets a button to it.
export function buildLinks(files, organized) {
  const byPath = new Map(organized.map((entry) => [entry.path, entry]))
  const info = organized.filter((entry) => entry.group === COURSE_INFO)
  const cues = {
    Syllabus: /\bsyllabus\b|office hours|course schedule/,
    Homework: /\bhomework\b|\bassignment\b|problem set/,
    Guidelines: /\bproject\b|guidelines?|deliverables?/,
    Rubric: /\brubric\b|grading criteria|how .* (are|is) graded/,
    'Books (references)': /\btextbook\b|required reading|\bchapter \d+ of\b/,
  }
  const links = []
  for (const file of files) {
    if (byPath.get(file.path)?.category !== 'Lecture') continue
    ;(file.pages || []).forEach((page, index) => {
      const text = String(page).toLowerCase()
      for (const target of info) {
        if (cues[target.category]?.test(text) && !links.some((link) => link.lecturePath === file.path && link.page === index + 1 && link.targetPath === target.path)) {
          links.push({ lecturePath: file.path, page: index + 1, targetPath: target.path, label: target.category === 'Books (references)' ? 'Textbook' : target.category })
        }
      }
    })
  }
  return links
}
