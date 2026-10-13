import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Office files LibreOffice can turn into a PDF the viewer can show.
export const CONVERTIBLE = /\.(pptx?|ppsx?|potx?|key|odp|docx?|odt|rtf)$/i

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
]
export const findSoffice = () => CANDIDATES.find((candidate) => candidate && existsSync(candidate)) || null

// Mac fallback while LibreOffice isn't installed: ask Microsoft PowerPoint to export the deck.
// PowerPoint is sandboxed, so files go through its own container folder (no file-access prompts).
const POWERPOINT_APP = '/Applications/Microsoft PowerPoint.app'
const POWERPOINT_DIR = path.join(os.homedir(), 'Library/Containers/com.microsoft.Powerpoint/Data/smazy-convert')
const POWERPOINT_FILE = /\.(pptx?|ppsx?|potx?)$/i
const canUsePowerPoint = (fileName) => process.platform === 'darwin' && POWERPOINT_FILE.test(fileName) && existsSync(POWERPOINT_APP)
export const canConvert = () => Boolean(findSoffice()) || (process.platform === 'darwin' && existsSync(POWERPOINT_APP))

const EXPORT_SCRIPT = `on run argv
  with timeout of 170 seconds
    tell application "Microsoft PowerPoint"
      open POSIX file (item 1 of argv)
      set deck to active presentation
      save deck in POSIX file (item 2 of argv) as save as PDF
      close deck saving no
    end tell
  end timeout
end run`

function runPowerPoint(input, output) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', EXPORT_SCRIPT, input, output], { timeout: 180_000 }, (error, _stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve())
  })
}

const cache = new Map()
let queue = Promise.resolve()
// A private profile so conversions never clash with a LibreOffice window the user has open.
const profileDir = path.join(os.tmpdir(), 'smazy-libreoffice-profile')

function run(soffice, input, outDir) {
  return new Promise((resolve, reject) => {
    execFile(
      soffice,
      ['--headless', '--norestore', `-env:UserInstallation=file://${profileDir}`, '--convert-to', 'pdf', '--outdir', outDir, input],
      { timeout: 180_000 },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()),
    )
  })
}

export async function convertToPdf(buffer, fileName) {
  const soffice = findSoffice()
  const usePowerPoint = !soffice && canUsePowerPoint(fileName)
  if (!soffice && !usePowerPoint) throw Object.assign(new Error('This file needs LibreOffice (or Microsoft PowerPoint for slides) to be shown here.'), { status: 501 })
  const key = createHash('sha1').update(buffer).digest('hex')
  if (cache.has(key)) return cache.get(key)

  // LibreOffice handles one conversion at a time per profile, so conversions queue up.
  const job = queue.then(async () => {
    if (usePowerPoint) await fs.mkdir(POWERPOINT_DIR, { recursive: true })
    const dir = await fs.mkdtemp(path.join(usePowerPoint ? POWERPOINT_DIR : os.tmpdir(), 'smazy-convert-'))
    try {
      const extension = path.extname(fileName).toLowerCase() || '.pptx'
      const input = path.join(dir, `input${extension}`)
      const output = path.join(dir, 'input.pdf')
      await fs.writeFile(input, buffer)
      if (usePowerPoint) await runPowerPoint(input, output)
      else await run(soffice, input, dir)
      return await fs.readFile(output)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  queue = job.catch(() => {})
  const pdf = await job
  cache.set(key, pdf)
  return pdf
}
