# tools — how the drawings are made

The PNGs in `assets/frames/` are not drawn by hand and are not screenshots: they are renders of
capri-desktop's own WebGL shader, driven with capri-desktop's own exposure sheets.

```
pose (acting.js)  ->  sprite.js shader  ->  raw pixels  ->  compose.py  ->  PNG clip
```

| File | Role |
|---|---|
| `page.mjs` | runs in the browser: builds the pose of every drawing the way `capri.js` does (`NEUTRAL` + stance + act), draws it with her shader and reads the pixels back |
| `serve.mjs` | static server and sink: serves the workspace, receives raw frames and the manifest |
| `drive.mjs` | starts the server, launches headless Chrome on the page, waits for the manifest |
| `compose.py` | bakes the CSS transforms the original applies on the desktop (float, lean, squash) into the frame, premultiplied so edges do not halo, and writes the PNGs |
| `compose-sheet.py` | contact sheet of every clip, for looking at all of them at once |
| `review.mjs` | 52 checks of the host half: routes, guards, clamps, approvals, turn end, playback |
| `verify-clips.mjs` | 29 checks of the assets: every drawing exists and decodes, clips animate, faces and line sets resolve |

## Prerequisites

1. **capri-desktop sources** in `src-capri/capri-desktop-main` inside this repository (gitignored):

   ```sh
   git clone --depth 1 https://github.com/mochiiwuff/capri-desktop.git src-capri/capri-desktop-main
   ```

   The renderer imports `src/renderer/js/sprite.js` and `src/renderer/js/acting.js` from there and uses
   `assets/capri/capri-full.png` as her texture — the plugin ships the output, not the inputs.

2. **Chrome with a real GPU.** The renderer needs working WebGL *and* a working readback. Under
   SwiftShader, `readPixels` deadlocks the page, so headless rendering with a software rasterizer does
   not work: it is launched with `--headless=new` and the machine's GPU.

3. **Full filesystem permission** for the process that launches Chrome: Chromium creates its IPC
   channels through named pipes, which a confined sandbox refuses (`platform_channel.cc: Access
   denied`). On a normal desktop session this is not an issue.

## Rebuilding the assets

```sh
node tools/drive.mjs --clean        # renders every drawing into tools/out/raw + manifest
python tools/compose.py             # writes the PNG clips into tools/frames
cp -r tools/frames/* ../assets/frames/   # from inside the repo root: assets/frames/
cp tools/frames/clips.json assets/clips.json
```

The plugin's asset version is derived from the canvas size and the drawing count, so a re-render
invalidates the browser cache on its own — no manual `?v=` bump is needed.

**Boil.** A drawing held for three frames or more is rendered several times with a fresh line seed
(`BOIL_EVERY`, `BOIL_CAP` in `page.mjs`), so the line keeps wobbling instead of freezing. That is what
takes the clip count from 177 key drawings to 350 rendered drawings (boil plus tweens).

**Tweens.** The fast sheets hold a drawing for one 24 fps frame (42 ms), which reads as a cut. For
`zap`, `victory`, `hop`, `land`, `turn`, `grabbed`, `shake`, `point`, `split` and `flinch` the renderer emits one
extra drawing halfway to the next key and shortens the hold it came from by the same frame, so the clip
keeps its length but the beats move smoothly. Open the render page as `page.html?tween=0` to render
without them.

**Layout note.** `page.html` imports `./page.mjs`, the page imports `/src-capri/capri-desktop-main/...`,
and `serve.mjs` serves the repository root — so `src-capri` must sit at the repository root, which is
what the `.gitignore` expects.

## Checks

```sh
node tools/review.mjs          # host half in a fake Cordis context
node tools/verify-clips.mjs    # every clip's drawings, timings, faces and line sets
```
