// Offline frame renderer for Capri: drives her real WebGL shader from sprite.js with the real
// exposure sheets from acting.js, one raw RGBA readback per key drawing.
//
// No canvas -> PNG encoding happens in the browser: under headless SwiftShader that path stalls the
// page's main thread. We read the GL surface back with readPixels and let compose.py do the
// bob/tilt/squash composite and the PNG encode.
import { SpriteRenderer, SPRITE } from '/src-capri/capri-desktop-main/src/renderer/js/sprite.js';
import { ACTS, NEUTRAL, Player, SHEET_FPS } from '/src-capri/capri-desktop-main/src/renderer/js/acting.js';

const SCALE = 1.5;   // screen pixels per sprite pixel: covers a 400 % display (688 px) without upscaling
const MARGIN = 60;   // sprite pixels of room around the sprite for bob and tilt
const TEX = '/src-capri/capri-desktop-main/assets/capri/capri-full.png';

// Acts worth porting first: the idle stance, sleep, thinking, the satellite reach, the alert, the
// failure, the victory, and the small flourishes the HUD triggers. `sit` is deliberately absent:
// the sitting pose renders crooked, so she rests standing until she falls asleep.
const ACTS_V1 = [
  'stand', 'sleep', 'talk', 'curious', 'look', 'gaze', 'point',
  'alarm', 'flinch', 'victory', 'zap', 'split', 'huff', 'petted', 'hop', 'land',
  'stretch', 'ko', 'grabbed', 'shake', 'turn',
];

// The looping acts that are a stance of their own rather than a move played over one.
const STANCES = new Set(['stand', 'sit', 'sleep', 'lounge', 'peek']);
// Moves that happen while she is sitting on a ledge.
const SIT_ACTS = new Set(['stretch', 'plop']);

// Boil policy: a drawing that is held for fewer than three frames is shown once; a longer hold is
// redrawn every couple of frames with a fresh line seed, the way the original re-boils a cel on
// every exposure. "Live" means a new drawing roughly every 2 frames, capped per hold.
const BOIL_FROM = 3    // frames; below this a hold is shown once
const BOIL_EVERY = 2  // frames per drawing inside a long hold
const BOIL_CAP = 10   // at most this many drawings for one hold

// Tween policy: the fast sheets hold a drawing for a single 24 fps frame (42 ms), which reads as a
// cut. For these acts one extra drawing is rendered halfway to the next key, and the hold it was
// taken from is shortened by the same frame, so the clip keeps its length.
const TWEEN_ON = new URLSearchParams(location.search).get('tween') !== '0'
const TWEEN_ACTS = new Set(['zap', 'victory', 'hop', 'land', 'turn', 'grabbed', 'shake', 'point', 'split'])

function lerpPose(from, to, t) {
  const out = { ...from }
  for (const key of Object.keys(to)) {
    const a = from[key]
    const b = to[key]
    if (typeof a === 'number' && typeof b === 'number') out[key] = a + (b - a) * t
    else if (Array.isArray(a) && Array.isArray(b)) out[key] = b.map((value, i) => (a[i] ?? value) + (value - (a[i] ?? value)) * t)
    else out[key] = b
  }
  return out
}

function variantHolds(hold) {
  if (hold < BOIL_FROM) return [hold]
  const count = Math.min(BOIL_CAP, Math.max(2, Math.ceil(hold / BOIL_EVERY)))
  const spans = []
  for (let i = 0; i < count; i += 1) {
    const to = Math.floor(((i + 1) * hold) / count)
    const from = Math.floor((i * hold) / count)
    if (to > from) spans.push(to - from)
  }
  return spans.length ? spans : [hold]
}

const log = (line) => {
  const el = document.getElementById('log');
  if (el) el.textContent += `${line}\n`;
  fetch('/log', { method: 'POST', body: String(line) }).catch(() => {});
};

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return h;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

async function main() {
  const image = await loadImage(TEX);

  const W = SPRITE.width + SPRITE.pad * 2;   // 352
  const H = SPRITE.height + SPRITE.pad * 2;  // 532
  const PW = Math.round(W * SCALE);
  const PH = Math.round(H * SCALE);

  const glCanvas = document.createElement('canvas');
  const raw = glCanvas.getContext.bind(glCanvas);
  glCanvas.getContext = (type, attrs) => raw(type, type === 'webgl' ? { ...(attrs || {}), preserveDrawingBuffer: true } : attrs);
  document.getElementById('stage').appendChild(glCanvas);

  const renderer = new SpriteRenderer(glCanvas, image);
  renderer.resize(SCALE);
  const gl = renderer.gl;
  const pixels = new Uint8Array(PW * PH * 4);
  log(`webgl: ${gl.getParameter(gl.VERSION)} / ${gl.getParameter(gl.RENDERER)}; surface ${PW}x${PH}`);

  const manifest = {
    scale: SCALE,
    margin: MARGIN,
    sprite: { width: W, height: H },
    surface: { width: PW, height: PH },
    acts: {},
  };

  const wanted = new URLSearchParams(location.search).get('acts');
  const list = wanted ? wanted.split(',').map((s) => s.trim()).filter(Boolean) : ACTS_V1;
  let total = 0;

  for (const actName of list) {
    const act = ACTS[actName];
    if (!act) { log(`skip ${actName}: not in ACTS`); continue; }

    const isStance = STANCES.has(actName);
    const baseName = isStance ? actName : (SIT_ACTS.has(actName) ? 'sit' : 'stand');
    const base = new Player(baseName, { at: 0 });
    const player = isStance ? null : new Player(actName, { at: 0 });

    const fps = act.fps || SHEET_FPS;
    const frameMs = 1000 / fps;
    const sitFlag = baseName === 'sit' ? 1 : 0;
    const keys = act.keys;
    const frames = [];
    const seedBase = hashName(actName);
    let frame = 0;    // frame index inside the exposure sheet
    let drawing = 0;  // emitted PNG index

    // One drawing: build the shader parameters, draw, read the surface back, post the raw pixels.
    const emit = async (merged, span) => {
      const p = {
        seed: ((seedBase + drawing * 37) % 1000) / 10,
        boil: actName === 'sleep' ? 0.5 : 0.9,
        hair: merged.hair,
        head: merged.head,
        mane: merged.mane,
        armL: merged.armL,
        armR: merged.armR,
        longL: merged.longL,
        longR: merged.longR,
        sit: sitFlag,
        bend: merged.bend,
        kickL: merged.kickL,
        kickR: merged.kickR,
        smear: merged.smear,
        echo: merged.echo,
        glitch: 0,
        glitchSeed: 0,
        split: 0,
        collapse: 0,
        dissolve: 0,
        sparkle: 1,
        grade: 1,
        sil: [0.02, 0.02, 0.05],
        silAmount: 0,
        misreg: [-2.6, 2.2],
        alpha: 1,
      };

      renderer.draw(p);
      if (drawing === 0) log('drew');
      gl.readPixels(0, 0, PW, PH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (drawing === 0) log(`read ${pixels.filter((v, k) => k % 4 === 3 && v > 0).length} opaque px`);

      drawing += 1;
      const name = `${actName}_${String(drawing).padStart(2, '0')}`;
      const query = new URLSearchParams({
        act: actName,
        name,
        bob: String(merged.bob),
        tilt: String(merged.tilt),
        sx: String(merged.sx),
        sy: String(merged.sy),
      });
      const res = await fetch(`/raw?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: pixels,
      });
      if (!res.ok) throw new Error(`save ${actName}/${name}: ${res.status}`);
      if (drawing === 1) log('posted');

      frames.push({
        name,
        hold: Math.round(span * frameMs),
        bob: merged.bob,
        tilt: merged.tilt,
        sx: merged.sx,
        sy: merged.sy,
      });
      total += 1;
    };

    for (let i = 0; i < keys.length; i += 1) {
      const [hold, pose] = keys[i];
      const spans = variantHolds(hold);
      // steal one frame from this hold for the tween that leads into the next key
      let tween = 0;
      if (TWEEN_ON && TWEEN_ACTS.has(actName) && i < keys.length - 1) {
        if (spans[spans.length - 1] >= 2) { spans[spans.length - 1] -= 1; tween = 1; }
        else if (spans.length > 1 && spans[spans.length - 2] >= 2) { spans[spans.length - 2] -= 1; tween = 1; }
      }
      for (const span of spans) {
        const now = (frame + span / 2) * frameMs;
        const under = base.sample(now) || base.sample(0);
        const merged = {
          ...NEUTRAL,
          ...(under ? base.resolve(under.pose, 1) : {}),
          ...(player ? player.resolve(pose, 1) : {}),
        };
        await emit(merged, span);
        frame += span;
      }
      if (tween) {
        const now = (frame + tween / 2) * frameMs;
        const under = base.sample(now) || base.sample(0);
        const mine = player ? player.resolve(pose, 1) : {};
        const next = player ? player.resolve(keys[i + 1][1], 1) : {};
        const merged = {
          ...NEUTRAL,
          ...(under ? base.resolve(under.pose, 1) : {}),
          ...lerpPose(mine, next, 0.5),
        };
        await emit(merged, tween);
        frame += tween;
      }
    }

    manifest.acts[actName] = {
      fps,
      loop: Boolean(act.loop),
      stance: baseName,
      sit: sitFlag,
      ms: Math.round(frame * frameMs),
      frames,
    };
    log(`${actName}: ${frames.length} drawings, ${Math.round(frame * frameMs)} ms`);
  }

  await fetch('/manifest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  log(`done: ${total} drawings, ${Object.keys(manifest.acts).length} acts`);
  await fetch('/done', { method: 'POST', body: JSON.stringify({ ok: true, total }) });
}

main().catch(async (error) => {
  log(`ERROR ${(error && error.message) || error}`);
  await fetch('/done', { method: 'POST', body: JSON.stringify({ ok: false, error: String((error && error.message) || error) }) }).catch(() => {});
});
