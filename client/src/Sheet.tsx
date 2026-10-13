import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

export const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|ods|csv)$/i

// Big sheets are capped so the page stays fast; the cap is shown to the student.
const MAX_ROWS = 1000
const MAX_COLS = 60

const readWorkbook = async (file: File) => XLSX.read(await file.arrayBuffer(), { cellFormula: true, cellDates: true })

// One text "page" per sheet, used for sorting and so the chat can read the sheet.
export async function readSheetText(file: File): Promise<{ pageCount: number; pages: string[]; sheetNames: string[] }> {
  const workbook = await readWorkbook(file)
  const pages = workbook.SheetNames.map((name) => `Sheet "${name}"\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false }).slice(0, 20000)}`)
  return { pageCount: workbook.SheetNames.length, pages, sheetNames: workbook.SheetNames }
}

type Cell = { text: string; formula?: string; numeric: boolean; colSpan?: number; rowSpan?: number; hidden?: boolean }

function buildGrid(sheet: XLSX.WorkSheet) {
  if (!sheet['!ref']) return { rows: [] as Cell[][], widths: [] as number[], firstCol: 0, firstRow: 0, truncated: false }
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1)
  const rows: Cell[][] = []
  for (let r = range.s.r; r <= lastRow; r += 1) {
    const row: Cell[] = []
    for (let c = range.s.c; c <= lastCol; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      const text = cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString() : String(cell.v ?? ''))) : ''
      row.push({ text, formula: cell?.f, numeric: cell?.t === 'n' })
    }
    rows.push(row)
  }
  // Merged cells span several columns/rows, like in Excel.
  for (const merge of sheet['!merges'] || []) {
    const top = merge.s.r - range.s.r
    const left = merge.s.c - range.s.c
    if (top < 0 || left < 0 || top >= rows.length || left >= rows[0].length) continue
    const bottom = Math.min(merge.e.r - range.s.r, rows.length - 1)
    const right = Math.min(merge.e.c - range.s.c, rows[0].length - 1)
    rows[top][left] = { ...rows[top][left], rowSpan: bottom - top + 1, colSpan: right - left + 1 }
    for (let r = top; r <= bottom; r += 1) for (let c = left; c <= right; c += 1) if (r !== top || c !== left) rows[r][c] = { ...rows[r][c], hidden: true }
  }
  const widths = Array.from({ length: lastCol - range.s.c + 1 }, (_, i) => {
    const info = sheet['!cols']?.[range.s.c + i]
    return Math.max(48, Math.min(360, info?.wpx ?? (info?.wch ? info.wch * 7.5 : 90)))
  })
  return { rows, widths, firstCol: range.s.c, firstRow: range.s.r, truncated: range.e.r > lastRow || range.e.c > lastCol }
}

export function SheetView({ file, sheetIndex, onSheetChange }: { file: File; sheetIndex: number; onSheetChange: (index: number) => void }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setWorkbook(null)
    setError('')
    readWorkbook(file)
      .then((book) => { if (!cancelled) setWorkbook(book) })
      .catch(() => { if (!cancelled) setError(`Couldn’t open ${file.name}.`) })
    return () => { cancelled = true }
  }, [file])
  useEffect(() => setSelected(null), [file, sheetIndex])

  const sheetName = workbook?.SheetNames[Math.min(sheetIndex, workbook.SheetNames.length - 1)]
  const grid = useMemo(() => (workbook && sheetName ? buildGrid(workbook.Sheets[sheetName]) : null), [workbook, sheetName])

  if (error) return <div className="no-preview"><p>{error}</p></div>
  if (!workbook || !grid) return <div className="sheet-view loading"><span className="typing"><i /><i /><i /></span></div>

  const picked = selected ? grid.rows[selected.r]?.[selected.c] : undefined
  const address = selected ? XLSX.utils.encode_cell({ r: grid.firstRow + selected.r, c: grid.firstCol + selected.c }) : ''

  return (
    <div className="sheet-view">
      <div className="formula-bar">
        <span className="name-box">{address || '—'}</span>
        <span className="fx">fx</span>
        <span className="formula-text">{picked ? (picked.formula ? `=${picked.formula}` : picked.text) : ''}</span>
        <span className="view-only">View only</span>
      </div>
      <div className="sheet-scroll">
        {grid.rows.length === 0 ? <p className="sheet-empty">This sheet is empty.</p> : (
          <table className="sheet-grid">
            <colgroup><col style={{ width: 44 }} />{grid.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th className="corner" />
                {grid.widths.map((_, i) => <th key={i} className={selected?.c === i ? 'active' : ''}>{XLSX.utils.encode_col(grid.firstCol + i)}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, r) => (
                <tr key={r}>
                  <th className={selected?.r === r ? 'active' : ''}>{grid.firstRow + r + 1}</th>
                  {row.map((cell, c) => cell.hidden ? null : (
                    <td
                      key={c}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan}
                      className={`${cell.numeric ? 'num' : ''} ${selected?.r === r && selected?.c === c ? 'selected' : ''} ${cell.formula ? 'has-formula' : ''}`}
                      onClick={() => setSelected({ r, c })}
                      title={cell.formula ? `=${cell.formula}` : undefined}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {grid.truncated && <p className="sheet-note">Showing the first {MAX_ROWS} rows and {MAX_COLS} columns.</p>}
      </div>
      <div className="sheet-tabs" role="tablist">
        {workbook.SheetNames.map((name, index) => (
          <button key={name} role="tab" aria-selected={name === sheetName} className={name === sheetName ? 'active' : ''} onClick={() => onSheetChange(index)}>{name}</button>
        ))}
      </div>
    </div>
  )
}
