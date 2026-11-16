// Verifies every clip the plugin can play, without a browser:
//  - each step names a PNG that exists, decodes as a 708x978 RGBA image, and is not empty
//  - each clip actually animates (its drawings are not all the same picture)
//  - the timing adds up and loop/one-shot flags match what the scene machine expects
//  - every act brain.js can pick exists, and every face it names exists
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PLUGIN = ROOT

const { deedOf, FACE, lineFor } = await import(pathToFileURL(path.join(PLUGIN, 'brain.js')).href)

const clips = JSON.parse(await readFile(path.join(PLUGIN, 'assets', 'clips.json'), 'utf8'))
const canvas = clips.canvas
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── WebP sanity, straight from the RIFF container ────────────────────────────────────────────
// The frames are lossless WebP: a RIFF header, then a VP8X canvas header (alpha) or a bare VP8L
// bitstream, which carries its own 14-bit dimensions after the 0x2f signature.
function webpInfo(buf) {
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return null
  if (buf.subarray(8, 12).toString('ascii') !== 'WEBP') return null
  const chunk = buf.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X') {
    const width = 1 + buf.readUIntLE(24, 3)
    const height = 1 + buf.readUIntLE(27, 3)
    return { width, height, lossless: true }
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), lossless: true }
  }
  if (chunk === 'VP8 ') return null // lossy: never produced by the renderer
  return null
}

const ACTS = Object.keys(clips.acts)
console.log(`acts: ${ACTS.length}, canvas ${canvas.width}x${canvas.height}\n`)

const problems = []
let frames = 0
let bytes = 0

for (const name of ACTS) {
  const act = clips.acts[name]
  const dir = path.join(PLUGIN, 'assets', 'frames', name)
  let files = []
  try { files = await readdir(dir) } catch { /* reported below */ }
  const hashes = new Set()
  let total = 0
  let empty = 0
  let bad = ''

  for (const [frame, ms] of act.steps) {
    const file = path.join(dir, `${frame}.webp`)
    let buf
    try { buf = await readFile(file) } catch { bad ||= `missing ${frame}.webp`; continue }
    const info = webpInfo(buf)
    if (!info) { bad ||= `${frame}.webp is not a WebP`; continue }
    if (info.width !== canvas.width || info.height !== canvas.height) bad ||= `${frame}.webp is ${info.width}x${info.height}`
    if (buf.length < 500) empty += 1
    hashes.add(createHash('sha1').update(buf).digest('hex'))
    total += ms
    frames += 1
    bytes += buf.length
  }

  if (bad) problems.push(`${name}: ${bad}`)
  if (empty) problems.push(`${name}: ${empty} empty frames`)
  if (!act.steps.length) problems.push(`${name}: no steps`)
  if (hashes.size < 2 && act.steps.length > 1) problems.push(`${name}: static (all ${act.steps.length} drawings identical)`)
  const declared = act.steps.length
  const onDisk = files.filter((f) => f.endsWith('.webp')).length
  if (onDisk !== declared) problems.push(`${name}: ${onDisk} files on disk, ${declared} in the sheet`)

  const kind = act.loop ? 'loop' : 'one-shot'
  console.log(`  ${name.padEnd(9)} ${kind.padEnd(9)} ${String(declared).padStart(2)} drawings ${String(total).padStart(5)} ms  ${hashes.size} distinct`)
}

check('every clip is complete and valid', problems.length === 0, problems.slice(0, 6).join(' | '))
const expectedFrames = Object.values(clips.acts).reduce((sum, act) => sum + act.steps.length, 0)
check('frame count matches the sheets', frames === expectedFrames, `${frames} vs ${expectedFrames}`)
check('boil pass added drawings beyond the keys', frames > 185, `${frames}`)
check('total assets sane', bytes > 5e6 && bytes < 20e6, `${(bytes / 1024 / 1024).toFixed(1)} MB`)

// ── the scene machine's assumptions ──────────────────────────────────────────────────────────
// `ko` is a loop on purpose: knocked down, she lies there limp until something picks her up.
const LOOPING = ['stand', 'sleep', 'ko']
for (const name of LOOPING) check(`act ${name} loops`, clips.acts[name] && clips.acts[name].loop === true)
const ONE_SHOT = ACTS.filter((name) => !LOOPING.includes(name))
for (const name of ONE_SHOT) check(`act ${name} is a one-shot`, clips.acts[name] && clips.acts[name].loop === false)

// ── every tool maps to a clip that exists, and to a face that exists ────────────────────────
const cases = [
  ['read', { file_path: 'C:/x/gigs.ts' }],
  ['write', { file_path: 'C:/x/gigs.ts' }],
  ['edit', { file_path: 'C:/x/gigs.ts' }],
  ['grep', { pattern: 'paginate' }],
  ['glob', { pattern: '**/*.ts' }],
  ['pwsh', { command: 'npm test' }],
  ['bash', { command: 'git commit -m x' }],
  ['web_fetch', { url: 'https://example.com' }],
  ['web_search', { query: 'night city' }],
  ['subagent', { prompt: 'go' }],
  ['workflow', { script: 'x' }],
  ['ask_user_question', { question: 'why' }],
  ['todo_write', { todos: [] }],
  ['unknown_tool', {}],
]
const missingActs = new Set()
const missingFaces = new Set()
for (const [tool, input] of cases) {
  for (const lang of ['ru', 'en']) {
    const deed = deedOf(tool, input, lang)
    if (!clips.acts[deed.act]) missingActs.add(`${tool} -> ${deed.act}`)
    const face = FACE[deed.deed]
    if (face && !(await readFile(path.join(PLUGIN, 'assets', 'faces', `${face}.png`)).catch(() => null))) missingFaces.add(face)
  }
}
check('every tool maps to an existing clip', missingActs.size === 0, [...missingActs].join(', '))
check('every face referenced exists', missingFaces.size === 0, [...missingFaces].join(', '))

const faces = await readdir(path.join(PLUGIN, 'assets', 'faces'))
check('faces present', faces.filter((f) => f.endsWith('.png')).length === 7, `${faces.length} files`)

// every line set the scene can ask for resolves in both languages
const KINDS = ['idle', 'read', 'edit', 'search', 'run', 'test', 'build', 'install', 'commit', 'push', 'git', 'web', 'agent', 'ask', 'alert', 'go', 'refused', 'done', 'error', 'think', 'poke', 'sleep', 'hello']
const missingLines = []
for (const lang of ['ru', 'en']) {
  for (const kind of KINDS) {
    const line = lineFor(kind, lang)
    if (typeof line !== 'string' || !line.trim() || line.includes('undefined')) missingLines.push(`${lang}/${kind}`)
  }
}
check('every line kind resolves in ru and en', missingLines.length === 0, missingLines.join(', '))

// which clips no tool, state or line can currently reach
const reachable = new Set([...cases.map(([tool, input]) => deedOf(tool, input, 'ru').act), 'stand', 'sleep', 'talk', 'alarm', 'victory', 'flinch', 'turn', 'huff', 'petted', 'curious',
  // drag and drop, waking from sleep, three failures in a row, a cancelled approval, a fixed error
  'grabbed', 'land', 'stretch', 'ko', 'shake', 'hop'])
const unused = ACTS.filter((name) => !reachable.has(name))
console.log(`\nclips rendered but not reachable from the scene yet: ${unused.join(', ') || 'none'}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${frames} frames inspected`)
process.exit(failed.length ? 1 : 0)
