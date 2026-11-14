// Review harness: runs the host half in a fake Cordis context and calls the real routes.
// Verifies the security guards (origin + Host, POST-only mutations) and the settings clamps.
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'

// the host half writes its settings through DSH_HOME: never point that at the real profile
process.env.DSH_HOME = mkdtempSync(path.join(os.tmpdir(), 'capri-review-'))
console.log(`settings sandbox: ${process.env.DSH_HOME}`)

const routes = new Map()
const listeners = new Map()

const ctx = {
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  on(name, fn) {
    listeners.set(name, fn)
    return () => listeners.delete(name)
  },
  effect(fn) {
    const dispose = fn()
    return dispose
  },
}

const mod = await import('../index.js')
mod.apply(ctx)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` вЂ” ${detail}` : ''}`)
}

// a fetch-style request double: only headers.get is used by the routes
const gate = (headers) => ({ headers: { get: (k) => headers[k.toLowerCase()] } })

const headers = (extra = {}) => ({ host: '127.0.0.1:49529', ...extra })

async function getState(h) {
  return routes.get('/capri/state').resource(gate(h))
}
async function getConfig(h) {
  return routes.get('/capri/config').resource(gate(h))
}

// a node-style request/response double for the POST handler
function post(body, h, { method = 'POST', type = 'application/json' } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.destroy = () => {}
  req.headers = { get: (k) => h[k.toLowerCase()] }
  if (type) req.headers.get = ((base) => (k) => (k.toLowerCase() === 'content-type' ? type : base(k)))(req.headers.get)
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status) { out.status = status },
    end(body) { out.body = body || '' },
  }
  return { req, res, out, run: (fn) => fn(req, res) }
}

async function callPost(path, body, h, opts) {
  const { res, out, req } = post(body, h, opts)
  await routes.get(path).handler(req, res)
  return { status: out.status, json: (() => { try { return JSON.parse(out.body) } catch { return null } })() }
}

// в”Ђв”Ђ origin and host guards в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
check('state: loopback host + no site header', (await getState(headers())).status === 200)
check('state: cross-site refused', (await getState(headers({ 'sec-fetch-site': 'cross-site' }))).status === 403)
check('state: rebound DNS name refused', (await getState({ host: 'evil.example:49529', 'sec-fetch-site': 'same-origin' })).status === 403)
check('state: LAN name refused', (await getState({ host: '192.168.1.10:49529' })).status === 403)
check('state: localhost allowed', (await getState({ host: 'localhost:49529' })).status === 200)
check('state: [::1] allowed', (await getState({ host: '[::1]:49529' })).status === 200)
check('state: client without Host allowed', (await getState({})).status === 200)
check('config: rebound name refused', (await getConfig({ host: 'evil.example' })).status === 403)

const state = await (await getState(headers())).json()
check('state: carries the asset version', typeof state.asset === 'string' && state.asset.length > 2, state.asset)
check('state: carries the frame canvas', state.canvas && state.canvas.width === 708, JSON.stringify(state.canvas))

// в”Ђв”Ђ mutations are POST + JSON, and the values are clamped в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const pk = await callPost('/capri/poke', {}, headers())
check('poke: POST accepted', pk.status === 200 && pk.json && pk.json.ok === true)
const pokeGet = await callPost('/capri/poke', {}, headers(), { method: 'GET' })
check('poke: GET refused', pokeGet.status === 405)
const pokeSite = await callPost('/capri/poke', {}, headers({ 'sec-fetch-site': 'cross-site' }))
check('poke: cross-site refused', pokeSite.status === 403)
const pokeHost = await callPost('/capri/poke', {}, { host: 'evil.example' })
check('poke: rebound name refused', pokeHost.status === 403)

const form = await callPost('/capri/settings', { scale: 400 }, headers(), { type: 'text/plain' })
check('settings: non-JSON content type refused', form.status === 415)
const evilSettings = await callPost('/capri/settings', { scale: 400 }, { host: 'evil.example' })
check('settings: rebound name refused', evilSettings.status === 403)

const big = await callPost('/capri/settings', { scale: 9999 }, headers())
check('settings: scale clamped to 400', big.json && big.json.scale === 400, String(big.json && big.json.scale))
const small = await callPost('/capri/settings', { scale: -5 }, headers())
check('settings: scale clamped to 50', small.json && small.json.scale === 50, String(small.json && small.json.scale))
const junk = await callPost('/capri/settings', { scale: 'abc' }, headers())
check('settings: junk scale falls back to 100', junk.json && junk.json.scale === 100, String(junk.json && junk.json.scale))
const sideBad = await callPost('/capri/settings', { side: 'middle' }, headers())
check('settings: bad side falls back to right', sideBad.json && sideBad.json.side === 'right')
const langBad = await callPost('/capri/settings', { lang: 'xx' }, headers())
check('settings: bad lang falls back to ru', langBad.json && langBad.json.lang === 'ru')
const alertsStr = await callPost('/capri/settings', { alerts: 'false' }, headers())
check('settings: "false" string is false, not true', alertsStr.json && alertsStr.json.alerts === false, String(alertsStr.json && alertsStr.json.alerts))
const alertsOn = await callPost('/capri/settings', { alerts: true }, headers())
check('settings: alerts can be turned back on', alertsOn.json && alertsOn.json.alerts === true)

// ── sound settings ─────────────────────────────────────────────────────────────────────────────
const soundOff = await callPost('/capri/settings', { sound: false }, headers())
check('sound: can be turned off', soundOff.json && soundOff.json.sound === false, String(soundOff.json && soundOff.json.sound))
const soundOn = await callPost('/capri/settings', { sound: true }, headers())
check('sound: can be turned back on', soundOn.json && soundOn.json.sound === true)
const volHigh = await callPost('/capri/settings', { volume: 150 }, headers())
check('volume: clamped to 100', volHigh.json && volHigh.json.volume === 100, String(volHigh.json && volHigh.json.volume))
const volLow = await callPost('/capri/settings', { volume: -5 }, headers())
check('volume: clamped to 0', volLow.json && volLow.json.volume === 0, String(volLow.json && volLow.json.volume))
const volJunk = await callPost('/capri/settings', { volume: 'abc' }, headers())
check('volume: junk falls back to 0', volJunk.json && volJunk.json.volume === 0, String(volJunk.json && volJunk.json.volume))
const volOk = await callPost('/capri/settings', { volume: 30 }, headers())
check('volume: normal value sticks', volOk.json && volOk.json.volume === 30)
const pet1 = await callPost('/capri/hello', {}, headers())
const pet2 = await callPost('/capri/hello', {}, headers())
check('hello: counts mounted pets', pet1.json && pet1.json.pets === 1 && pet2.json && pet2.json.pets === 2, `${pet1.json && pet1.json.pets}->${pet2.json && pet2.json.pets}`)
const petSite = await callPost('/capri/hello', {}, headers({ 'sec-fetch-site': 'cross-site' }))
check('hello: cross-site refused', petSite.status === 403)
const petsCfg = await (await getConfig(headers())).json()
check('hello: pets visible in config', petsCfg.pets === 2, String(petsCfg.pets))
const soundState = await (await getState(headers())).json()
check('sound: the scene carries sound and volume', soundState.sound === true && soundState.volume === 30, `${soundState.sound}/${soundState.volume}`)

// в”Ђв”Ђ the approval waterfall must always delegate в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const approval = listeners.get('session/event')
check('approval: session feed registered', typeof approval === 'function')
check('approval: the decision waterfall is never hooked', listeners.has('approval/request') === false)

approval({ id: 's' }, { type: 'approval/asked', data: { id: 'a1', toolName: 'write' } })
const afterAlert = await (await getState(headers())).json()
check('approval: asked puts her in the alarm', afterAlert.mode === 'alert' && afterAlert.act === 'alarm', `${afterAlert.mode}/${afterAlert.act}`)
const askedCfg = await (await getConfig(headers())).json()
check('approval: counted once', askedCfg.approvals === 1, String(askedCfg.approvals))
check('approval: session events are counted', askedCfg.events >= 1, String(askedCfg.events))

approval({ id: 's' }, { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } })
const allowed = await (await getState(headers())).json()
check('approval: answered -> she turns back to work', allowed.mode === 'work' && allowed.act === 'turn', `${allowed.mode}/${allowed.act}`)

approval({ id: 's' }, { type: 'approval/asked', data: { id: 'a2', toolName: 'pwsh' } })
approval({ id: 's' }, { type: 'approval/decided', data: { id: 'a2', outcome: 'rejected' } })
const refused = await (await getState(headers())).json()
check('approval: refused -> she sulks', refused.act === 'huff', refused.act)

approval(undefined, undefined)
approval({ id: 's' }, { type: 'turn/start', data: {} })
check('approval: junk events do not throw', true)

// a tool call has to bring her back to work
const pre = listeners.get('tools/pre-execute')
let nextCalled = 0
const decided = pre({ name: 'read', arguments: { file_path: 'C:/x/gigs.ts' } }, () => { nextCalled += 1 })
check('tool: delegates to next()', nextCalled === 1 && decided === undefined)
const afterTool = await (await getState(headers())).json()
check('tool: she left the alarm for work', afterTool.mode === 'work' && afterTool.act === 'look', `${afterTool.mode}/${afterTool.act}`)
check('tool: ticker carries the file', String(afterTool.deed).includes('gigs.ts'), afterTool.deed)
const missingNext = pre({ name: 'read', arguments: {} }, undefined)
check('tool: missing next() does not throw', missingNext === undefined)

// ── the outcome events: a failed tool, an agent error, the end of a turn ─────────────────────
const onResult = listeners.get('tools/result')
check('result: listener registered', typeof onResult === 'function')
onResult({}, { isError: false })
const noFail = await (await getState(headers())).json()
check('result: a good result does not flinch', noFail.act !== 'flinch', noFail.act)
onResult({}, { isError: true })
const flinchState = await (await getState(headers())).json()
check('result: a failed tool makes her flinch', flinchState.mode === 'error' && flinchState.act === 'flinch', `${flinchState.mode}/${flinchState.act}`)

const onAgentError = listeners.get('agent/error')
check('error: no dead root listener for agent events', onAgentError === undefined)

// agent-scoped events: the host hands its own agent out in tool payloads, and only that agent's
// context receives agent/* — so the harness subscribes through the same path the host uses
const agentCtxEvents = new Map()
const fakeAgent = {
  id: 'agent-test',
  ctx: {
    on(name, fn) {
      const list = agentCtxEvents.get(name) || []
      list.push(fn)
      agentCtxEvents.set(name, list)
      return () => {}
    },
    effect(fn) { return fn() },
  },
}
pre({ name: 'read', arguments: { file_path: 'C:/x/a.ts' }, agent: fakeAgent }, () => {})
check('agent: its context is subscribed', ['agent/turn-stopping', 'agent/status', 'agent/error'].every((name) => agentCtxEvents.has(name)), [...agentCtxEvents.keys()].join(', '))
const attached = await (await getConfig(headers())).json()
check('agent: counted once', attached.agents === 1, String(attached.agents))

agentCtxEvents.get('agent/status')[0]({ status: 'idle' })
const afterIdle = await (await getState(headers())).json()
check('status: idle puts her back at rest', afterIdle.mode === 'idle' && afterIdle.act === 'stand', `${afterIdle.mode}/${afterIdle.act}`)

agentCtxEvents.get('agent/error')[0]({})
const afterAgentError = await (await getState(headers())).json()
check('error: agent/error flinches too', afterAgentError.act === 'flinch', afterAgentError.act)

agentCtxEvents.get('agent/turn-stopping')[0]({ turn: {} })
const afterTurn = await (await getState(headers())).json()
check('turn end: her own agent context celebrates', afterTurn.mode === 'done' && afterTurn.act === 'victory', `${afterTurn.mode}/${afterTurn.act}`)
approval({ id: 's' }, { type: 'turn/end', data: { turn: {} } })
const afterBoth = await (await getState(headers())).json()
check('turn end: both paths do not double-fire', afterBoth.mode === 'done' && afterBoth.act === 'victory', `${afterBoth.mode}/${afterBoth.act}`)
const seenTurns = await (await getConfig(headers())).json()
check('turn end: counted', seenTurns.turns === 1, String(seenTurns.turns))

// ── on-demand playback ───────────────────────────────────────────────────────────────────────
const one = await callPost('/capri/pose', { act: 'victory' }, headers())
check('pose: one clip accepted', one.status === 200 && one.json && one.json.act === 'victory', JSON.stringify(one.json && one.json.act))
const afterOne = await (await getState(headers())).json()
check('pose: that clip is on screen', afterOne.act === 'victory' && afterOne.mode === 'idle', `${afterOne.mode}/${afterOne.act}`)
const bad = await callPost('/capri/pose', { act: 'nope' }, headers())
check('pose: unknown clip refused', bad.status === 400 && /unknown act/.test((bad.json && bad.json.error) || ''), String(bad.status))
const empty = await callPost('/capri/pose', {}, headers())
check('pose: missing act refused', empty.status === 400, String(empty.status))
const reel = await callPost('/capri/pose', { act: 'all' }, headers())
check('pose: showreel lists every clip once', reel.json && Array.isArray(reel.json.reel) && reel.json.total === reel.json.reel.length && new Set(reel.json.reel).size === reel.json.total, String(reel.json && reel.json.total))
const afterReel = await (await getState(headers())).json()
check('pose: showreel starts at the first clip', afterReel.act === 'stand' && afterReel.mode === 'idle', `${afterReel.mode}/${afterReel.act}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
// the host keeps a 15s rest timer alive; the harness is a one-shot check
process.exit(failed.length ? 1 : 0)

