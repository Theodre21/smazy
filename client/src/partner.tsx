import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

// The helper is a Study Partner, not a chatbot: a small character with a name the student can change.
// It keeps the student company on the slide, and talking to it looks like messaging a friend.
const KEY = 'smazy-partner'
const DEFAULT_NAME = 'Sam'
const listeners = new Set<() => void>()

const read = () => {
  try { return localStorage.getItem(KEY) || DEFAULT_NAME } catch { return DEFAULT_NAME }
}

export function setPartnerName(name: string) {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 20)
  try { if (clean) localStorage.setItem(KEY, clean); else localStorage.removeItem(KEY) } catch { /* private window: keep the default */ }
  listeners.forEach((listener) => listener())
}

// How the partner looks: the student picks a character, a colour and an extra.
export const SPECIES = ['blob', 'cat', 'bear', 'bunny', 'ghost', 'chick'] as const
export const EXTRAS = ['none', 'glasses', 'cap', 'headphones', 'bow', 'sprout', 'coffee'] as const
export const COLORS = {
  coral: { fill: '#e2704f', eye: '#193b5a', blush: '#ffb3a1' },
  sky: { fill: '#5aa9e6', eye: '#193b5a', blush: '#ffb0c4' },
  mint: { fill: '#58c3a0', eye: '#193b5a', blush: '#ffb0c4' },
  lavender: { fill: '#a393f5', eye: '#2b2460', blush: '#ffb0d0' },
  butter: { fill: '#f4c651', eye: '#4a3410', blush: '#ff9d8a' },
  pink: { fill: '#f590b4', eye: '#5a1f3a', blush: '#ffd3e0' },
  ink: { fill: '#3d4d61', eye: '#ffffff', blush: '#ff9eb0' },
} as const
export type Look = { species: typeof SPECIES[number]; color: keyof typeof COLORS; extra: typeof EXTRAS[number] }
const LABELS: Record<string, string> = { blob: 'Blob', cat: 'Cat', bear: 'Bear', bunny: 'Bunny', ghost: 'Ghost', chick: 'Chick', none: 'Nothing', glasses: 'Glasses', cap: 'Grad cap', headphones: 'Music', bow: 'Bow', sprout: 'Sprout', coffee: 'Coffee' }

const LOOK_KEY = 'smazy-partner-look'
const DEFAULT_LOOK: Look = { species: 'blob', color: 'coral', extra: 'none' }
let look: Look = DEFAULT_LOOK
try {
  const saved = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') as Partial<Look>
  look = {
    species: SPECIES.includes(saved.species as Look['species']) ? saved.species! : DEFAULT_LOOK.species,
    color: saved.color && saved.color in COLORS ? saved.color : DEFAULT_LOOK.color,
    extra: EXTRAS.includes(saved.extra as Look['extra']) ? saved.extra! : DEFAULT_LOOK.extra,
  }
} catch { /* keep the default look */ }

export function setLook(change: Partial<Look>) {
  look = { ...look, ...change }
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)) } catch { /* private window */ }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useLook() {
  return useSyncExternalStore(subscribe, () => look)
}

export function usePartnerName() {
  return useSyncExternalStore(subscribe, read)
}

// What the partner says when it notices good study habits. Each line names what the student did and why it helps,
// so it reads as a classmate noticing, not as a sticker. It speaks sparingly, so it doesn't break concentration.
export type Praise =
  | { kind: 'highlight'; count: number }
  | { kind: 'ink' }
  | { kind: 'note' }
  | { kind: 'link'; where: string; withReason: boolean }
  | { kind: 'download'; count: number }
  | { kind: 'finished'; where: string }

const praiseListeners = new Set<(line: string) => void>()
const times: Record<string, number> = {}
let lastPraise = 0

function lineFor(praised: Praise, time: number): string | null {
  const pick = (lines: string[]) => lines[(time - 1) % lines.length]
  switch (praised.kind) {
    case 'highlight':
      // Honest, not just kind: too much highlighting stops helping.
      if (praised.count >= 7) return `That’s ${praised.count} highlights on one slide. Try keeping only the lines you’d want in front of you on exam day.`
      return pick([
        'Good catch. You marked the idea itself, not the whole paragraph.',
        `${praised.count > 1 ? `${praised.count} key lines marked on this slide.` : 'First highlight on this slide.'} That’s your summary writing itself.`,
        'That’s the line I’d have picked too. Can you say why it matters?',
      ])
    case 'ink':
      return pick(['Drawing it out gives you a second way to remember it. Nice.', 'Marking it up your own way makes this slide yours.'])
    case 'note':
      return pick([
        'Putting it in your own words. That sticks far better than reading it twice.',
        'Good note. Future you will know exactly what you meant.',
        'Notes beside the slide, right where you’ll look for them. Smart.',
      ])
    case 'link':
      return praised.withReason
        ? `Nice link to ${praised.where}, and you wrote down why. That’s how separate lectures turn into one picture.`
        : pick([`Nice link to ${praised.where}. Connecting lectures is the step most people skip.`, `Another connection, to ${praised.where}. Next time, add a line on why; it helps when you come back.`])
    case 'download':
      return praised.count > 0 ? `Saved with ${praised.count} of your own notes and highlights. That file is worth more than the original now.` : null
    case 'finished':
      return `That’s the last slide of ${praised.where}. Solid session. Can you say its main idea in one sentence?`
  }
}

export function praise(praised: Praise) {
  const time = (times[praised.kind] = (times[praised.kind] || 0) + 1)
  // Milestones and first times get through quickly; routine praise waits, so it stays rare enough to mean something.
  const notable = time === 1 || praised.kind === 'link' || praised.kind === 'finished' || praised.kind === 'download' || (praised.kind === 'highlight' && praised.count === 7)
  if (Date.now() - lastPraise < (notable ? 5000 : 60000)) return
  const line = lineFor(praised, time)
  if (!line) return
  lastPraise = Date.now()
  praiseListeners.forEach((listener) => listener(line))
}

// The character itself. It blinks on its own; with `follow`, its eyes follow the pointer.
const BODY = 'M40 8c17 0 28 12 28 30 0 19-11 32-28 32S12 57 12 38C12 20 23 8 40 8Z'
const GHOST = 'M12 40C12 20 23 8 40 8s28 12 28 32v29l-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5Z'
const NAVY = '#193b5a'

export function Character({ follow, full, look: chosen }: { follow?: boolean; full?: boolean; look?: Look }) {
  const current = useLook()
  const { species, color, extra } = chosen || current
  const { fill, eye, blush } = COLORS[color]
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!follow) return
    let frame = 0
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const svg = ref.current
        if (!svg) return
        const box = svg.getBoundingClientRect()
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height * 0.45)
        const reach = Math.min(1, Math.hypot(dx, dy) / 260)
        const angle = Math.atan2(dy, dx)
        svg.style.setProperty('--look-x', `${(Math.cos(angle) * 2.4 * reach).toFixed(2)}px`)
        svg.style.setProperty('--look-y', `${(Math.sin(angle) * 1.8 * reach).toFixed(2)}px`)
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(frame) }
  }, [follow])

  return (
    <svg ref={ref} className="character" viewBox={full ? '0 0 80 80' : '5 1 70 74'}>
      {full && <ellipse className="character-shadow" cx="40" cy="75" rx="15" ry="2.6" />}
      <g className="character-body">
        {/* Everything is drawn a little smaller than the box, to leave room for ears and hats. */}
        <g transform="translate(40 44) scale(.86) translate(-40 -40)">
          {species === 'cat' && <g fill={fill} stroke={fill} strokeWidth="4" strokeLinejoin="round"><path d="M19 24 20 6 35 15Z" /><path d="M61 24 60 6 45 15Z" /><path d="M22 19 22.500 11 29 15Z" fill="#fff" stroke="none" opacity=".45" /><path d="M58 19 57.500 11 51 15Z" fill="#fff" stroke="none" opacity=".45" /></g>}
          {species === 'bear' && <g><circle cx="20" cy="15" r="9" fill={fill} /><circle cx="60" cy="15" r="9" fill={fill} /><circle cx="20" cy="15" r="4.500" fill="#fff" opacity=".42" /><circle cx="60" cy="15" r="4.500" fill="#fff" opacity=".42" /></g>}
          {species === 'bunny' && <g><ellipse cx="29" cy="7" rx="6" ry="14" fill={fill} transform="rotate(-9 29 18)" /><ellipse cx="51" cy="7" rx="6" ry="14" fill={fill} transform="rotate(9 51 18)" /><ellipse cx="29" cy="7" rx="2.600" ry="9" fill="#fff" opacity=".42" transform="rotate(-9 29 18)" /><ellipse cx="51" cy="7" rx="2.600" ry="9" fill="#fff" opacity=".42" transform="rotate(9 51 18)" /></g>}
          {species === 'chick' && <g fill={fill}><ellipse cx="40" cy="6" rx="3" ry="6" /><ellipse cx="34" cy="8" rx="2.600" ry="5" transform="rotate(-28 34 8)" /><ellipse cx="46" cy="8" rx="2.600" ry="5" transform="rotate(28 46 8)" /></g>}
          {full && <path className="character-arm left" d="M15 47c-6 2-8 7-6 12" stroke={fill} />}
          {full && <path className="character-arm right" d="M65 47c6-1 9-6 9-13" stroke={fill} />}
          <path d={species === 'ghost' ? GHOST : BODY} fill={fill} />
          <path d="M40 8c17 0 28 12 28 30 0 4-.5 8-1.500 11.500C62 31 52 17 34 13c-7-1.600-12 .5-15 3C23.500 11 31 8 40 8Z" fill="#fff" opacity=".16" />
          {extra === 'headphones' && <g><path d="M13 38C13 17 26 5 40 5s27 12 27 33" fill="none" stroke={NAVY} strokeWidth="4" strokeLinecap="round" /><rect x="7" y="31" width="10" height="17" rx="5" fill={NAVY} /><rect x="63" y="31" width="10" height="17" rx="5" fill={NAVY} /></g>}
          <ellipse cx="21.500" cy="45" rx="5" ry="3" fill={blush} opacity=".75" />
          <ellipse cx="58.500" cy="45" rx="5" ry="3" fill={blush} opacity=".75" />
          <g className="character-eyes">
            <g className="character-pupils">
              <ellipse cx="29" cy="38" rx="3.700" ry="4.300" fill={eye} />
              <ellipse cx="51" cy="38" rx="3.700" ry="4.300" fill={eye} />
              <circle cx="30.400" cy="36.300" r="1.400" fill={eye === '#ffffff' ? fill : '#fff'} />
              <circle cx="52.400" cy="36.300" r="1.400" fill={eye === '#ffffff' ? fill : '#fff'} />
            </g>
          </g>
          {species === 'chick'
            ? <path d="M35.500 44h9l-4.500 5.500Z" fill="#f08a24" stroke="#f08a24" strokeWidth="1.500" strokeLinejoin="round" />
            : <path className="character-mouth" d="M36 44.500c1.300 2.100 2.600 2.900 4 2.900s2.700-.8 4-2.900" stroke={eye} />}
          {extra === 'glasses' && <g fill="rgba(255,255,255,.22)" stroke={eye === '#ffffff' ? '#fff' : NAVY} strokeWidth="2"><circle cx="29" cy="38" r="8" /><circle cx="51" cy="38" r="8" /><path d="M37 37.500h6" fill="none" /></g>}
          {extra === 'cap' && <g><path d="M27 12v8c7 4 19 4 26 0v-8" fill={NAVY} /><path d="M40 1 65 10 40 19 15 10Z" fill="#24507a" stroke={NAVY} strokeWidth="1.500" strokeLinejoin="round" /><path d="M61 11.500v10" stroke="#f4c651" strokeWidth="1.800" strokeLinecap="round" /><circle cx="61" cy="23" r="2.300" fill="#f4c651" /></g>}
          {extra === 'bow' && <g fill="#ff6f91" stroke="#e0527a" strokeWidth="1" strokeLinejoin="round"><path d="M55 12 44 5v14Z" /><path d="M55 12 66 5v14Z" /><circle cx="55" cy="12" r="3.200" /></g>}
          {extra === 'sprout' && <g><path d="M40 9c0-5 .5-8 2-11" fill="none" stroke="#3f8a6b" strokeWidth="2.400" strokeLinecap="round" /><path d="M42-2c4-5 10-4 12-1-3 4-9 5-12 1Z" fill="#58c38a" /><path d="M41 1c-3-4-9-4-11-1 2 4 8 4 11 1Z" fill="#7ad6a3" /></g>}
          {extra === 'coffee' && full && <g><path d="M-1 50h13l-1.500 15h-10Z" fill="#fff" stroke="#d9d4ca" strokeWidth="1" strokeLinejoin="round" /><path d="M0 54h11l-.6 6H.6Z" fill="#b5835a" /><path d="M3 46c-1-2 1-3 0-5M8 46c-1-2 1-3 0-5" fill="none" stroke="#b9c2cb" strokeWidth="1.300" strokeLinecap="round" /></g>}
        </g>
      </g>
    </svg>
  )
}

export function PartnerAvatar({ name, size = 'medium', online }: { name: string; size?: 'small' | 'medium' | 'large'; online?: boolean }) {
  return (
    <span className={`partner-avatar ${size}`} aria-hidden>
      <Character />
      {online !== undefined && <i className={online ? 'online' : ''} title={online ? `${name} is here` : undefined} />}
    </span>
  )
}

// The companion on the slide: it sits in the corner while you study, looks around, and opens the conversation.
let greeted = false
export function Companion({ name, slideKey, earlier, onOpen }: { name: string; slideKey: string; earlier: number; onOpen: () => void }) {
  const [saying, setSaying] = useState<string | null>(null)
  const [praising, setPraising] = useState<string | null>(null)

  useEffect(() => {
    let timer = 0
    const onPraise = (line: string) => {
      window.clearTimeout(timer)
      setPraising(line)
      timer = window.setTimeout(() => setPraising(null), 4500 + line.length * 35)
    }
    praiseListeners.add(onPraise)
    return () => { praiseListeners.delete(onPraise); window.clearTimeout(timer) }
  }, [])

  // It says hello once, and reminds you when you've already talked about the slide you're on. Otherwise it stays quiet.
  useEffect(() => {
    let line: string | null = null
    if (!greeted) line = `Hey, I’m ${name}. Stuck on something? Press /`
    else if (earlier > 0) line = 'We talked about this one'
    setSaying(line)
    // Counted as said only once it has been on screen for a moment.
    const said = window.setTimeout(() => { greeted = true }, 800)
    const timer = line ? window.setTimeout(() => setSaying(null), line.length > 30 ? 6000 : 3200) : 0
    return () => { window.clearTimeout(said); window.clearTimeout(timer) }
  }, [slideKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button className="companion" onClick={onOpen} title={`Talk to ${name} ( / )`} aria-label={`Talk to ${name}, your study partner`}>
      {(praising || saying) && <span className={`companion-says ${praising ? 'praise' : ''}`} key={praising || saying} role="status">{praising || saying}</span>}
      {/* Re-keyed per slide, so it gives a small nod each time you move on. */}
      <span className="companion-figure" key={slideKey}>
        <Character follow full />
        {earlier > 0 && <b className="companion-count" title="Messages on this slide">{earlier}</b>}
      </span>
      <span className="companion-tag">{name} <kbd>/</kbd></span>
    </button>
  )
}

// "Make it yours": the student names the partner and picks how it looks.
export function PartnerCustomizer({ onClose }: { onClose: () => void }) {
  const name = usePartnerName()
  const current = useLook()
  const [draft, setDraft] = useState(name)
  const any = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]
  const colors = Object.keys(COLORS) as Array<Look['color']>
  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      onKeyDown={(event) => {
        // Keys pressed here belong to this window, not to the slide behind it.
        event.nativeEvent.stopPropagation()
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="partner-customizer" role="dialog" aria-label="Customize your study partner" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">Your study partner</span><h2>Make it yours</h2></div>
          <button className="icon-button" onClick={onClose} title="Done (Esc)">×</button>
        </header>
        <div className="customizer-preview">
          <span className="customizer-stage" key={`${current.species}-${current.color}-${current.extra}`}><Character full follow /></span>
          <label>
            <span>Name</span>
            <input autoFocus value={draft} maxLength={20} placeholder="Sam" onFocus={(event) => event.target.select()} onChange={(event) => { setDraft(event.target.value); setPartnerName(event.target.value) }} />
          </label>
          <button className="quiet-button" onClick={() => setLook({ species: any(SPECIES), color: any(colors), extra: any(EXTRAS) })}>🎲 Surprise me</button>
        </div>
        <h3>Character</h3>
        <div className="customizer-options">
          {SPECIES.map((species) => (
            <button key={species} className={current.species === species ? 'selected' : ''} aria-pressed={current.species === species} onClick={() => setLook({ species })}>
              <Character look={{ ...current, species, extra: 'none' }} /><small>{LABELS[species]}</small>
            </button>
          ))}
        </div>
        <h3>Colour</h3>
        <div className="customizer-swatches">
          {colors.map((color) => <button key={color} className={current.color === color ? 'selected' : ''} aria-pressed={current.color === color} aria-label={color} title={color} style={{ background: COLORS[color].fill }} onClick={() => setLook({ color })} />)}
        </div>
        <h3>Extra</h3>
        <div className="customizer-options">
          {EXTRAS.map((extra) => (
            <button key={extra} className={current.extra === extra ? 'selected' : ''} aria-pressed={current.extra === extra} onClick={() => setLook({ extra })}>
              <Character full={extra === 'coffee'} look={{ ...current, extra }} /><small>{LABELS[extra]}</small>
            </button>
          ))}
        </div>
        <footer><button className="primary-button" onClick={onClose}>Done</button></footer>
      </div>
    </div>
  )
}
