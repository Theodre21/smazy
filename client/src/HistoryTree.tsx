import type { SlideThread, Turn } from './threads'

// One slide's conversation as a tree diagram: the slide at the top, its main questions below,
// follow-ups branching under the question they came from. Colour = kind of question,
// number = the order asked, gold outline + star = saved as important. Click a box to go back to it.
const KINDS: Record<string, string> = {
  meaning: 'What does this mean?',
  how: 'How or why does it work?',
  stuck: 'Didn’t make sense to me',
  example: 'Give me an example',
  check: 'Checking my own idea',
}

const WIDTH = 392
const BOX = 38
const ROW = 50
const INDENT = 24
const ROOT_H = 34
const MAX_DEPTH = 4

type Placed = { turn: Turn; depth: number; x: number; y: number; w: number; parent: Placed | null }

function layout(turns: Turn[]): Placed[] {
  const known = new Set(turns.map((turn) => turn.id))
  const childrenOf = (id: string | null) => turns.filter((turn) => (id === null ? !turn.parentId || !known.has(turn.parentId) : turn.parentId === id))
  const placed: Placed[] = []
  const walk = (parent: Placed | null, id: string | null, depth: number) => {
    for (const turn of childrenOf(id)) {
      const level = Math.min(depth, MAX_DEPTH)
      const x = 16 + level * INDENT
      const node: Placed = { turn, depth: level, x, y: ROOT_H + 16 + placed.length * ROW, w: WIDTH - x - 2, parent }
      placed.push(node)
      walk(node, turn.id, depth + 1)
    }
  }
  walk(null, null, 0)
  return placed
}

// Rough fit for 13px text: keeps long titles inside their box.
const fit = (text: string, width: number) => {
  const max = Math.max(8, Math.floor(width / 6.9))
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function HistoryTree({ slide, onOpen }: { slide: SlideThread; onOpen: (turnId?: string) => void }) {
  const nodes = layout(slide.turns)
  const height = ROOT_H + 16 + nodes.length * ROW + 4
  const order = new Map(slide.turns.map((turn, index) => [turn.id, index + 1]))
  const savedCount = slide.turns.filter((turn) => turn.saved).length
  const followUps = nodes.filter((node) => node.parent).length
  const used = Object.keys(KINDS).filter((kind) => slide.turns.some((turn) => (turn.kind || 'how') === kind))
  const unitName = slide.unit === 'sheet' ? 'Sheet' : 'Slide'

  return (
    <figure className="history-tree">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`Tree of the ${slide.turns.length} questions asked on ${unitName.toLowerCase()} ${slide.page}`}>
        {/* Connectors first, so boxes sit on top. Each drops from its parent's left edge, then turns right into the child. */}
        {nodes.map((node) => {
          const fromX = node.parent ? node.parent.x + 14 : 14
          const fromY = node.parent ? node.parent.y + BOX : ROOT_H
          const toY = node.y + BOX / 2
          return <path key={`edge-${node.turn.id}`} className="tree-edge" d={`M${fromX} ${fromY} V${toY - 8} Q${fromX} ${toY} ${fromX + 8} ${toY} H${node.x}`} />
        })}
        <g className="tree-root" role="button" tabIndex={0} onClick={() => onOpen()} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}>
          <title>Back to this conversation</title>
          <rect x={0} y={0} width={132} height={ROOT_H} rx={9} />
          <text x={66} y={22} textAnchor="middle">{unitName} {slide.page}</text>
        </g>
        {nodes.map((node) => {
          const { turn } = node
          const kind = turn.kind || 'how'
          const labelWidth = node.w - 40 - (turn.saved ? 24 : 0) - 8
          return (
            <g
              key={turn.id}
              className={`tree-box kind-${kind} ${turn.saved ? 'saved' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(turn.id)}
              onKeyDown={(event) => { if (event.key === 'Enter') onOpen(turn.id) }}
            >
              <title>{`${order.get(turn.id)}. ${turn.question}${turn.saved ? ' (saved as important)' : ''}`}</title>
              {turn.saved && <rect className="saved-ring" x={node.x - 3.5} y={node.y - 3.5} width={node.w + 7} height={BOX + 7} rx={12} />}
              <rect className="tree-rect" x={node.x} y={node.y} width={node.w} height={BOX} rx={9} />
              <circle className="tree-num-bg" cx={node.x + 20} cy={node.y + BOX / 2} r={10.5} />
              <text className="tree-num" x={node.x + 20} y={node.y + BOX / 2 + 4} textAnchor="middle">{order.get(turn.id)}</text>
              <text className="tree-label" x={node.x + 40} y={node.y + BOX / 2 + 4.5}>{fit(turn.title, labelWidth)}</text>
              {turn.saved && <text className="saved-star" x={node.x + node.w - 16} y={node.y + BOX / 2 + 5.5} textAnchor="middle">★</text>}
            </g>
          )
        })}
      </svg>
      <figcaption>
        <p className="tree-summary">
          {slide.turns.length} question{slide.turns.length === 1 ? '' : 's'}
          {followUps > 0 && ` · ${followUps} follow-up${followUps === 1 ? '' : 's'}`}
          {savedCount > 0 && <span className="saved-note"> · ★ {savedCount} saved</span>}
          <span className="tree-hint"> · click a box to go back to it</span>
        </p>
        <div className="tree-legend">
          {used.map((kind) => <span key={kind} className={`kind-${kind}`}><i />{KINDS[kind]}</span>)}
          <span className="legend-saved"><i />★ Saved as important</span>
        </div>
      </figcaption>
    </figure>
  )
}
