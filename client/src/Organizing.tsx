import { CATEGORIES } from './types'
import type { CourseFile, Group } from './types'

export type Phase = { step: 'reading' | 'sorting' | 'searching' | 'opening'; read: number; total: number; files: CourseFile[]; firstPath?: string; note?: string; leftOut?: number; duplicates?: number }

const STEPS: Array<[Phase['step'], string]> = [
  ['reading', 'Reading your files'],
  ['sorting', 'Sorting into Learn and Course Info'],
  ['searching', 'Searching Learn for the first lecture'],
  ['opening', 'Opening your first lecture'],
]

export function OrganizingScreen({ phase }: { phase: Phase }) {
  const current = STEPS.findIndex(([step]) => step === phase.step)
  const sorted = current >= 1 && phase.files.length > 0

  return (
    <div className="organizing-shell">
      <header className="landing-nav"><span className="wordmark"><span className="wordmark-dot" />smazy</span></header>
      <main className="organizing-main">
        <div className="organizing-steps">
          <span className="kicker">Getting your course ready</span>
          <ol>
            {STEPS.map(([step, label], index) => (
              <li key={step} className={index < current ? 'done' : index === current ? 'active' : ''}>
                <span className="step-dot">{index < current ? '✓' : index + 1}</span>
                {label}
                {step === 'reading' && index === current && <small>{phase.read} of {phase.total}</small>}
                {step === 'opening' && index === current && phase.note && <small>{phase.note}</small>}
              </li>
            ))}
          </ol>
          {Boolean(phase.leftOut) && <p className="left-out">Left out {phase.leftOut} practice file{phase.leftOut === 1 ? '' : 's'} (past exams, tutorials, solutions).</p>}
          {Boolean(phase.duplicates) && <p className="left-out">Skipped {phase.duplicates} duplicate{phase.duplicates === 1 ? '' : 's'}: kept the PDF version of files uploaded in two formats.</p>}
        </div>
        <div className={`sort-board ${sorted ? 'visible' : ''}`}>
          {(['Learn', 'Course Info'] as Group[]).map((group) => (
            <section key={group} className={`sort-column ${group === 'Learn' ? 'learn' : 'info'}`}>
              <h2>{group}<small>{group === 'Learn' ? 'what you study' : 'what’s expected of you'}</small></h2>
              {CATEGORIES[group].map((category) => {
                const items = phase.files.filter((file) => file.category === category)
                if (!items.length) return null
                return (
                  <div key={category} className="sort-category">
                    <h3>{category}</h3>
                    {items.map((file) => {
                      const order = phase.files.indexOf(file)
                      const isFirst = file.path === phase.firstPath
                      const scanning = phase.step === 'searching' && group === 'Learn' && category === 'Lecture'
                      return (
                        <div key={file.path} className="sort-card-slot" style={{ animationDelay: `${order * 60}ms` }}>
                          <div className={`sort-card ${isFirst ? 'first' : ''} ${scanning ? 'scanning' : ''}`}>
                            <span className="sort-card-name">{file.name}</span>
                            {isFirst ? <span className="first-badge">First lecture</span> : file.tag !== category && <span className="sort-tag">{file.tag}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
