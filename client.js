// Browser half: Capri in the corner of the window (shell.overlay) and her settings page.
// The scene comes from the host over /capri/state; the drawings are package assets, played with the
// hold timings baked next to them (assets/clips.json -> scene.steps).
window.__ModuleLoader__.load({
  id: 'dsh-capri',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    // ── her sounds: ported from the original's voice.js, synthesized with Web Audio so nothing
    // has to ship as an audio file. Cues are played by the scene effects further down.
    const pick = (list) => list[Math.floor(Math.random() * list.length)]
    const rand = (a, b) => a + Math.random() * (b - a)

    // Capri's sounds, synthesized with Web Audio so nothing has to ship with the repo.
    // Any file dropped in the custom sounds folder (tray > Son) named after a cue
    // (teleport-out.mp3, done.wav, alert.ogg...) replaces the synth for that cue.


    // a minor-pentatonic set for the talking blips; three detuned voices = a chorus of minds
    const BLIP_NOTES = [62, 65, 67, 69, 72, 74, 77, 79];
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const CUES = ['teleport-out', 'teleport-in', 'done', 'alert', 'error', 'hello', 'blip', 'tick', 'star', 'land', 'rise', 'bolt', 'charge', 'possess', 'throw', 'crash', 'remind', 'jealous', 'purr'];

    class Voice {
      constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = false;
        this.volume = 0.7;
        this.custom = new Map(); // cue -> AudioBuffer
        this.lastBlip = 0;
      }

      ensure() {
        if (this.ctx) return this.ctx;
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        // soft clip so stacked cues never get harsh
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
        }
        shaper.curve = curve;
        this.master.connect(shaper).connect(ctx.destination);
        this.noise = this.makeNoise();
        return ctx;
      }

      configure({ muted, volume }) {
        if (typeof muted === 'boolean') this.muted = muted;
        if (typeof volume === 'number') {
          this.volume = volume;
          if (this.master) this.master.gain.value = volume;
        }
      }

      async loadCustom(list) {
        const ctx = this.ensure();
        this.custom.clear();
        for (const { name, url } of list) {
          if (!CUES.includes(name)) continue;
          try {
            const data = await (await fetch(url)).arrayBuffer();
            this.custom.set(name, await ctx.decodeAudioData(data));
          } catch (err) {
            console.warn('[capri] could not load sound', name, err);
          }
        }
      }

      play(cue, opts = {}) {
        if (this.muted) return;
        const ctx = this.ensure();
        if (ctx.state === 'suspended') ctx.resume();
        const custom = this.custom.get(cue);
        if (custom) {
          const src = ctx.createBufferSource();
          src.buffer = custom;
          src.connect(this.master);
          src.start();
          return;
        }
        const fn = {
          'teleport-out': () => this.zap(false),
          'teleport-in': () => this.zap(true),
          done: () => this.done(),
          alert: () => this.alert(),
          error: () => this.error(),
          hello: () => this.hello(),
          blip: () => this.blip(opts.mood),
          tick: () => this.tick(),
          star: () => this.star(),
          land: () => this.land(),
          rise: () => this.rise(),
          bolt: () => this.bolt(opts.soft),
          charge: () => this.charge(),
          possess: () => this.possess(),
          throw: () => this.whoosh(opts.power ?? 0.6),
          crash: () => this.crash(opts.power ?? 0.6),
          remind: () => this.remind(),
          jealous: () => this.hiss(),
          purr: () => this.purr(),
        }[cue];
        fn?.();
      }

      makeNoise() {
        const ctx = this.ctx;
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
      }

      env(gain, t, a, peak, d) {
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + a);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      }

      osc(type, freq, t, dur, peak, dest = this.master) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        this.env(g, t, 0.004, peak, dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
        return o;
      }

      noiseBurst(t, dur, peak, from, to, q = 2) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = q;
        bp.frequency.setValueAtTime(from, t);
        bp.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = ctx.createGain();
        this.env(g, t, 0.005, peak, dur);
        src.connect(bp).connect(g).connect(this.master);
        src.start(t, rand(0, 0.5));
        src.stop(t + dur + 0.05);
      }

      // teleport: saw sweep + filtered noise, upward when leaving, downward when landing
      zap(arriving) {
        const t = this.ctx.currentTime;
        const o = this.osc('sawtooth', arriving ? 1600 : 180, t, 0.22, 0.12);
        o.frequency.exponentialRampToValueAtTime(arriving ? 140 : 2400, t + 0.2);
        this.noiseBurst(t, 0.2, 0.22, arriving ? 6000 : 400, arriving ? 500 : 7000, 3);
        // bit-crushy stutter
        for (let i = 0; i < 4; i++) this.osc('square', rand(800, 3200), t + 0.02 + i * 0.035, 0.02, 0.05);
        if (arriving) this.osc('triangle', 70, t + 0.16, 0.18, 0.3);
      }

      blip(mood = 'talk') {
        const now = performance.now();
        if (now - this.lastBlip < 45) return;
        this.lastBlip = now;
        const t = this.ctx.currentTime;
        const base = pick(BLIP_NOTES) + (mood === 'alert' ? 5 : mood === 'error' ? -7 : 0);
        const f = midi(base);
        this.osc('square', f, t, 0.035, 0.035);
        this.osc('triangle', f * 1.498, t + 0.004, 0.03, 0.025); // a fifth up
        this.osc('square', f * 0.501, t + 0.008, 0.03, 0.018);   // an octave down, slightly off
      }

      // petted: a purr, a low buzz trembling twenty-odd times a second, swelling and fading
      purr() {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(rand(54, 62), t);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const trem = ctx.createGain();
        trem.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rand(21, 25);
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(trem.gain);
        const g = ctx.createGain();
        this.env(g, t, 0.12, 0.22, 0.95);
        o.connect(lp).connect(trem).connect(g).connect(this.master);
        o.start(t);
        lfo.start(t);
        o.stop(t + 1.15);
        lfo.stop(t + 1.15);
      }

      tick() {
        const t = this.ctx.currentTime;
        this.noiseBurst(t, 0.03, 0.06, 3000, 9000, 8);
      }

      // red lightning: a buzz under a crackle of tiny bursts (soft: the small hacking sparks)
      bolt(soft = false) {
        const t = this.ctx.currentTime;
        const k = soft ? 0.35 : 1;
        const o = this.osc('sawtooth', 62, t, 0.3 * k + 0.05, 0.08 * k);
        o.frequency.setValueAtTime(58, t + 0.05);
        for (let i = 0; i < (soft ? 3 : 8); i++) {
          this.noiseBurst(t + i * rand(0.02, 0.045), 0.025, 0.14 * k, rand(2500, 6000), rand(4000, 9000), 6);
        }
      }

      // charging up before the red light goes up: a buzz swelling and climbing, crackling more and more
      charge() {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(55, t);
        o.frequency.exponentialRampToValueAtTime(240, t + 0.6);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.55);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.7);
        for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.08 + i * 0.09, 0.02, 0.04 + i * 0.016, 3000, 7000, 6);
      }

      // the window she took over laughs with all her voices: three falling chirps, each a detuned
      // chord, over a hiss
      possess() {
        const t = this.ctx.currentTime;
        [79, 76, 72].forEach((n, i) => {
          const at = t + i * 0.11;
          this.osc('square', midi(n), at, 0.07, 0.05);
          this.osc('square', midi(n) * 1.012, at + 0.004, 0.06, 0.035);
          this.osc('triangle', midi(n - 12), at + 0.008, 0.07, 0.04);
        });
        this.noiseBurst(t, 0.3, 0.05, 1200, 5000, 3);
      }

      // the launch into the victory pose: a quick upward whoosh
      rise() {
        const t = this.ctx.currentTime;
        const o = this.osc('sawtooth', 160, t, 0.2, 0.07);
        o.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
        this.noiseBurst(t, 0.18, 0.12, 500, 6000, 2);
      }

      // thrown: air rushing past, a falling saw under it, harder the faster she goes
      whoosh(power) {
        const t = this.ctx.currentTime;
        const k = 0.4 + power * 0.6;
        this.noiseBurst(t, 0.28, 0.16 * k, 300, 3200 + power * 3000, 1.4);
        const o = this.osc('sawtooth', 420 + power * 300, t, 0.22, 0.05 * k);
        o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
        for (let i = 0; i < 3; i++) this.osc('square', rand(1500, 3800), t + 0.03 + i * 0.03, 0.015, 0.03 * k);
      }

      // slamming into something: a heavy thump, glass crunching, her signal glitching out for a moment
      crash(power) {
        const t = this.ctx.currentTime;
        const k = 0.35 + power * 0.65;
        const o = this.osc('triangle', 130, t, 0.22, 0.34 * k);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
        this.noiseBurst(t, 0.12, 0.22 * k, 2400, 300, 1.2);
        if (power > 0.25) {
          for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.02 + i * rand(0.012, 0.03), 0.02, 0.12 * k, rand(5000, 9000), rand(6000, 10000), 9);
        }
        for (let i = 0; i < 4; i++) this.osc('square', rand(700, 2600), t + 0.05 + i * 0.028, 0.018, 0.04 * k);
      }

      // a reminder: three bright notes going up, softer than an alert, with a shimmer
      remind() {
        const t = this.ctx.currentTime;
        [76, 81, 88].forEach((n, i) => {
          this.osc('triangle', midi(n), t + i * 0.12, 0.35, 0.08);
          this.osc('sine', midi(n + 12), t + i * 0.12 + 0.01, 0.25, 0.025);
        });
        this.noiseBurst(t + 0.3, 0.4, 0.02, 8000, 12000, 6);
      }

      // jealous: a hiss over a low growl that wobbles, like a cat about to swipe
      hiss() {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(3500, t);
        bp.frequency.linearRampToValueAtTime(6500, t + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        src.connect(bp).connect(g).connect(this.master);
        src.start(t, rand(0, 0.5));
        src.stop(t + 0.5);
        const growl = this.osc('sawtooth', 72, t, 0.4, 0.07);
        for (let i = 1; i <= 8; i++) growl.frequency.setValueAtTime(i % 2 ? 64 : 80, t + i * 0.045);
      }

      // touching down: a soft digital thump
      land() {
        const t = this.ctx.currentTime;
        const o = this.osc('triangle', 150, t, 0.14, 0.22);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
        this.noiseBurst(t, 0.06, 0.08, 1800, 400, 1.5);
      }

      // the satellite: two soft, high pings and a shimmer
      star() {
        const t = this.ctx.currentTime;
        this.osc('sine', midi(93), t, 0.9, 0.05);
        this.osc('sine', midi(100), t + 0.14, 1.2, 0.035);
        this.noiseBurst(t + 0.05, 0.6, 0.015, 9000, 12000, 6);
      }

      hello() {
        const t = this.ctx.currentTime;
        [69, 76, 81].forEach((n, i) => this.osc('square', midi(n), t + i * 0.06, 0.07, 0.06));
        this.noiseBurst(t + 0.18, 0.08, 0.06, 2000, 8000, 5);
      }

      // bright arpeggio and a glitchy tail
      done() {
        const t = this.ctx.currentTime;
        [64, 68, 71, 75, 76].forEach((n, i) => {
          this.osc('triangle', midi(n + 12), t + i * 0.07, 0.28, 0.09);
          this.osc('square', midi(n), t + i * 0.07, 0.12, 0.035);
        });
        for (let i = 0; i < 7; i++) this.osc('square', rand(1200, 4200), t + 0.4 + i * 0.03, 0.018, 0.035);
      }

      alert() {
        const t = this.ctx.currentTime;
        for (let r = 0; r < 2; r++) {
          this.osc('square', 988, t + r * 0.28, 0.09, 0.07);
          this.osc('square', 740, t + r * 0.28 + 0.11, 0.11, 0.07);
        }
      }

      error() {
        const t = this.ctx.currentTime;
        const o = this.osc('sawtooth', 110, t, 0.32, 0.14);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
        this.noiseBurst(t, 0.25, 0.15, 900, 200, 1.2);
        for (let i = 0; i < 5; i++) this.noiseBurst(t + 0.05 + i * 0.05, 0.02, 0.12, 4000, 4000, 10);
      }
    }


    const voice = new Voice()

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
        // rAF instead of a fixed interval: the fast sheets hold drawings for 42 ms, and an 83 ms
        // timer silently dropped half of them (turn played at 415 ms instead of 251)
        let alive = true
        let raf = 0
        let last = 0
        const step = (stamp) => {
          if (!alive) return
          if (stamp - last >= ms) { last = stamp; setNow(Date.now()) }
          raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => { alive = false; cancelAnimationFrame(raf) }
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
/* a pet drawn by a bundle that predates the owner marker: hide it instantly, before any sweep */
.dsh-capri:not([data-capri-owned]){display:none!important}
.dsh-capri-sprite{pointer-events:auto;cursor:grab;background:none;border:0;padding:0;display:block;
  position:relative;line-height:0;transform-origin:50% 100%;touch-action:none;
  filter:drop-shadow(0 6px 14px rgba(0,0,0,.55));
  animation:capri-breathe 3.6s ease-in-out infinite,capri-shadow 3.6s ease-in-out infinite}
@keyframes capri-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.004)}}
@keyframes capri-shadow{0%,100%{filter:drop-shadow(0 6px 14px rgba(0,0,0,.55))}50%{filter:drop-shadow(0 9px 18px rgba(0,0,0,.42))}}
.dsh-capri-lean,.dsh-capri-inner{display:block;position:relative;transform-origin:50% 100%}
.dsh-capri-lean{transition:transform 320ms ease-out}
.dsh-capri-fx{position:absolute;inset:-26px;pointer-events:none;z-index:0;border-radius:12px}
.dsh-capri-fx[data-fx="zap"]{background:radial-gradient(circle at 62% 42%,rgba(46,242,255,.38),transparent 62%);animation:capri-flash 190ms ease-out forwards}
.dsh-capri-fx[data-fx="win"]{background:radial-gradient(circle at 50% 30%,rgba(140,255,61,.26),transparent 58%);animation:capri-flash 280ms ease-out forwards}
.dsh-capri-fx[data-fx="alert"]{box-shadow:inset 0 0 70px rgba(255,30,90,.4);animation:capri-pulse 1.1s ease-in-out infinite}
.dsh-capri-fx[data-fx="glitch"]{background:linear-gradient(90deg,rgba(255,30,90,.3),transparent 45%);animation:capri-glitch 220ms steps(3,end) forwards}
@keyframes capri-flash{from{opacity:1}to{opacity:0}}
@keyframes capri-pulse{0%,100%{opacity:.32}50%{opacity:.85}}
@keyframes capri-glitch{0%{transform:translateX(0)}33%{transform:translateX(-3px)}66%{transform:translateX(3px)}100%{transform:translateX(0);opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-capri-fx{display:none}}
.dsh-capri-sprite:active{cursor:grabbing}
.dsh-capri-frame{position:relative;z-index:1;display:block}
.dsh-capri-ghost{position:absolute;inset:0;z-index:0;pointer-events:none;animation:capri-ghost 150ms ease-out forwards}
@keyframes capri-ghost{from{opacity:1}to{opacity:0}}
.dsh-capri-sprite:focus-visible{outline:2px solid #2ef2ff;outline-offset:4px;border-radius:8px}
@media (prefers-reduced-motion: reduce){.dsh-capri-ghost{display:none}}
.dsh-capri-sprite img{display:block;image-rendering:auto}
.dsh-capri-sprite:hover{filter:drop-shadow(0 0 10px rgba(255,30,90,.55)) drop-shadow(0 6px 14px rgba(0,0,0,.55))}
.dsh-capri-preload{position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none}
.dsh-capri-hud{display:flex;align-items:center;gap:6px;max-width:240px;font:10px/1 "JetBrains Mono",
  ui-monospace,monospace;letter-spacing:.9px;text-transform:uppercase;
  color:var(--dsw-alias-label-secondary,#8b98a5);white-space:nowrap}
.dsh-capri-hud .dot{width:6px;height:6px;border-radius:50%;background:#2ef2ff;box-shadow:0 0 6px #2ef2ff;flex:0 0 auto}
.dsh-capri-hud .dot[data-mode="work"]{background:#ff1e5a;box-shadow:0 0 6px #ff1e5a}
.dsh-capri-hud .dot[data-mode="alert"]{background:#8cff3d;box-shadow:0 0 8px #8cff3d}
.dsh-capri-hud .dot[data-mode="done"]{background:#2ef2ff;box-shadow:0 0 8px #2ef2ff}
.dsh-capri-hud .dot[data-mode="error"]{background:#ff6b6b;box-shadow:0 0 8px #ff6b6b}
.dsh-capri-hud .dot[data-mode="sleep"]{background:#4a5563;box-shadow:none}
.dsh-capri-hud .deed{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;
  color:var(--dsw-alias-label-primary,#c8d3de)}
.dsh-capri-hud .gear{pointer-events:auto;border:0;background:none;
  color:var(--dsw-alias-label-secondary,#8b98a5);font-size:13px;line-height:1;
  padding:2px 3px;border-radius:4px;cursor:pointer}
.dsh-capri-hud .gear:hover{color:#ff1e5a}
.dsh-capri-panel{pointer-events:none;position:relative;display:flex;gap:8px;align-items:flex-start;max-width:300px;
  padding:8px 10px 9px;border:1px solid #7b3cff;border-radius:4px;
  background:linear-gradient(160deg,rgba(10,13,18,.97),rgba(6,9,14,.97));color:#eef4f8;
  box-shadow:0 0 0 1px rgba(0,0,0,.7),0 10px 26px rgba(0,0,0,.6),inset 0 0 22px rgba(123,60,255,.12)}
/* the status window has one fixed geometry: work, idle and alert are the same box, so it never
   jumps in width between lines, and a second copy lands exactly on top of the first */
.dsh-capri-bubble{width:326px;height:78px;max-width:326px;box-sizing:border-box;align-items:center;overflow:hidden}
.dsh-capri-bubble .body{display:flex;flex-direction:column;justify-content:center;flex:1;min-width:0;height:100%}
.dsh-capri-bubble .body p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;font-size:12.5px;line-height:1.28;max-height:2.6em}
.dsh-capri-bubble .body .deed{min-height:12px;margin-top:3px}
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
        sound: 'Звук',
        soundVolume: 'Громкость',
        soundTest: 'Проверить',
        soundHint: 'Она тихо поёт: клик по ней, тревога, победа, ошибка. Первый звук — только после клика в окне, так требует браузер.',
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
        sound: 'Sound',
        soundVolume: 'Volume',
        soundTest: 'Test',
        soundHint: 'She is quiet: a click, the alarm, the victory, an error. The first sound comes only after a click in the window — the browser insists.',
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
      const line = scene && scene.line ? String(scene.line) : ''
      const seq = scene ? scene.lineSeq : 0
      const mode = scene ? scene.mode : ''
      const [cut, setCut] = useState(0)

      // her lines type themselves out, a blip every few letters, like the original's talk
      useEffect(() => {
        if (!visible || !line) { setCut(0); return undefined }
        if (reducedMotion()) { setCut(line.length); return undefined }
        setCut(0)
        let shown = 0
        const id = setInterval(() => {
          shown += 1
          setCut(shown)
          if (shown % 5 === 0) { try { voice.play('blip', { mood: mode }) } catch { /* silent */ } }
          if (shown >= line.length) clearInterval(id)
        }, 22)
        return () => clearInterval(id)
      }, [seq, visible, line])

      if (!visible || !scene || !line) return null
      const L = str(scene.lang)
      return h('div', { className: 'dsh-capri-panel dsh-capri-bubble', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
        h('img', { className: 'face', src: faceSrc(scene.face), alt: '', draggable: false }),
        h('div', { className: 'body' },
          h('div', { className: 'head' },
            h('b', null, L.capri),
            h('i', { 'data-mode': scene.mode }, scene.tag || ''),
          ),
          h('p', null, line.slice(0, cut)),
          // always rendered: the box keeps its height whether or not there is a deed line
          h('div', { className: 'deed' }, scene.deed || ''),
        ),
      )
    }

    function Pet() {
      const scene = useScene()
      const vp = useViewport()
      // the tick follows the sheet: a fast act (42 ms holds) needs ~40 fps, a calm one is fine at 12
      const tickMs = (() => {
        const steps = scene && Array.isArray(scene.steps) ? scene.steps : null
        if (!steps || !steps.length) return 83
        let min = Infinity
        for (const step of steps) if (step[1] < min) min = step[1]
        return Math.max(16, Math.min(83, Math.floor(min / 2)))
      })()
      const now = useTick(Boolean(scene && scene.steps), tickMs)
      const [panel, setPanel] = useState(false)
      const [bubble, setBubble] = useState(false)
      const bubbleTimer = useRef(0)
      const lastLine = useRef(-1)
      const rootRef = useRef(null)
      const spriteRef = useRef(null)
      const [lean, setLean] = useState(0)
      const [tilt, setTilt] = useState(0)
      const leanAt = useRef(0)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const drag = useRef({ active: false, moved: false, x: 0, y: 0 })
      const skipClick = useRef(false)
      // where she was left the last time, restored from the saved settings
      const offsetReady = useRef(false)
      const sideSeen = useRef('')
      const scaleSeen = useRef(0)
      const saveTimer = useRef(0)
      const persistOffset = (x, y) => {
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          fetch(SETTINGS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ x, y }),
            cache: 'no-store',
          }).catch(() => {})
        }, 350)
      }
      const touch = (act) => fetch('/capri/touch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ act }),
        cache: 'no-store',
      }).catch(() => {})      // One pet per page. A plugin update can leave the previous bundle's component mounted next to
      // the new one, and both then draw a panel (that is the duplicated window users see). The
      // newest instance claims the page, the older ones render nothing, and anything a dead instance
      // left behind is removed once.
      const instanceId = useRef(`capri-${Math.random().toString(36).slice(2)}`)
      const [claimed, setClaimed] = useState(false)
      const mine = (() => {
        try { return window.__capriOwner === instanceId.current } catch { return true }
      })()

      useEffect(() => {
        try { window.__capriOwner = instanceId.current } catch { /* private mode */ }
        setClaimed(true)
        // A copy loaded by an older bundle has no owner logic of its own, so it keeps drawing its
        // stale panel. Sweep it right away and then keep sweeping: if its React root re-inserts the
        // node, the next pass takes it out again.
        const sweep = () => {
          try {
            for (const node of document.querySelectorAll('.dsh-capri')) {
              if (node !== rootRef.current) node.remove()
            }
          } catch { /* nothing to sweep */ }
        }
        sweep()
        const first = setTimeout(sweep, 400)
        const timer = setInterval(sweep, 1500)
        return () => { clearTimeout(first); clearInterval(timer) }
      }, [])

      useEffect(() => {
        if (!scene) return
        const seq = scene.lineSeq === undefined ? 0 : scene.lineSeq
        if (seq === lastLine.current) return
        lastLine.current = seq
        if (!scene.line) return
        setBubble(true)
        clearTimeout(bubbleTimer.current)
        // a permission question stays up until it is answered; a working line lingers a little longer
        if (scene.mode !== 'alert') {
          bubbleTimer.current = setTimeout(() => setBubble(false), 10000)
        }
      }, [scene && scene.lineSeq, scene && scene.line])

      useEffect(() => {
        if (scene && scene.mode === 'alert') setBubble(true)
      }, [scene && scene.mode])

      useEffect(() => {
        if (!scene) return
        // first run: restore the saved spot; later runs: a new side or size resets it
        if (!offsetReady.current) {
          offsetReady.current = true
          sideSeen.current = scene.side
          scaleSeen.current = scene.scale
          setOffset({ x: Number(scene.x) || 0, y: Number(scene.y) || 0 })
          return
        }
        if (scene.side !== sideSeen.current || scene.scale !== scaleSeen.current) {
          sideSeen.current = scene.side
          scaleSeen.current = scene.scale
          setOffset({ x: 0, y: 0 })
          persistOffset(0, 0)
        }
      }, [scene && scene.side, scene && scene.scale])

      useEffect(() => () => clearTimeout(bubbleTimer.current), [])

      // crossfade: the previous shot stays under the new one for ~150 ms, so a pose change dissolves
      // instead of cutting
      const prevShot = useRef({ act: '', frame: '' })
      const [ghost, setGhost] = useState(null)

      useEffect(() => {
        const was = prevShot.current
        if (!scene || !was.act || was.act === scene.act || !was.frame) return
        // a quick beat needs a quick dissolve; a slow, heavy one can afford a longer one
        const total = (scene.steps || []).reduce((sum, step) => sum + step[1], 0)
        const ms = total <= 900 ? 70 : total >= 2000 ? 200 : 140
        setGhost({ act: was.act, frame: was.frame, ms })
        const timer = setTimeout(() => setGhost(null), ms + 30)
        return () => clearTimeout(timer)
      }, [scene && scene.act])

      // remember what was actually drawn, for the next crossfade
      useEffect(() => {
        if (scene) prevShot.current = { act: scene.act, frame: frameAt(scene, now) }
      })

      // she leans after the cursor when it comes close: the cheapest way to stop looking like a still
      useEffect(() => {
        if (reducedMotion()) return undefined
        const onMove = (event) => {
          const stamp = Date.now()
          if (stamp - leanAt.current < 80) return
          leanAt.current = stamp
          const node = spriteRef.current
          if (!node) return
          const rect = node.getBoundingClientRect()
          const dx = event.clientX - (rect.left + rect.width / 2)
          const dy = event.clientY - (rect.top + rect.height / 2)
          const reach = Math.max(420, rect.height * 0.8)
          if (Math.hypot(dx, dy) > reach) { setLean(0); return }
          setLean(Math.max(-4, Math.min(4, dx / 120)))
        }
        window.addEventListener('pointermove', onMove, { passive: true })
        return () => window.removeEventListener('pointermove', onMove)
      }, [])

      // small head turns now and then, so a long idle hold is never a frozen picture
      useEffect(() => {
        if (reducedMotion()) return undefined
        let alive = true
        let turnTimer = 0
        const schedule = () => {
          turnTimer = setTimeout(() => {
            if (!alive) return
            setTilt((Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.7))
            turnTimer = setTimeout(() => { if (alive) setTilt(0) }, 380)
            if (alive) schedule()
          }, 6000 + Math.random() * 6000)
        }
        schedule()
        return () => { alive = false; clearTimeout(turnTimer) }
      }, [])

      // Her sounds. An AudioContext may only start inside a user gesture, so it is created on the
      // first click anywhere in the page and reused after that; until then she stays silent.
      const lastSound = useRef({ mode: '', act: '', lineSeq: -1 })

      useEffect(() => {
        const unlock = () => { try { voice.ensure() } catch { /* no audio device */ } }
        window.addEventListener('pointerdown', unlock, { once: true })
        // report this pet instance: the host counts them, and more than one means stacked copies
        // (the token is per page load, so a refresh does not look like a duplicate)
        const page = (() => {
          try { return window.__capriPage || (window.__capriPage = Math.random().toString(36).slice(2)) } catch { return 'x' }
        })()
        fetch('/capri/hello', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ page }),
          cache: 'no-store',
        }).catch(() => {})
        return () => window.removeEventListener('pointerdown', unlock)
      }, [])

      useEffect(() => {
        if (!scene) return
        try {
          voice.configure({
            muted: scene.sound === false,
            volume: (Number(scene.volume) || 0) / 100 * 0.6,
          })
        } catch { /* no audio device */ }
      }, [scene && scene.sound, scene && scene.volume])

      useEffect(() => {
        if (!scene || scene.sound === false) return
        const before = lastSound.current
        const mode = scene.mode || ''
        const act = scene.act || ''
        const lineSeq = scene.lineSeq === undefined ? 0 : scene.lineSeq
        if (before.mode === mode && before.act === act && before.lineSeq === lineSeq) return

        const actCue = {
          talk: 'hello', zap: 'bolt', petted: 'purr', victory: 'done', flinch: 'error',
          alarm: 'alert', ko: 'crash', stretch: 'rise', gaze: 'star', grabbed: 'charge',
          land: 'land', hop: 'star',
        }[act]
        const modeCue = { done: 'done', alert: 'alert', error: 'error' }[mode]
        try {
          // the act cue wins: a done turn changes both mode and act, and must sound once
          if (act !== before.act && actCue) voice.play(actCue)
          else if (mode !== before.mode) {
            // a teleport sweep only when work starts again, not on every tool
            if (mode === 'work' && before.mode && before.mode !== 'work') voice.play('teleport-out')
            else if (modeCue) voice.play(modeCue)
          } else if (act !== before.act && mode === 'work') voice.play('tick')
          if (lineSeq !== before.lineSeq && lineSeq > 0) voice.play('blip', { mood: mode })
        } catch { /* a sound must never break the scene */ }
        lastSound.current = { mode, act, lineSeq }
      }, [scene && scene.mode, scene && scene.act, scene && scene.lineSeq])

      if (!scene) return null
      // a newer copy of the plugin owns the page: this one stays invisible
      if (!claimed || !mine) return null

      const frame = frameAt(scene, now)
      // a flash of lightning for a command, a red halo while a question is open, a glitch after a
      // failure, sparks on a win: small overlays that make the beat land
      const fx = scene.mode === 'alert' ? 'alert'
        : scene.act === 'zap' ? 'zap'
          : scene.act === 'flinch' || scene.act === 'ko' ? 'glitch'
            : scene.act === 'victory' ? 'win'
              : ''
      const { height, width, left } = layout(scene, vp.h)
      const frames = Array.isArray(scene.steps) ? Array.from(new Set(scene.steps.map((step) => step[0]))) : []
      const style = left
        ? { left: '10px' }
        : { right: '10px' }
      // dragging moves the whole column, so the sprite keeps its own animation transform
      if (offset.x || offset.y) style.transform = `translate(${offset.x}px, ${offset.y}px)`

      return h('div', { className: 'dsh-capri', style, ref: rootRef, 'data-capri-owned': '1' },
        h('style', null, CSS),
        h(Bubble, { scene, visible: bubble && !panel }),
        h('button', {
          type: 'button',
          className: 'dsh-capri-sprite',
          ref: spriteRef,
          title: str(scene.lang).poke,
          'aria-label': str(scene.lang).poke,
          onPointerDown: (event) => {
            if (event.button !== 0) return
            skipClick.current = false
            drag.current = { active: true, moved: false, x: event.clientX, y: event.clientY }
            try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* old pointer */ }
          },
          onPointerMove: (event) => {
            const state = drag.current
            if (!state.active) return
            const dx = event.clientX - state.x
            const dy = event.clientY - state.y
            if (!state.moved && Math.abs(dx) + Math.abs(dy) > 6) {
              state.moved = true
              touch('grabbed')
            }
            if (!state.moved) return
            state.x = event.clientX
            state.y = event.clientY
            // keep her reachable: a drag can never push her off the window
            const spanX = Math.max(60, (vp.w || window.innerWidth || 1200) - width - 30)
            const spanY = Math.max(80, (vp.h || window.innerHeight || 800) - Math.max(240, height))
            setOffset((prev) => ({
              x: Math.min(160, Math.max(-spanX, prev.x + dx)),
              y: Math.min(80, Math.max(-spanY, prev.y + dy)),
            }))
          },
          onPointerUp: () => {
            const state = drag.current
            if (!state.active) return
            state.active = false
            if (!state.moved) return
            skipClick.current = true
            touch('land')
            persistOffset(offset.x, offset.y)
          },
          onPointerCancel: () => {
            if (!drag.current.active) return
            drag.current.active = false
            if (drag.current.moved) touch('land')
          },
          onClick: () => {
            // releasing a drag must not count as a poke
            if (skipClick.current) { skipClick.current = false; return }
            // a state change goes through POST, never a GET
            fetch(POKE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
              cache: 'no-store',
            }).catch(() => {})
          },
        }, h('div', { className: 'dsh-capri-lean', style: lean ? { transform: `rotate(${lean}deg)` } : undefined },
          fx ? h('div', { key: `${fx}-${scene.seq}`, className: 'dsh-capri-fx', 'data-fx': fx, 'aria-hidden': true }) : null,
          h('div', { className: 'dsh-capri-inner', style: tilt ? { transform: `rotate(${tilt}deg)` } : undefined },
            ghost
              ? h('img', {
                key: 'ghost', className: 'dsh-capri-ghost',
                src: frameSrc(ghost.act, ghost.frame, scene.asset), width, height, alt: '', draggable: false,
                style: { animationDuration: `${ghost.ms}ms` },
              })
              : null,
            frame
              ? h('img', {
                key: 'frame', className: 'dsh-capri-frame',
                src: frameSrc(scene.act, frame, scene.asset), width, height, alt: '', draggable: false,
              })
              : null))),
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
      const [volume, setVolume] = useState(30)
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
          setVolume(next.volume === undefined ? 30 : next.volume)
        })

      useEffect(() => {
        let alive = true
        // opening the settings page closes the floating panel, so the same controls are never on
        // screen twice
        if (!compact) setPanel(false)
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
          if (next.volume !== undefined) setVolume(next.volume)
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

      function changeVolume(value) {
        const next = Number(value)
        setVolume(next)
        voice.configure({ muted: data ? data.sound === false : false, volume: next / 100 * 0.6 })
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { save({ volume: next }) }, 320)
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

        h('section', null,
          h('h3', null, L.sound),
          h('div', { className: 'dsh-capri-row' },
            [true, false].map((value) => h('button', {
              key: String(value),
              type: 'button',
              className: 'dsh-capri-button',
              'data-active': String(value === (data.sound !== false)),
              disabled: busy,
              onClick: () => save({ sound: value }),
            }, value ? L.on : L.off)),
            h('button', {
              type: 'button',
              className: 'dsh-capri-button',
              disabled: data.sound === false,
              onClick: () => {
                // a click is a user gesture, so this also unlocks the AudioContext
                try { voice.ensure(); voice.play('hello') } catch { /* no audio device */ }
              },
            }, L.soundTest),
          ),
          h('div', { className: 'dsh-capri-row' },
            h('input', {
              type: 'range', min: 0, max: 100, step: 5, value: volume,
              'aria-label': L.soundVolume,
              disabled: data.sound === false,
              onChange: (event) => changeVolume(event.target.value),
            }),
            h('span', { className: 'dsh-capri-value' }, `${volume}%`),
          ),
          compact ? null : h('p', null, L.soundHint),
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
