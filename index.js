// Host half: reads what the agent is doing, keeps Capri's scene, stores settings, serves the browser.
// The drawings are the plugin's own assets, rendered offline from her shader (see capri-tools/).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FACE, NAME, TAG, deedOf, lineFor } from './brain.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_PATH = path.join(DATA_DIR, 'capri.json')

const CLIPS = JSON.parse(await readFile(path.join(ROOT, 'assets', 'clips.json'), 'utf8'))
const ACT_NAMES = Object.keys(CLIPS.acts)

const clampScale = (value) => Math.min(400, Math.max(50, Math.round(Number(value) || 100)))
const LANGS = ['ru', 'en']
const clampLang = (value) => (LANGS.includes(value) ? value : 'ru')
const SIDES = ['right', 'left']
const clampSide = (value) => (SIDES.includes(value) ? value : 'right')
const clampVolume = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)))
// Where the drag left her, relative to her corner. Bounded so a bad value cannot park her off-screen.
const clampOffset = (value) => Math.min(4000, Math.max(-4000, Math.round(Number(value) || 0)))
const freshConfig = () => ({ scale: 100, side: 'right', lang: 'ru', alerts: true, sound: true, volume: 30, breaks: true, x: 0, y: 0 })

// Russian needs three plural forms; English takes two. Used by the turn summary.
function plural(count, forms, lang) {
  if (lang === 'en') return `${count} ${count === 1 ? forms[0] : forms[1]}`
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return `${count} ${forms[2]}`
  if (tail === 1) return `${count} ${forms[0]}`
  if (tail >= 2 && tail <= 4) return `${count} ${forms[1]}`
  return `${count} ${forms[2]}`
}

function formatSpan(ms, lang) {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (lang === 'en') return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
  return minutes ? `${minutes} м ${String(seconds).padStart(2, '0')} с` : `${seconds} с`
}

// rest ladder: how long she stays awake with nothing to do
const SLEEP_AFTER = 240_000

export const inject = ['webServer']

export function apply(ctx) {
  const timers = new Set()
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id)
      try { fn() } catch { /* her scene must never break a turn */ }
    }, ms)
    timers.add(id)
    return id
  }
  const clearLater = () => {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }
  // clearTimeout alone leaves the id in the set: every play and every rest tick would keep one
  // stale id alive for the life of the host process.
  const cancel = (id) => {
    if (!id) return
    clearTimeout(id)
    timers.delete(id)
  }

  const config = freshConfig()
  // diagnostics the settings page shows: proof that the approval seam actually reaches her
  const stats = { approvals: 0, lastApproval: 0, events: 0, turns: 0, agents: 0, types: {} }
  // Mounted pets, per page load. A reload starts a new page token, so a growing count here means
  // duplicates in one page, not someone refreshing the window.
  const petPages = new Map()
  const PET_PAGES_LIMIT = 24

  // What happened in the running turn, for the summary she shows when it ends.
  const turn = { actions: 0, files: new Set(), started: 0 }
  let errorStreak = 0
  // Sessions that turned out to be subagents: she follows the main session only.
  const subSessions = new Set()
  const isSubSession = (session) => {
    if (!session || !session.id) return false
    if (subSessions.has(session.id)) return true
    const depth = session.header && session.header.delegationDepth
    if (typeof depth === 'number' && depth > 0) { subSessions.add(session.id); return true }
    return false
  }

  // ── scene ──────────────────────────────────────────────────────────────────────────────────

  const scene = {
    seq: 0,
    lineSeq: 0,
    act: 'stand',
    at: Date.now(),
    mode: 'idle',
    line: '',
    deed: '',
    verb: '',
    target: '',
    face: 'calm',
    busy: false,
    reeling: false,
    lastActivity: Date.now(),
    lastWorkAt: 0,
  }

  const actOf = (name) => (CLIPS.acts[name] ? name : 'stand')
  const lx = (ru, en) => (config.lang === 'en' ? en : ru)
  // When the drawings are re-rendered the URL has to change, or the browser keeps the old PNGs.
  // The canvas size and the drawing count both move with a re-render (the count also covers a
  // boil pass that adds drawings to the same clips), so use both.
  const DRAWINGS = Object.values(CLIPS.acts).reduce((sum, act) => sum + act.steps.length, 0)
  const ASSET_V = `${CLIPS.canvas.width}x${CLIPS.canvas.height}-${DRAWINGS}`

  const tagOf = () => (TAG[config.lang] || TAG.ru)[scene.mode] || ''

  const snapshot = () => {
    const act = CLIPS.acts[actOf(scene.act)]
    return {
      seq: scene.seq,
      lineSeq: scene.lineSeq,
      name: NAME,
      act: scene.act,
      mode: scene.mode,
      at: scene.at,
      steps: act.steps,
      loop: act.loop,
      line: scene.line,
      deed: scene.deed,
      verb: scene.verb,
      target: scene.target,
      face: scene.face,
      tag: tagOf(),
      scale: config.scale,
      side: config.side,
      lang: config.lang,
      sound: config.sound,
      volume: config.volume,
      breaks: config.breaks,
      x: config.x,
      y: config.y,
      canvas: CLIPS.canvas,
      asset: ASSET_V,
    }
  }

  let revert = 0

  function play(act, options = {}) {
    // anything the world asks for stops a showreel: the run is an explicit demo, not a lock
    if (!options.reel) stopShowreel()
    const name = actOf(act)
    const data = CLIPS.acts[name]
    scene.act = name
    scene.at = Date.now()
    if (options.mode) scene.mode = options.mode
    if (options.line !== undefined) { scene.line = options.line; scene.lineSeq += 1 }
    if (options.deed !== undefined) scene.deed = options.deed
    if (options.verb !== undefined) scene.verb = options.verb
    if (options.target !== undefined) scene.target = options.target
    if (options.face) scene.face = options.face
    scene.seq += 1
    scene.lastActivity = Date.now()

    cancel(revert)
    revert = 0
    // A one-shot act falls back to rest when it is over, except the alarm: she stays in it until
    // the question is answered (the next tool call or the end of the turn moves her on).
    if (!data.loop && options.mode !== 'alert' && !options.reel) {
      const length = data.steps.reduce((sum, step) => sum + step[1], 0)
      revert = later(() => {
        if (scene.act === name) rest()
      }, length + 150)
    }
  }

  // Idle: she floats until she has been quiet long enough to fall asleep. There is no sitting
  // stage any more — the sitting pose renders crooked, so it was dropped.
  function rest() {
    if (scene.reeling) return
    scene.busy = false
    scene.deed = ''
    scene.verb = ''
    scene.target = ''
    const quiet = Date.now() - scene.lastActivity
    if (quiet > SLEEP_AFTER) {
      scene.mode = 'sleep'
      breakAnchor = 0
      play('sleep', { mode: 'sleep', face: FACE.sleep, line: lineFor('sleep', config.lang) })
      return
    }
    scene.mode = 'idle'
    // already standing there: restarting the loop would reset the drawing for no reason
    if (scene.act === 'stand') return
    play('stand', { mode: 'idle', face: FACE.idle })
  }

  let restTimer = 0
  function scheduleRest() {
    cancel(restTimer)
    restTimer = later(() => {
      if (scene.reeling) { scheduleRest(); return }
      const quiet = Date.now() - scene.lastActivity
      if (scene.busy) return
      if (scene.mode === 'alert') return
      const resting = scene.act === 'stand' || scene.act === 'sleep'
      if (!resting) { scheduleRest(); return }
      if (quiet > SLEEP_AFTER && scene.act !== 'sleep') { rest(); scheduleRest(); return }
      scheduleRest()
    }, 15_000)
  }

  // With nothing going on she says something now and then: the only path that reaches her idle
  // lines. Nothing to do for a few minutes, then a quiet remark — never while a clip or a question
  // is on screen, so it cannot interrupt work or an answer.
  let chatterTimer = 0
  function scheduleChatter(delay) {
    cancel(chatterTimer)
    chatterTimer = later(() => {
      try {
        // quiet for a while, nothing on screen of her own doing: a remark from the idle set
        const quiet = !scene.busy && !scene.reeling && scene.mode === 'idle'
          && scene.act !== 'sleep' && Date.now() - scene.lastActivity > 60_000
        if (quiet) {
          scene.line = lineFor('idle', config.lang)
          scene.lineSeq += 1
          scene.seq += 1
          scene.face = FACE.idle
        }
      } catch { /* her chatter must never break anything */ }
      scheduleChatter(180_000 + Math.random() * 240_000)
    }, delay ?? (60_000 + Math.random() * 60_000))
  }

  // ── what the agent does ────────────────────────────────────────────────────────────────────

  // Long unbroken work: after a while she stretches and suggests a pause, once per stretch of work.
  const BREAK_AFTER = 45 * 60_000
  let breakAnchor = 0
  function breakNudge(manual) {
    if (scene.reeling || scene.mode === 'alert') return false
    if (!manual && !config.breaks) return false
    breakAnchor = Date.now()
    play('stretch', { mode: 'work', line: lineFor('break', config.lang), face: FACE.idle })
    return true
  }
  function noteWork() {
    const now = Date.now()
    if (!breakAnchor) { breakAnchor = now; return }
    if (now - breakAnchor < BREAK_AFTER) return
    breakNudge(false)
  }

  function notice(tool, input) {
    const deed = deedOf(tool, input, config.lang)
    const now = Date.now()
    noteWork()
    errorStreak = 0
    if (!turn.started) turn.started = now
    turn.actions += 1
    if ((deed.deed === 'write' || deed.deed === 'edit') && deed.target && turn.files.size < 200) {
      turn.files.add(deed.target)
    }
    scene.busy = true
    scene.verb = deed.verb
    scene.target = deed.target
    scene.deed = [deed.verb, deed.text].filter(Boolean).join(' ')
    scene.lastActivity = now

    // fast tools must not restart the same drawing over and over: keep the act, refresh the line
    if (scene.act === deed.act && now - scene.lastWorkAt < 1_500) {
      scene.line = lineFor(deed.deed, config.lang)
      scene.lineSeq += 1
      scene.seq += 1
      scene.mode = 'work'
      scene.face = FACE[deed.deed] || 'look'
      return
    }
    scene.lastWorkAt = now
    play(deed.act, {
      mode: 'work',
      line: lineFor(deed.deed, config.lang),
      face: FACE[deed.deed] || 'look',
    })
  }

  function fail(tool) {
    scene.busy = false
    errorStreak += 1
    if (errorStreak >= 3) {
      // three failures in a row: she stops getting up and lies there until something happens
      play('ko', {
        mode: 'error',
        line: lineFor('down', config.lang),
        face: FACE.error,
        deed: plural(errorStreak, ['ошибка', 'ошибки', 'ошибок'], config.lang),
      })
      return
    }
    // the tool's name goes into the author's "{tool} упал" lines
    play('flinch', {
      mode: 'error',
      line: lineFor('error', config.lang, tool || ''),
      face: FACE.error,
    })
  }

  const errorStreakReset = () => { errorStreak = 0 }

  // The summary she shows when a turn ends: actions, files touched, how long it took.
  function turnSummary() {
    if (!turn.actions) return ''
    const parts = [
      plural(turn.actions, ['действие', 'действия', 'действий'], config.lang),
      plural(turn.files.size, ['файл', 'файла', 'файлов'], config.lang),
      formatSpan(Date.now() - (turn.started || Date.now()), config.lang),
    ]
    return parts.join(' · ')
  }

  function resetTurn() {
    turn.actions = 0
    turn.files.clear()
    turn.started = 0
  }

  function done() {
    if (Date.now() - doneAt < 400) return
    doneAt = Date.now()
    scene.busy = false
    scene.deed = ''
    scene.verb = ''
    scene.target = ''
    const summary = turnSummary()
    resetTurn()
    play('victory', { mode: 'done', line: lineFor('done', config.lang), face: FACE.done, deed: summary })
  }
  let doneAt = 0
  const seenAgents = new WeakSet()

  // `agent/*` events are dispatched through the agent's scope carrier, and an agent's own filter
  // keeps listeners registered outside that agent from ever seeing them (a root listener never
  // fires for them). So every agent event she needs is subscribed per agent, on the agent's own
  // context — the agent itself arrives in tool payloads.
  function attachAgent(agent) {
    try {
      if (!agent || seenAgents.has(agent)) return
      // a subagent's own turn end is not the end of the job: she celebrates the main agent only
      if (isSubSession(agent.session)) return
      const actx = agent.ctx
      if (!actx || typeof actx.on !== 'function') return
      seenAgents.add(agent)
      stats.agents += 1
      const agentSession = (agent.session && agent.session.id) || ''
      const offs = [
        actx.on('agent/turn-stopping', () => { try { if (watching(agentSession)) done() } catch { /* silent */ } }),
        actx.on('agent/error', () => { try { if (watching(agentSession)) fail('') } catch { /* silent */ } }),
        actx.on('agent/status', (payload) => { try { if (watching(agentSession)) onStatus(payload) } catch { /* silent */ } }),
      ]
      if (typeof actx.effect === 'function') {
        actx.effect(() => () => {
          for (const off of offs) {
            try { if (typeof off === 'function') off() } catch { /* silent */ }
          }
        })
      }
    } catch { /* never break a tool */ }
  }

  function onStatus(payload) {
    const status = payload && payload.status
    if (status === 'running') {
      scene.busy = true
      scene.lastActivity = Date.now()
      // the agent starts again after a long sleep: she wakes up and stretches
      if (scene.act === 'sleep') play('stretch', { mode: 'work', line: lineFor('wake', config.lang), face: 'look' })
      return
    }
    if (status !== 'idle') return
    scene.lastActivity = Date.now()
    // the end of a turn is announced several ways: without this guard an idle notice would cut her
    // victory pose after a few frames
    if (scene.mode !== 'alert' && scene.mode !== 'done' && scene.mode !== 'error') rest()
  }

  function alert(what) {
    if (!config.alerts) return
    scene.busy = false
    play('alarm', {
      mode: 'alert',
      line: lineFor('alert', config.lang),
      face: FACE.alert,
      deed: lx('нужно решение', 'needs a decision') + (what ? ` · ${what}` : ''),
    })
  }

  function poke() {
    scene.lastActivity = Date.now()
    play('petted', { line: lineFor('poke', config.lang), face: FACE.poke })
  }

  // The answer came: she lets go of the alarm. Refused reads as a sulk, not a celebration.
  function released(outcome) {
    if (scene.mode !== 'alert') return
    if (outcome === 'cancelled' || outcome === 'unavailable') {
      play('shake', { mode: 'idle', line: lineFor('cancelled', config.lang), face: 'wide' })
      return
    }
    if (outcome === 'rejected') {
      play('huff', { mode: 'work', line: lineFor('refused', config.lang), face: 'smug' })
      return
    }
    play('turn', { mode: 'work', line: lineFor('go', config.lang), face: 'smug' })
  }

  // ── showreel: every clip in turn, on demand ────────────────────────────────────────────────

  // A little story rather than alphabetical. Only clips that actually exist are played.
  const REEL_ORDER = [
    'stand', 'sleep', 'talk', 'curious', 'look', 'point', 'gaze', 'stretch', 'huff',
    'petted', 'hop', 'land', 'shake', 'turn', 'grabbed', 'ko', 'split', 'zap', 'flinch', 'victory', 'alarm',
  ]

  let reelToken = 0
  let reelTimer = 0

  function stopShowreel() {
    if (!scene.reeling && !reelTimer) return
    reelToken += 1
    cancel(reelTimer)
    reelTimer = 0
    scene.reeling = false
  }

  // Plays one clip per step and holds each for its own length, so a one-shot is seen whole and a
  // loop gets exactly one cycle. The panel names the clip being shown.
  function showreelAll() {
    stopShowreel()
    const list = REEL_ORDER.filter((name) => CLIPS.acts[name])
    if (!list.length) return []
    const token = (reelToken += 1)
    scene.reeling = true
    const step = (index) => {
      if (token !== reelToken) return
      if (index >= list.length) {
        scene.reeling = false
        rest()
        return
      }
      const name = list[index]
      play(name, {
        mode: 'idle',
        reel: true,
        line: lx(`клип ${index + 1}/${list.length}: ${name}`, `clip ${index + 1}/${list.length}: ${name}`),
        face: 'smug',
        deed: name,
      })
      const length = CLIPS.acts[name].steps.reduce((sum, frame) => sum + frame[1], 0)
      reelTimer = later(() => step(index + 1), length + 350)
    }
    step(0)
    return list
  }

  function playOne(act) {
    if (!CLIPS.acts[act]) return false
    // play() stops a running showreel by itself
    play(act, { mode: 'idle', line: act, face: 'smug', deed: act })
    return true
  }

  // ── events ────────────────────────────────────────────────────────────────────────────────

  // Which session the window is showing, reported by the client (it reads the GUI's own
  // data-conversation-session attribute). Empty means "unknown": then she watches everything, which
  // is the behaviour of an older client and the safe fallback.
  let focused = ''
  const FOCUS_RE = /^[A-Za-z0-9_.:-]{1,128}$/
  const watching = (sessionId) => !focused || !sessionId || sessionId === focused

  ctx.on('tools/pre-execute', function preExecute(exec, next) {
    try {
      const tool = exec && exec.name
      const input = exec && exec.arguments
      attachAgent(exec && exec.agent)
      const sessionId = exec && exec.agent && exec.agent.session && exec.agent.session.id
      if (tool && watching(sessionId)) notice(tool, input)
    } catch { /* an observer must not break the tool */ }
    // never answer the waterfall on the tool's behalf: no decision, or hand it on
    return typeof next === 'function' ? next() : undefined
  })

  ctx.on('tools/result', function toolResult(exec, result) {
    try {
      if (result && result.isError) { fail(String((exec && (exec.name || exec.tool)) || '')); return }
      // a failure that got fixed: she hops instead of quietly going back to work
      if (errorStreak > 0) {
        errorStreak = 0
        play('hop', { mode: 'work', line: lineFor('recovered', config.lang), face: 'laugh' })
        return
      }
      errorStreakReset()
    } catch { /* silent */ }
  })

  // (agent/error, agent/status and agent/turn-stopping live on the agent's own context: see
  // attachAgent. Registered here they would never fire.)

  // A permission question, read from the session log instead of the approval waterfall: the audit
  // events `approval/asked` / `approval/decided` are appended to the log, and the `session/event`
  // feed reaches plugins regardless of how the agent's scope is tagged. It also gives the exact
  // moment the question is answered, which the waterfall never did.
  // A workspace she is not watching finished. That is not a victory for the window the user is in:
  // she hops, says so, and then the scene she was in comes back untouched.
  let otherDoneAt = 0
  function otherDone() {
    if (Date.now() - otherDoneAt < 8000) return
    if (scene.reeling || scene.mode === 'alert') return
    otherDoneAt = Date.now()
    const before = {
      mode: scene.mode, line: scene.line, face: scene.face,
      deed: scene.deed, verb: scene.verb, target: scene.target, busy: scene.busy,
    }
    play('hop', { mode: 'idle', line: lineFor('other', config.lang), face: FACE.idle, deed: '' })
    const length = CLIPS.acts.hop.steps.reduce((sum, step) => sum + step[1], 0)
    later(() => {
      // the hop is over and rest() already wiped the ticker: put the open workspace back
      if (scene.act !== 'stand' && scene.act !== 'hop') return
      scene.busy = before.busy
      scene.mode = before.mode
      scene.line = before.line
      scene.face = before.face
      scene.deed = before.deed
      scene.verb = before.verb
      scene.target = before.target
      scene.seq += 1
    }, length + 220)
  }

  ctx.on('session/event', function sessionEvent(session, event) {
    try {
      if (!event || typeof event.type !== 'string') return
      stats.events += 1
      // which event types actually reach a plugin, so a missing one is visible instead of guessed
      if (Object.keys(stats.types).length < 60) stats.types[event.type] = (stats.types[event.type] || 0) + 1
      // the descriptor is appended inside the child's own session: that session is a subagent, and
      // she follows the main one only
      if (event.type === 'subagent/descriptor') {
        if (session && session.id) {
          subSessions.add(session.id)
          // a long-lived app can see many sessions; this set is only a filter, not a history
          if (subSessions.size > 400) subSessions.clear()
        }
        return
      }
      if (isSubSession(session)) return
      // another workspace finished: a quiet line, not a victory for the window that is open
      if (event.type === 'turn/end' && focused && session && session.id && session.id !== focused) {
        otherDone()
        return
      }
      // another workspace is running: she follows the window that is actually open
      if (!watching(session && session.id)) return
      // a new turn starts clean: the previous summary and the error streak belong to the old one
      if (event.type === 'turn/start') {
        resetTurn()
        errorStreak = 0
        return
      }
      if (event.type === 'approval/asked') {
        stats.approvals += 1
        stats.lastApproval = Date.now()
        const tool = event.data && event.data.toolName
        alert(tool ? String(tool) : '')
      } else if (event.type === 'approval/decided') {
        released(event.data && event.data.outcome)
      } else if (event.type === 'turn/end') {
        // the end of a turn, from the log: `agent/turn-stopping` never reached a root listener
        stats.turns += 1
        done()
      }
    } catch { /* an observer must never break a turn */ }
  })

  // ── settings ──────────────────────────────────────────────────────────────────────────────

  const publicConfig = () => ({
    scale: config.scale,
    side: config.side,
    lang: config.lang,
    alerts: config.alerts,
    sound: config.sound,
    volume: config.volume,
    breaks: config.breaks,
    x: config.x,
    y: config.y,
    approvals: stats.approvals,
    lastApproval: stats.lastApproval,
    events: stats.events,
    turns: stats.turns,
    agents: stats.agents,
    // how many pet instances the most recent page mounted (more than one = stacked copies)
    pets: Array.from(petPages.values()).at(-1) || 0,
    pages: petPages.size,
    // which session the window is showing; empty means she watches every session
    focused,
    types: stats.types,
    acts: ACT_NAMES.length,
    // name -> drawing count, small enough to ship on every settings open (the full steps are only
    // needed by the state feed, which the pet polls anyway)
    clips: Object.fromEntries(ACT_NAMES.map((name) => [name, CLIPS.acts[name].steps.length])),
  })

  async function saveConfig() {
    try {
      await mkdir(path.dirname(CONFIG_PATH), { recursive: true })
      await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    } catch { /* settings must not break her */ }
  }

  const configReady = (async () => {
    try {
      const data = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
      config.scale = clampScale(data.scale)
      config.side = clampSide(data.side)
      config.lang = clampLang(data.lang)
      if (data.alerts !== undefined) config.alerts = data.alerts === true || data.alerts === 'true'
      if (data.sound !== undefined) config.sound = data.sound === true || data.sound === 'true'
      if (data.volume !== undefined) config.volume = clampVolume(data.volume)
      if (data.breaks !== undefined) config.breaks = data.breaks !== false
      if (data.x !== undefined) config.x = clampOffset(data.x)
      if (data.y !== undefined) config.y = clampOffset(data.y)
    } catch { /* no settings yet */ }
  })()

  // ── HTTP ─────────────────────────────────────────────────────────────────────────────────

  // Every answer says what it is and refuses to be sniffed into something else: a JSON body can
  // never be read as HTML or a script, even if a local page manages to request it.
  const SECURE = { 'x-content-type-options': 'nosniff' }

  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { ...SECURE, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })

  const header = (request, name) => {
    if (!request || !request.headers) return undefined
    if (typeof request.headers.get === 'function') return request.headers.get(name)
    return request.headers[name.toLowerCase()]
  }

  // Browsers always send sec-fetch-site; hooks and local clients never do. Refusing cross-site
  // requests keeps random web pages from driving her.
  const sameOrigin = (request) => {
    const site = header(request, 'sec-fetch-site')
    return !site || site === 'same-origin' || site === 'none'
  }

  // sec-fetch-site alone is not enough: a page on a domain that resolves to 127.0.0.1 (DNS
  // rebinding) is "same-origin" to the browser, yet it sends its own name as Host. Only the loopback
  // names are trusted, so such a page cannot read what the agent is working on or change settings.
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  const extraHosts = String(process.env.CAPRI_TRUST_HOST || '')
    .toLowerCase().split(',').map((host) => host.trim()).filter(Boolean)
  const hostAllowed = (request) => {
    const raw = String(header(request, 'host') || '').toLowerCase()
    if (!raw) return true // no Host at all: a plain local client, never a browser
    const name = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
    return LOOPBACK.has(name) || extraHosts.includes(name)
  }

  const trusted = (request) => sameOrigin(request) && hostAllowed(request)

  const stateRoute = async (request) => (trusted(request) ? json(snapshot()) : new Response('forbidden', { status: 403 }))

  const configRoute = async (request) => {
    if (!trusted(request)) return new Response('forbidden', { status: 403 })
    await configReady
    return json(publicConfig())
  }

  const readBody = (request, limit = 65_536) => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('payload too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch { reject(new Error('invalid JSON')) }
    })
    request.on('error', reject)
  })

  const handler = (fn) => async (request, response) => {
    const headers = { ...SECURE, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    const send = (status, value) => {
      // a rejected oversized body destroys the request: writing to it would throw out of the handler
      try {
        response.writeHead(status, headers)
        response.end(JSON.stringify(value))
      } catch { /* the socket is gone; nothing to answer */ }
    }
    if (!trusted(request)) return send(403, { ok: false, error: 'forbidden' })
    if (request.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
    const type = String(header(request, 'content-type') || '')
    if (!type.includes('application/json')) return send(415, { ok: false, error: 'application/json required' })
    try {
      const body = await readBody(request)
      const value = await fn(body, request)
      send(200, value)
    } catch (error) {
      send(400, { ok: false, error: String((error && error.message) || error) })
    }
  }

  const saveSettings = handler(async (body) => {
    await configReady
    if (body && typeof body.scale !== 'undefined') config.scale = clampScale(body.scale)
    if (body && typeof body.side === 'string') config.side = clampSide(body.side)
    if (body && typeof body.lang === 'string') {
      const next = clampLang(body.lang)
      if (next !== config.lang) {
        config.lang = next
        scene.line = lineFor('hello', config.lang)
        scene.lineSeq += 1
      }
    }
    if (body && body.alerts !== undefined) {
      // strict: a stored "false" string must not read as true
      config.alerts = body.alerts === true || body.alerts === 'true'
    }
    if (body && body.sound !== undefined) config.sound = body.sound === true || body.sound === 'true'
    if (body && body.volume !== undefined) config.volume = clampVolume(body.volume)
    if (body && body.breaks !== undefined) config.breaks = body.breaks === true || body.breaks === 'true'
    if (body && body.x !== undefined) config.x = clampOffset(body.x)
    if (body && body.y !== undefined) config.y = clampOffset(body.y)
    await saveConfig()
    return { ok: true, ...publicConfig() }
  })

  // A change of her state goes through POST: a GET could be triggered by any <img> or <link>
  // a page manages to inject.
  const pokeHandler = handler(async () => {
    poke()
    return { ok: true }
  })

  // A mounted pet reports itself. Two or more on one page means the page stacked client copies
  // (a reload gone wrong after a plugin update), which looks like a duplicated panel on screen.
  const helloHandler = handler(async (body) => {
    const page = String((body && body.page) || '?').slice(0, 64)
    const count = (petPages.get(page) || 0) + 1
    petPages.set(page, count)
    if (petPages.size > PET_PAGES_LIMIT) petPages.delete(petPages.keys().next().value)
    return { ok: true, pets: count, pages: petPages.size }
  })

  // On demand: show one clip (`{ act }`) or run through every clip (`{ act: 'all' }`).
  const poseHandler = handler(async (body) => {
    const act = body && typeof body.act === 'string' ? body.act.trim() : ''
    if (!act) throw new Error(`act is required; one of: ${ACT_NAMES.join(', ')}, all`)
    if (act === 'all' || act === 'reel') {
      const list = showreelAll()
      return { ok: true, reel: list, total: list.length }
    }
    if (!playOne(act)) throw new Error(`unknown act: ${act}`)
    return { ok: true, act }
  })

  // Doing nothing for a while, she finds something to do herself: a short gesture instead of the
  // same idle loop for minutes on end.
  let gestureTimer = 0
  const GESTURES = ['look', 'curious', 'point', 'stretch', 'gaze', 'hop']
  function scheduleGesture(delay) {
    cancel(gestureTimer)
    gestureTimer = later(() => {
      scheduleGesture(18_000 + Math.random() * 22_000)
      if (scene.reeling || scene.busy || scene.mode !== 'idle' || scene.act !== 'stand') return
      const act = GESTURES[Math.floor(Math.random() * GESTURES.length)]
      play(act, { mode: 'idle', face: FACE.idle })
    }, delay || (18_000 + Math.random() * 22_000))
  }

  // The client reports which session the window shows. Empty clears the filter.
  const focusHandler = handler(async (body) => {
    const id = body && typeof body.id === 'string' ? body.id.trim() : ''
    if (id && !FOCUS_RE.test(id)) throw new Error('bad session id')
    focused = id
    return { ok: true, focused }
  })

  // A clip without a caption: dragging her should not make the panel announce "grabbed".
  const touchHandler = handler(async (body) => {
    const act = body && typeof body.act === 'string' ? body.act.trim() : ''
    if (!CLIPS.acts[act] || !['grabbed', 'land', 'hop', 'petted'].includes(act)) throw new Error(`unknown touch act: ${act}`)
    scene.busy = false
    scene.deed = ''
    play(act, {})
    return { ok: true, act }
  })

  // The scene as a stream: one connection instead of four polls a second. Only changes are written,
  // plus a keep-alive comment so a quiet scene does not look like a dead socket.
  let streamClients = 0
  const MAX_STREAMS = 6
  const streamHandler = (request, response) => {
    try {
      if (!trusted(request)) { response.writeHead(403, { ...SECURE, 'content-type': 'text/plain; charset=utf-8' }); response.end('forbidden'); return }
      if (request.method !== 'GET') { response.writeHead(405, { ...SECURE }); response.end(); return }
      // a local process can hold streams open; past a handful the cost is not worth serving
      if (streamClients >= MAX_STREAMS) {
        response.writeHead(503, { ...SECURE, 'content-type': 'text/plain; charset=utf-8' })
        response.end('too many streams')
        return
      }
      streamClients += 1
      response.writeHead(200, {
        ...SECURE,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      let lastSeq = -1
      const push = () => {
        try {
          const next = snapshot()
          if (next.seq === lastSeq) return
          lastSeq = next.seq
          response.write(`data: ${JSON.stringify(next)}\n\n`)
        } catch { /* the socket is gone */ }
      }
      push()
      const timer = setInterval(push, 250)
      const ping = setInterval(() => { try { response.write(': ping\n\n') } catch { /* closed */ } }, 15_000)
      let closed = false
      const stop = () => {
        if (closed) return
        closed = true
        streamClients -= 1
        clearInterval(timer)
        clearInterval(ping)
      }
      request.on('close', stop)
      request.on('error', stop)
      response.on('close', stop)
    } catch { /* a dead stream must not take the host down */ }
  }

  // Manual break, also used by `/capri break` and by the checks.
  const breakHandler = handler(async () => {
    if (!breakNudge(true)) throw new Error('she cannot take a break right now')
    return { ok: true, act: 'stretch' }
  })

  const server = ctx.webServer
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/state', resource: stateRoute }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/stream', handler: streamHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/poke', handler: pokeHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/hello', handler: helloHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/focus', handler: focusHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/break', handler: breakHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/pose', handler: poseHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/touch', handler: touchHandler }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/config', resource: configRoute }))
  ctx.effect(() => server.register({ kind: 'exact', path: '/capri/settings', handler: saveSettings }))

  // `/capri all` runs the showreel, `/capri <clip>` shows one. Typing it is the point: a demo she
  // does when asked, not a state the world has to leave.
  try {
    const commands = ctx.get('commands')
    if (commands && typeof commands.register === 'function') {
      ctx.effect(() => commands.register({
        name: 'capri',
        description: 'Капри: /capri all — показать все клипы, /capri <клип> — один',
        handler: (invocation) => {
          const word = String((invocation && invocation.rawInput) || '').trim().toLowerCase()
          if (!word || word === 'all' || word === 'все') {
            const list = showreelAll()
            return { kind: 'success', text: lx(`Показываю ${list.length} клипов.`, `Showing ${list.length} clips.`) }
          }
          if (word === 'break' || word === 'перерыв') {
            return breakNudge(true)
              ? { kind: 'success', text: lx('Перерыв. Разомнись.', 'Break. Stretch.') }
              : { kind: 'error', text: lx('Сейчас не до перерыва.', 'Not now.') }
          }
          if (!playOne(ACT_NAMES.find((name) => name.toLowerCase() === word))) {
            return { kind: 'error', text: `Клипы: ${ACT_NAMES.join(', ')}` }
          }
          return { kind: 'success', text: `Клип: ${word}` }
        },
      }))
    }
  } catch { /* commands are optional */ }

  ctx.effect(() => () => {
    clearLater()
    cancel(restTimer)
    cancel(chatterTimer)
  })

  Promise.allSettled([configReady]).then(() => {
    rest()
    scheduleRest()
    scheduleChatter()
    scheduleGesture()
    // she says hello with her talking nod instead of standing there silently
    later(() => {
      play('talk', { mode: 'idle', line: lineFor('hello', config.lang), face: 'smug' })
    }, 600)
  })
}
