// Browser half: Capri in the corner of the window (shell.overlay) and her settings page.
// The scene comes from the host over /capri/state; the drawings are package assets, played with the
// hold timings baked next to them (assets/clips.json -> scene.steps).
window.__ModuleLoader__.load({
  id: 'dsh-capri',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const STATE_URL = '/capri/state'
    const CONFIG_URL = '/capri/config'
    const POKE_URL = '/capri/poke'
    const SETTINGS_URL = '/capri/settings'

    const frameSrc = (act, frame, v = '2') => `/plugins/dsh-capri/assets/frames/${encodeURIComponent(act)}/${encodeURIComponent(frame)}.png?v=${encodeURIComponent(v)}`
    const faceSrc = (face) => `/plugins/dsh-capri/assets/faces/${encodeURIComponent(face || 'calm')}.png?v=2`

    // ── one poll for the whole page ──────────────────────────────────────────────────────────

    const listeners = new Set()
    let current = null
    let timer = null
    let inflight = false

    async function poll() {
      if (inflight) return
      inflight = true
      try {
        const response = await fetch(STATE_URL, { cache: 'no-store' })
        if (response.ok) {
          const next = await response.json()
          current = next
          for (const listener of listeners) {
            try { listener(next) } catch { /* one bad subscriber must not stop the others */ }
          }
        }
      } catch {
        // the host can be restarting: keep the last scene on screen
      } finally {
        inflight = false
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      if (!timer) {
        timer = setInterval(poll, 250)
        poll()
      }
      if (current) listener(current)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    }

    function useScene() {
      const [scene, setScene] = useState(current)
      useEffect(() => subscribe(setScene), [])
      return scene
    }

    function useTick(active, ms) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        let alive = true
        const id = setInterval(() => { if (alive) setNow(Date.now()) }, ms)
        return () => { alive = false; clearInterval(id) }
      }, [active, ms])
      return now
    }

    const reducedMotion = () => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
    }

    // which drawing of the sheet is on screen right now
    function frameAt(scene, now) {
      const steps = scene && Array.isArray(scene.steps) ? scene.steps : []
      if (!steps.length) return null
      if (reducedMotion()) return steps[0][0]
      const total = steps.reduce((sum, step) => sum + step[1], 0) || 1
      let t = Math.max(0, now - (scene.at || now))
      // the alarm sheet is a one-shot act, but while she waits for an answer it keeps playing
      if (scene.loop || scene.mode === 'alert') t %= total
      else if (t > total) return steps[steps.length - 1][0]
      let acc = 0
      for (const [name, ms] of steps) {
        if (t < acc + ms) return name
        acc += ms
      }
      return steps[steps.length - 1][0]
    }

    // ── look ────────────────────────────────────────────────────────────────────────────────

    const CSS = `
.dsh-capri{position:fixed;bottom:4px;z-index:60;display:flex;flex-direction:column;align-items:center;
  gap:4px;pointer-events:none;user-select:none;-webkit-user-select:none;
  font-family:"Chakra Petch","Rajdhani","Bahnschrift","Segoe UI",system-ui,sans-serif}
.dsh-capri-sprite{pointer-events:auto;cursor:pointer;background:none;border:0;padding:0;display:block;
  line-height:0;transform-origin:50% 100%;filter:drop-shadow(0 6px 14px rgba(0,0,0,.55))}
.dsh-capri-sprite img{display:block;image-rendering:auto}
.dsh-capri-sprite:hover{filter:drop-shadow(0 0 10px rgba(255,30,90,.55)) drop-shadow(0 6px 14px rgba(0,0,0,.55))}
.dsh-capri-preload{position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none}
.dsh-capri-hud{display:flex;align-items:center;gap:6px;max-width:240px;font:10px/1 "JetBrains Mono",
  ui-monospace,monospace;letter-spacing:.9px;text-transform:uppercase;color:#8b98a5;white-space:nowrap}
.dsh-capri-hud .dot{width:6px;height:6px;border-radius:50%;background:#2ef2ff;box-shadow:0 0 6px #2ef2ff;flex:0 0 auto}
.dsh-capri-hud .dot[data-mode="work"]{background:#ff1e5a;box-shadow:0 0 6px #ff1e5a}
.dsh-capri-hud .dot[data-mode="alert"]{background:#8cff3d;box-shadow:0 0 8px #8cff3d}
.dsh-capri-hud .dot[data-mode="done"]{background:#2ef2ff;box-shadow:0 0 8px #2ef2ff}
.dsh-capri-hud .dot[data-mode="error"]{background:#ff6b6b;box-shadow:0 0 8px #ff6b6b}
.dsh-capri-hud .dot[data-mode="sleep"]{background:#4a5563;box-shadow:none}
.dsh-capri-hud .deed{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;color:#c8d3de}
.dsh-capri-hud .gear{pointer-events:auto;border:0;background:none;color:#8b98a5;font-size:13px;line-height:1;
  padding:2px 3px;border-radius:4px;cursor:pointer}
.dsh-capri-hud .gear:hover{color:#ff1e5a}
.dsh-capri-panel{pointer-events:none;position:relative;display:flex;gap:8px;align-items:flex-start;max-width:300px;
  padding:8px 10px 9px;border:1px solid #7b3cff;border-radius:4px;
  background:linear-gradient(160deg,rgba(10,13,18,.97),rgba(6,9,14,.97));color:#eef4f8;
  box-shadow:0 0 0 1px rgba(0,0,0,.7),0 10px 26px rgba(0,0,0,.6),inset 0 0 22px rgba(123,60,255,.12)}
.dsh-capri-panel:after{content:"";position:absolute;left:-5px;bottom:14px;width:8px;height:8px;
  background:#0a0d12;border-left:1px solid #7b3cff;border-bottom:1px solid #7b3cff;transform:rotate(45deg)}
.dsh-capri-panel img.face{width:46px;height:46px;object-fit:cover;border:1px solid #2ef2ff;
  border-radius:2px;flex:0 0 auto;background:#05070a}
.dsh-capri-panel .body{min-width:0}
.dsh-capri-panel .head{display:flex;align-items:center;gap:6px;font-size:9px;letter-spacing:1.6px;
  text-transform:uppercase;color:#2ef2ff;margin-bottom:3px}
.dsh-capri-panel .head b{color:#fff;font-weight:700;letter-spacing:2px}
.dsh-capri-panel .head i{font-style:normal;padding:1px 5px;border-radius:2px;background:#8cff3d;color:#06120a;
  font-weight:700;letter-spacing:1.2px}
.dsh-capri-panel .head i[data-mode="alert"]{background:#ff1e5a;color:#fff}
.dsh-capri-panel .head i[data-mode="error"]{background:#ff6b6b;color:#1a0606}
.dsh-capri-panel .head i[data-mode="done"]{background:#2ef2ff;color:#04121a}
.dsh-capri-panel .head i[data-mode="idle"]{background:#3a4552;color:#dbe6f0}
.dsh-capri-panel .head i[data-mode="sleep"]{background:#2a313b;color:#8b98a5}
.dsh-capri-panel p{margin:0;font-size:13px;line-height:1.32;letter-spacing:.2px;color:#f3f8fb}
.dsh-capri-panel .deed{margin-top:5px;font:10px/1.3 "JetBrains Mono",ui-monospace,monospace;color:#2ef2ff;
  letter-spacing:.6px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-capri-settings{display:flex;flex-direction:column;gap:20px;max-width:640px;
  color:var(--dsw-alias-label-primary,#e8edf2);font:13px/1.45 "Segoe UI",system-ui,sans-serif}
.dsh-capri-settings h3{margin:0 0 8px;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;
  color:var(--dsw-alias-label-secondary,#8b98a5);font-weight:600}
.dsh-capri-settings p{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#8b98a5);font-size:12px}
.dsh-capri-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-capri-row input[type="range"]{width:220px;accent-color:#ff1e5a}
.dsh-capri-value{min-width:52px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#8b98a5)}
.dsh-capri-button{padding:7px 14px;border-radius:7px;cursor:pointer;font:inherit;
  border:1px solid var(--dsw-alias-border-l2,#3c4654);background:var(--dsw-alias-bg-layer-2,#161b22);
  color:var(--dsw-alias-label-primary,#e8edf2)}
.dsh-capri-button[data-active="true"]{border-color:#ff1e5a;color:#ff5c85}
.dsh-capri-button[disabled]{opacity:.55;cursor:default}
.dsh-capri-faces{display:flex;gap:6px;flex-wrap:wrap}
.dsh-capri-faces img{width:40px;height:40px;object-fit:cover;border:1px solid var(--dsw-alias-border-l1,#2a323c);border-radius:3px}
.dsh-capri-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#ff6b6b)}
@media (prefers-reduced-motion: reduce){.dsh-capri-sprite{transform:none!important}}
`

    const STR = {
      ru: {
        size: 'Размер',
        sizeHint: 'От 50 до 400 %. Капри стоит у края окна и при увеличении растёт в сторону центра.',
        side: 'Сторона',
        sideHint: 'Угол окна, где она стоит.',
        left: 'Слева',
        right: 'Справа',
        lang: 'Язык',
        langHint: 'Реплики, тикер и эта страница. Кадры от языка не зависят.',
        alerts: 'Приходить за разрешением',
        alertsHint: 'Когда агенту нужно твоё решение, она играет тревогу и не уходит, пока ты не ответишь.',
        on: 'Да',
        off: 'Нет',
        seen: (count, when, lang) => {
          if (!count) return 'Запросов разрешения она ещё не видела.'
          const at = when ? new Date(when).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU') : ''
          return `Запросов разрешения она видела: ${count}${at ? ` · последний в ${at}` : ''}`
        },
        faces: 'Её лица',
        about: (n) => `Офлайн-рендер из её шейдера: ${n} клипов, покадровая анимация «на двойках».`,
        saveFailed: 'Не сохранилось',
        loading: 'Загружаю настройки…',
        poke: 'Позвать Капри',
        settings: 'Настройки Капри',
        close: 'Закрыть',
        capri: 'Capri',
      },
      en: {
        size: 'Size',
        sizeHint: '50 to 400 %. She stands at the window edge and grows toward the middle.',
        side: 'Side',
        sideHint: 'Which corner of the window she stands in.',
        left: 'Left',
        right: 'Right',
        lang: 'Language',
        langHint: 'Lines, ticker and this page. The drawings do not depend on it.',
        alerts: 'Come for permission',
        alertsHint: 'When the agent needs your decision she plays the alarm and stays until you answer.',
        on: 'Yes',
        off: 'No',
        seen: (count, when, lang) => {
          if (!count) return 'She has not seen an approval request yet.'
          const at = when ? new Date(when).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU') : ''
          return `Approval requests she has seen: ${count}${at ? ` · last at ${at}` : ''}`
        },
        faces: 'Her faces',
        about: (n) => `Rendered offline from her shader: ${n} clips, drawn on twos.`,
        saveFailed: 'Not saved',
        loading: 'Loading settings…',
        poke: 'Call Capri',
        settings: 'Capri settings',
        close: 'Close',
        capri: 'Capri',
      },
    }
    const str = (lang) => STR[lang === 'en' ? 'en' : 'ru']

    // ── the pet ─────────────────────────────────────────────────────────────────────────────

    const BASE_HEIGHT = 172

    function useViewport() {
      const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
      useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return size
    }

    function layout(scene, vh) {
      // the frame canvas comes from the host, so a re-render at another size needs no client change
      const canvas = scene.canvas && scene.canvas.width > 0 ? scene.canvas : { width: 708, height: 978 }
      const aspect = canvas.width / canvas.height
      const requested = BASE_HEIGHT * (Number(scene.scale) || 100) / 100
      const byHeight = Math.max(80, vh * 0.6)
      const height = Math.round(Math.min(requested, byHeight))
      const width = Math.round(height * aspect)
      return { height, width, left: scene.side === 'left' }
    }

    function Bubble({ scene, visible }) {
      if (!visible || !scene || !scene.line) return null
      const L = str(scene.lang)
      return h('div', { className: 'dsh-capri-panel', role: 'status' },
        h('img', { className: 'face', src: faceSrc(scene.face), alt: '', draggable: false }),
        h('div', { className: 'body' },
          h('div', { className: 'head' },
            h('b', null, L.capri),
            h('i', { 'data-mode': scene.mode }, scene.tag || ''),
          ),
          h('p', null, scene.line),
          scene.deed ? h('div', { className: 'deed' }, scene.deed) : null,
        ),
      )
    }

    function Pet() {
      const scene = useScene()
      const vp = useViewport()
      const now = useTick(Boolean(scene && scene.steps), 83)
      const [panel, setPanel] = useState(false)
      const [bubble, setBubble] = useState(false)
      const bubbleTimer = useRef(0)
      const lastLine = useRef(-1)

      useEffect(() => {
        if (!scene) return
        const seq = scene.lineSeq === undefined ? 0 : scene.lineSeq
        if (seq === lastLine.current) return
        lastLine.current = seq
        if (!scene.line) return
        setBubble(true)
        clearTimeout(bubbleTimer.current)
        // a permission question stays up until it is answered
        if (scene.mode !== 'alert') {
          bubbleTimer.current = setTimeout(() => setBubble(false), 7000)
        }
      }, [scene && scene.lineSeq, scene && scene.line])

      useEffect(() => {
        if (scene && scene.mode === 'alert') setBubble(true)
      }, [scene && scene.mode])

      useEffect(() => () => clearTimeout(bubbleTimer.current), [])

      if (!scene) return null

      const frame = frameAt(scene, now)
      const { height, width, left } = layout(scene, vp.h)
      const frames = Array.isArray(scene.steps) ? Array.from(new Set(scene.steps.map((step) => step[0]))) : []
      const style = left
        ? { left: '10px' }
        : { right: '10px' }

      return h('div', { className: 'dsh-capri', style },
        h('style', null, CSS),
        h(Bubble, { scene, visible: bubble }),
        h('button', {
          type: 'button',
          className: 'dsh-capri-sprite',
          title: str(scene.lang).poke,
          'aria-label': str(scene.lang).poke,
          onClick: () => {
            // a state change goes through POST, never a GET
            fetch(POKE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
              cache: 'no-store',
            }).catch(() => {})
          },
        }, frame
          ? h('img', { src: frameSrc(scene.act, frame, scene.asset), width, height, alt: '', draggable: false })
          : null),
        h('div', { className: 'dsh-capri-hud' },
          h('span', { className: 'dot', 'data-mode': scene.mode, 'aria-hidden': true }),
          h('span', { className: 'deed', title: scene.deed || '' }, scene.deed || scene.tag || ''),
          h('button', {
            type: 'button',
            className: 'gear',
            title: str(scene.lang).settings,
            'aria-label': str(scene.lang).settings,
            onClick: () => setPanel(!panel),
          }, '⚙'),
        ),
        h('div', { className: 'dsh-capri-preload', 'aria-hidden': true },
          frames.map((name) => h('img', { key: name, src: frameSrc(scene.act, name, scene.asset), alt: '' }))),
        panel ? h('div', { className: 'dsh-capri-panel', style: { pointerEvents: 'auto', maxWidth: '320px' } },
          h('div', { className: 'body' },
            h('div', { className: 'head' },
              h('b', null, 'Capri'),
              h('i', { 'data-mode': scene.mode }, scene.tag || ''),
            ),
            h(Settings, { compact: true, scene }),
            h('div', { className: 'dsh-capri-row', style: { marginTop: '8px' } },
              h('button', { type: 'button', className: 'dsh-capri-button', onClick: () => setPanel(false) }, str(scene.lang).close)),
          ),
        ) : null,
      )
    }

    // ── settings ────────────────────────────────────────────────────────────────────────────

    function Settings({ compact = false, scene = null }) {
      const [data, setData] = useState(null)
      const [scale, setScale] = useState(100)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const timer = useRef(0)
      const lang = (data && data.lang) || (scene && scene.lang) || 'ru'
      const L = str(lang)

      const refresh = () => fetch(CONFIG_URL, { cache: 'no-store' })
        .then((response) => response.json())
        .then((next) => {
          setData(next)
          setScale(next.scale)
        })

      useEffect(() => {
        let alive = true
        refresh().catch((reason) => { if (alive) setError(String((reason && reason.message) || reason)) })
        return () => { alive = false; clearTimeout(timer.current) }
      }, [])

      async function save(patch) {
        setError('')
        setBusy(true)
        try {
          const response = await fetch(SETTINGS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const next = await response.json()
          if (!next || next.ok === false) throw new Error((next && next.error) || L.saveFailed)
          setData(next)
          setScale(next.scale)
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(false)
        }
      }

      function changeScale(value) {
        const next = Number(value)
        setScale(next)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { save({ scale: next }) }, 320)
      }

      if (!data) {
        return h('div', { className: 'dsh-capri-settings', style: compact ? { gap: '8px' } : undefined },
          h('style', null, CSS),
          error ? h('div', { className: 'dsh-capri-error' }, error) : h('p', null, L.loading))
      }

      return h('div', { className: 'dsh-capri-settings', style: compact ? { gap: '10px', maxWidth: '290px' } : undefined },
        h('style', null, CSS),

        h('section', null,
          h('h3', null, L.size),
          h('div', { className: 'dsh-capri-row' },
            h('input', {
              type: 'range', min: 50, max: 400, step: 5, value: scale,
              'aria-label': L.size,
              onChange: (event) => changeScale(event.target.value),
            }),
            h('span', { className: 'dsh-capri-value' }, `${scale}%`),
          ),
          compact ? null : h('p', null, L.sizeHint),
        ),

        h('section', null,
          h('h3', null, L.side),
          h('div', { className: 'dsh-capri-row' },
            [['left', L.left], ['right', L.right]].map(([id, label]) => h('button', {
              key: id,
              type: 'button',
              className: 'dsh-capri-button',
              'data-active': String(id === data.side),
              disabled: busy,
              onClick: () => save({ side: id }),
            }, label)),
          ),
          compact ? null : h('p', null, L.sideHint),
        ),

        h('section', null,
          h('h3', null, L.lang),
          h('div', { className: 'dsh-capri-row' },
            [['ru', 'Русский'], ['en', 'English']].map(([id, label]) => h('button', {
              key: id,
              type: 'button',
              className: 'dsh-capri-button',
              'data-active': String(id === data.lang),
              disabled: busy,
              onClick: () => save({ lang: id }),
            }, label)),
          ),
          compact ? null : h('p', null, L.langHint),
        ),

        h('section', null,
          h('h3', null, L.alerts),
          h('div', { className: 'dsh-capri-row' },
            [true, false].map((value) => h('button', {
              key: String(value),
              type: 'button',
              className: 'dsh-capri-button',
              'data-active': String(value === data.alerts),
              disabled: busy,
              onClick: () => save({ alerts: value }),
            }, value ? L.on : L.off)),
          ),
          compact ? null : h('p', null, L.alertsHint),
          compact ? null : h('p', null, L.seen(data.approvals || 0, data.lastApproval, lang)),
        ),

        compact ? null : h('section', null,
          h('h3', null, L.faces),
          h('div', { className: 'dsh-capri-faces' },
            ['calm', 'smug', 'look', 'aside', 'wide', 'laugh', 'many'].map((face) =>
              h('img', { key: face, src: faceSrc(face), alt: face })),
          ),
          h('p', null, L.about(data.acts)),
        ),

        error ? h('div', { className: 'dsh-capri-error' }, error) : null,
      )
    }

    // ── registration ────────────────────────────────────────────────────────────────────────

    return {
      inject: ['slots'],
      apply(ctx) {
        const offPet = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'capri-pet',
          order: 41,
          label: 'Capri',
        }, Pet))

        const offSettings = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'capri',
          order: 26,
          label: 'Capri',
        }, () => h('div', { className: 'dsh-capri-settings' }, h(Settings, {}))))

        return () => {
          if (typeof offPet === 'function') offPet()
          if (typeof offSettings === 'function') offSettings()
        }
      },
    }
  },
})
