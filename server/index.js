import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
dotenv.config({ path: envPath })
// Re-read .env on each request, so adding (or removing) an API key works without restarting the server.
let keysFromFile = new Set()
function refreshEnv() {
  let parsed = {}
  try { parsed = dotenv.parse(fs.readFileSync(envPath)) } catch { /* no .env file */ }
  for (const key of keysFromFile) if (!(key in parsed)) delete process.env[key]
  for (const [key, value] of Object.entries(parsed)) process.env[key] = value
  keysFromFile = new Set(Object.keys(parsed))
}
refreshEnv()

const { ALL_CATEGORIES, LEARN, PRACTICE, buildLinks, classifyAll, findFirstLecture, groupOf } = await import('./classify.js')
const { askJson, describeError, provider, streamChat } = await import('./ai.js')
const { CONVERTIBLE, canConvert, convertToPdf } = await import('./convert.js')
const { browse } = await import('./browse.js')

const app = express()
const port = Number(process.env.PORT || 8787)
const isMock = String(process.env.MOCK_AI).toLowerCase() !== 'false'

app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/health', async (_req, res) => {
  refreshEnv()
  const live = await provider()
  res.json({ ok: true, mock: isMock, chat: live ? { via: live.name, model: live.model, label: live.label } : null, canConvert: canConvert() })
})

// PowerPoint / Word -> PDF, so every lecture can be shown as slides.
// The in-app browser (G then B) loads web pages through here.
app.get('/api/browse', browse)

app.post('/api/convert', express.raw({ type: () => true, limit: '300mb' }), async (req, res) => {
  const fileName = decodeURIComponent(String(req.get('x-file-name') || 'file.pptx'))
  if (!CONVERTIBLE.test(fileName)) return res.status(415).json({ error: 'This file type can’t be shown as slides.' })
  try {
    const pdf = await convertToPdf(req.body, fileName)
    res.type('application/pdf').send(pdf)
  } catch (error) {
    console.error('convert failed:', fileName, error.message)
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Smazy couldn’t convert this file.' })
  }
})

// Step 1: sort every uploaded file into Learn or Course Info (and a category inside each group).
app.post('/api/organize', async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : []
  if (!files.length) return res.status(400).json({ error: 'No course files were provided.' })
  const rules = classifyAll(files)
  let organized = rules
  let source = 'rules'

  if (!isMock && await provider()) {
    try {
      const compact = files.map((file) => ({ path: file.path, pageCount: file.pageCount, firstPages: (file.pages || []).slice(0, 3).join(' | ').slice(0, 1500) }))
      const answer = await askJson({
        system: 'You organize a university student’s course folder. Respond with JSON only.',
        prompt: `Sort each file into exactly one category.
Learn (what the student studies): "Lecture" (lecture slide decks and lecture notes only).
Course Info (what is expected, how the course works, and supporting material): "Syllabus" (syllabus, schedule, course outline, policies), "Homework" (homework, assignments, problem sets to hand in), "Guidelines" (project or assignment guidelines, briefs, requirements), "Rubric" (rubrics, marking criteria), "Readings" (articles, papers, case studies, data files and other assigned reading), "Books (references)" (textbooks, reference books, e-books).
"Practice": tutorials, labs, practice problems, past exams, quizzes, worked solutions. These are left out of the course, so use it only for that kind of material.
Decide by what the student does with the file, not by file type. Lecture slides often mention the syllabus or rubric; that does not make them Course Info.
For lectures, lectureNumber is the lecture's position in the course read from the name or first slide (Lecture 01, Week 1, L1, Wk01, Session 1, "01 - Intro"...). Use 0 when it is not a lecture or has no number.
tag is a 1-2 word label such as "Lecture", "Past exam", "Rubric", "Textbook".

FILES:
${JSON.stringify(compact)}`,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['files'],
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'category', 'tag', 'lectureNumber'],
                properties: {
                  path: { type: 'string' },
                  category: { type: 'string', enum: [...ALL_CATEGORIES, PRACTICE] },
                  tag: { type: 'string' },
                  lectureNumber: { type: 'integer' },
                },
              },
            },
          },
        },
      })
      const byPath = new Map(answer.files.map((entry) => [entry.path, entry]))
      organized = rules.map((rule) => {
        const entry = byPath.get(rule.path)
        if (!entry || ![...ALL_CATEGORIES, PRACTICE].includes(entry.category)) return rule
        return {
          path: rule.path,
          group: groupOf(entry.category),
          category: entry.category,
          tag: entry.tag || entry.category,
          lectureNumber: entry.category === 'Lecture' && entry.lectureNumber > 0 ? entry.lectureNumber : null,
          reason: 'Sorted by Claude',
        }
      })
      source = 'ai'
    } catch (error) {
      console.error('organize: falling back to rules:', error.message)
    }
  }

  const kept = organized.filter((entry) => entry.category !== PRACTICE)
  const leftOut = organized.filter((entry) => entry.category === PRACTICE).map((entry) => entry.path)
  res.json({ source, files: kept, leftOut, links: buildLinks(files, kept) })
})

// Step 2: search the Learn group for the first lecture.
app.post('/api/first-lecture', async (req, res) => {
  const learn = (Array.isArray(req.body?.files) ? req.body.files : []).filter((file) => file.group === LEARN)
  if (!learn.length) return res.status(400).json({ error: 'No Learn files were provided.' })
  const rules = findFirstLecture(learn)
  if (isMock || !await provider()) return res.json({ ...rules, source: 'rules' })

  try {
    const compact = learn.map((file) => ({ path: file.path, category: file.category, lectureNumber: file.lectureNumber, firstPage: String(file.firstPage || '').slice(0, 600) }))
    const answer = await askJson({
      system: 'You find the first lecture in a university course folder. Respond with JSON only.',
      prompt: `These files are the Learn materials of one course. Pick the file the student should open first: the first lecture deck of the course. Never pick a practice sheet, past exam or reading when a lecture deck exists. Naming conventions vary (Lecture 01, Week 1, L1, Wk01, Session 1, "01 - Intro", or an unnumbered Introduction). If the syllabus schedule is given, use it to break ties.
Set confident to false if more than one file could reasonably be first.

LEARN FILES:
${JSON.stringify(compact)}

SYLLABUS (may be empty):
${String(req.body?.syllabus || '').slice(0, 3000)}`,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'confident', 'reason'],
        properties: { path: { type: 'string' }, confident: { type: 'boolean' }, reason: { type: 'string' } },
      },
    })
    const pick = learn.find((file) => file.path === answer.path)
    if (!pick) throw new Error(`model picked an unknown file: ${answer.path}`)
    res.json({
      path: pick.path,
      lectureNumber: pick.lectureNumber ?? null,
      confident: Boolean(answer.confident),
      reason: answer.reason,
      alternatives: [rules.path, ...rules.alternatives].filter((p) => p !== pick.path).slice(0, 3),
      source: 'ai',
    })
  } catch (error) {
    console.error('first-lecture: falling back to rules:', error.message)
    res.json({ ...rules, source: 'rules' })
  }
})

// Decides where a new chat question belongs in a slide's conversation: a new main question about the slide,
// or a follow-up that branches off an earlier answer. Also gives it a short title for the history tree.
const FOLLOW_UP = /^(why|how come|what about|and\b|so\b|but\b|then\b|ok(ay)?\b|can you|could you|explain|elaborate|clarify|give (me )?(an? |another )?example|for example|what do you mean|what does (that|this|it)|what is (that|this)|tell me more|more (detail|about)|simpler|in other words|i (still )?don'?t (get|understand)|wait)/i
const shortTitle = (question) => {
  const words = String(question).replace(/[?.!]+$/, '').split(/\s+/)
  return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '')
}
function placeByRules(question, turns) {
  const q = String(question).trim()
  const refersBack = FOLLOW_UP.test(q) || (/\b(it|that|this|those|these|they|the term|you (said|mentioned))\b/i.test(q) && q.split(/\s+/).length <= 14)
  return { parent: turns.length && refersBack ? turns.length - 1 : -1, title: shortTitle(q), kind: kindByRules(q) }
}

// The kind of question, shown as a colour in the history tree.
const KINDS = ['meaning', 'how', 'stuck', 'example', 'check']
function kindByRules(q) {
  if (/don'?t (understand|get)|not understand|doesn'?t make sense|does not make sense|confus|lost me|still unclear/i.test(q)) return 'stuck'
  if (/\bexamples?\b|real[- ]life|for instance/i.test(q)) return 'example'
  if (/(,| )(right|correct|isn'?t it|is that right|am i right)\s*\?*$|^(so|is it true|does that mean)\b/i.test(q)) return 'check'
  if (/\bmean(s|ing)?\b|what (really )?(is|are)\b|\bdefin(e|ition)\b|stand for/i.test(q)) return 'meaning'
  return 'how'
}

app.post('/api/place-question', async (req, res) => {
  refreshEnv()
  const question = String(req.body?.question || '').trim()
  const turns = Array.isArray(req.body?.turns) ? req.body.turns.slice(-20) : []
  if (!question) return res.status(400).json({ error: 'No question.' })
  const rules = placeByRules(question, turns)
  if (!await provider()) return res.json({ ...rules, source: 'rules' })
  try {
    const answer = await askJson({
      system: 'You organize a student’s chat about one lecture slide into a tree of questions. Respond with JSON only.',
      prompt: `EARLIER QUESTIONS on this slide, in order (index, title, question, start of the answer):
${turns.length ? '' : '(none: this is the first question on the slide)\n'}${turns.map((turn, index) => `${index}. [${turn.title}] Q: ${String(turn.question).slice(0, 200)} | A: ${String(turn.answer).slice(0, 300)}`).join('\n')}

NEW QUESTION: ${question.slice(0, 400)}

Decide whether the new question is a FOLLOW_UP or a NEW_TOPIC.

FOLLOW_UP: it only makes sense because of an earlier answer. It points back at it ("that", "it", "your explanation", "you said", "the example") or asks about a word or step that appeared in that answer, or asks for more detail, an example, a simpler version, or "why" about it.
NEW_TOPIC: it could be asked on its own with no earlier answer. Questions about the slide as a whole, the exam, what to memorise, a summary, a quiz, or a different concept are NEW_TOPIC even though they come later in the chat. Coming right after another question does not make something a follow-up.

Examples:
- earlier "What is yield?" then "Can you give an example of that?" -> FOLLOW_UP of the yield question
- earlier answer mentions "discount rate" then "What does discount rate mean?" -> FOLLOW_UP of that answer
- earlier "What is yield?" then "What should I memorise from this slide for the exam?" -> NEW_TOPIC
- earlier "What is yield?" then "Summarize this slide" -> NEW_TOPIC
- earlier "What is yield?" then "How is duration different from maturity?" -> NEW_TOPIC

If FOLLOW_UP, parent = the index of the one earlier question it builds on most directly (a follow-up to a follow-up points at that follow-up). If NEW_TOPIC, parent = -1.
title = a label of at most 5 words for the new question.

kind = what sort of question it is:
- "meaning": asks what a word, phrase or term means ("What does X mean?", "What really is X?")
- "stuck": says they don't understand or that something doesn't make sense
- "example": asks for an example
- "check": states their own idea and asks if it is right ("So X is Y, right?")
- "how": anything else, such as how or why something works, a summary, or a comparison`,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['relation', 'parent', 'title', 'kind'],
        properties: { relation: { type: 'string', enum: ['FOLLOW_UP', 'NEW_TOPIC'] }, parent: { type: 'integer' }, title: { type: 'string' }, kind: { type: 'string', enum: KINDS } },
      },
    })
    if (answer.relation === 'NEW_TOPIC') answer.parent = -1
    const parent = Number.isInteger(answer.parent) && answer.parent >= 0 && answer.parent < turns.length ? answer.parent : -1
    res.json({ parent, title: String(answer.title || rules.title).slice(0, 60), kind: rules.kind === 'check' ? 'check' : KINDS.includes(answer.kind) ? answer.kind : rules.kind, source: 'ai' })
  } catch (error) {
    console.error('place-question: falling back to rules:', error.message)
    res.json({ ...rules, source: 'rules' })
  }
})

// The Study Partner's replies, streamed as plain text chunks.
app.post('/api/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()) : []
  if (!messages.length || messages.at(-1).role !== 'user') return res.status(400).json({ error: 'Send a message first.' })
  const context = req.body?.context || {}
  const deep = req.body?.style === 'deep'

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  refreshEnv()
  // Without credentials the chat still works, with clearly-labelled sample replies.
  const live = await provider()
  if (!live) {
    const reply = mockReply(messages.at(-1).content, context, deep)
    for (const piece of reply.match(/\S+\s*/g) || [reply]) {
      res.write(piece)
      await new Promise((resolve) => setTimeout(resolve, 18))
    }
    return res.end()
  }

  const partnerName = String(context.partnerName || 'Sam').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 20) || 'Sam'
  const system = `You are ${partnerName}, the student's study partner inside Smazy: the classmate who has already read every course file and is studying this slide alongside them.

HOW YOU TALK: like a friendly classmate, not a tutor or a help desk. Use "I" and "we", plain everyday words, and a warm, relaxed tone. Get straight to the point; no formal openings such as "Certainly" or "Great question". When you are not sure, say so the way a classmate would ("I think it's this, but check the slide"). Do not describe yourself as an assistant, a chatbot or a language model. If the student sincerely asks whether you are a person or an AI, tell the truth: you are an AI study partner.

You can help with anything the student asks: explanations, math, writing, coding, planning, or just talking. Answer in clear Markdown.

ANSWER LENGTH for this reply: ${deep
    ? 'DEEP. Give the full explanation: build it up step by step, include one concrete example, and finish with a one-line takeaway. Use short headings or bullets so it is easy to scan.'
    : 'QUICK. Give only the key point, in at most 3 short sentences or 3 brief bullets (about 60 words). No introduction, no recap, no extra sections, and do not offer to say more.'}

The student is studying inside Smazy. When a question is about their course, use the context below and mention the file and slide you used (for example "Wk01 - Intro, slide 3"). When it is not about the course, just answer it normally.

COURSE FILES:
${(context.files || []).slice(0, 200).join('\n')}

CURRENTLY OPEN: ${context.fileName || 'nothing'}${context.page ? `, slide ${context.page}` : ''}
TEXT OF THE OPEN SLIDE:
${String(context.slideText || '').slice(0, 6000)}

REST OF THE OPEN FILE:
${String(context.fileText || '').slice(0, live.kind === 'ollama' ? 12000 : 40000)}`

  try {
    await streamChat({ system, messages: messages.slice(-30), onText: (text) => res.write(text) })
  } catch (error) {
    console.error('chat error:', error.message)
    res.write(`\n\n_${describeError(error)}_`)
  }
  res.end()
})

function mockReply(question, context, deep = false) {
  if (!deep) return `Sample quick answer to “${String(question).trim().slice(0, 80)}”: start from the main definition on the slide and connect it to its example.\n\n_(Sample reply: open the Ollama app for a free model, or add an \`ANTHROPIC_API_KEY\` to \`smazy/.env\` for Claude.)_`
  const q = String(question).trim()
  const where = context.fileName ? `**${context.fileName.replace(/\.[a-z0-9]+$/i, '')}**, slide ${context.page}` : 'your course'
  const slide = String(context.slideText || '').replace(/\s+/g, ' ').trim()
  return `Good question! Here’s a quick take on “${q.slice(0, 120)}”.

${slide ? `On ${where}, the slide says:\n\n> ${slide.slice(0, 220)}${slide.length > 220 ? '…' : ''}\n\n` : ''}**The short version**
1. Start from the main definition on the slide.
2. Connect it to the example it gives.
3. Try explaining it back in one sentence. If you can, you’ve got it.

Want me to go deeper, give an example, or quiz you on it?

_(Sample reply: open the Ollama app for a free model, or add an \`ANTHROPIC_API_KEY\` to \`smazy/.env\` for Claude.)_`
}

app.listen(port, async () => {
  const live = await provider()
  console.log(`Smazy server on http://localhost:${port}`)
  console.log(`  chat:    ${live ? `${live.model} via ${live.name}` : 'sample replies (no model configured)'}`)
  console.log(`  sorting: ${isMock || !live ? 'rules' : 'Claude, with rules as backup'}`)
})
