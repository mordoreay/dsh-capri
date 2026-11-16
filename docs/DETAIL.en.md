# Capri

Capri — the Project Capricorn construct from *Cyberpunk: Edgerunners* — lives in the corner of the
DeepSeek Harness window and shows what the agent is doing: an action ticker, a line in her own words,
a panel with her face, and a mode for when the agent needs your decision.

A personal adaptation of [capri-desktop](https://github.com/mochiiwuff/capri-desktop): the same
character, drawn inside the DSH window, with no second Electron process and no PowerShell.

## What it does

- **Stands in the window corner** — frame-by-frame animation from her own exposure sheets
  (`acting.js`), 21 clips: floating, asleep, talking, thinking, looking around, reaching
  for the satellite, angry, celebrating, facepalm.
- **Reacts to tools**: reading — she looks, editing — she cocks her head, searching — she looks
  around, a command — red lightning (`zap`), the web — she reaches for the satellite, a subagent —
  her other minds split away.
- **Ticker under her**: verb and target (`EDITS gigs.ts`, `RUNS npm test`, `GREPS "paginate"`); command
  values are never shown, only the first two words.
- **Panel**: her face (frames from the show), name, mode tag, the line, and what is being worked on.
  It leaves after 10 seconds, except when she needs your decision.
- **Needs your decision**: when the agent asks for approval she plays `alarm`, shows her "all eyes"
  face and stays until you answer. Can be turned off in settings.
- **Rest**: with nothing to do she falls asleep (240 seconds of quiet).
- **Click her** for a reaction.
- **Drag her**: pick her up with the mouse and put her anywhere — she plays `grabbed` while held and
  `land` when released; the release does not count as a poke, and the spot survives a restart.
- **Smooth changes**: a new clip fades in over the old one for 150 ms, so poses dissolve instead of
  cutting.
- **Keyboard and screen readers**: Tab focuses her, Space pokes her, and the line lives in
  `aria-live`, so it is announced.
- **Turn summary**: when a turn ends the panel shows what it cost — actions, files, time.
- **Her own session only**: she follows the workspace the window is showing — background sessions and
  subagents stay uncommented, so she does not celebrate someone else's work or raise the alarm for
  nothing. If a turn ends elsewhere, she hops once and says «Другая я закончила.» — no victory, no
  alarm — and the open workspace's scene comes back.
- **Sound**: quiet cues from the original's own synth engine (Web Audio, no audio files) — a blip on a
  line, a tick while working, the alarm, the victory, an error, a purr when you pet her. Turned on and
  levelled in settings; the first cue needs a click in the window, that is the browser's rule.
- **The `/capri` command**: `/capri all` plays every clip in turn, `/capri <clip>` plays one
  (for example `/capri victory`). The show stops as soon as the agent does something.
- **When nothing happens for a while** she says something on her own now and then, from the
  original mod's line sets.

## Settings

**Settings → Capri** (or ⚙ under her): size 50–400 %, window side (left/right), language
(Russian/English), "come for permission". Stored in `~/.dsh/capri.json`, applied instantly.

## How the frames are made

The animation is not redrawn: `sprite.js` is her real WebGL shader and `acting.js` her real exposure
sheets. An offline renderer (`capri-tools/` in the author's workspace) drives the needed poses through
the shader and saves one drawing per key (lossless WebP); squash/stretch, float and lean are baked into the frame
(they are CSS transforms in the original). The plugin plays those drawings with the holds declared in the
sheets — animation on twos, 12 drawings per second.

## Security

- HTTP routes live on the DSH loopback server (`/capri/state`, `/capri/poke`, `/capri/config`,
  `/capri/settings`); cross-site requests are refused by `sec-fetch-site` and `POST` requires
  `application/json`.
- Watching tools and approvals is read-only: on `approval/request` she calls `next()` and never
  answers for you.
- Nothing leaves the machine: the plugin makes no network requests.

## Credits and rights

An unofficial adaptation of [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop):
the character, her artwork, poses and lines come from there; the plugin, the host and client halves,
the settings page and the offline frame renderer come from this repository
([mordoreay/dsh-capri](https://github.com/mordoreay/dsh-capri)). The original's code is under
PolyForm Noncommercial 1.0.0 and so is this adaptation: free, never for sale. The character frames
are output of the original's own shader and exposure sheets and are not covered by the code licence.

Capri, Project Capricorn, Cyberpunk and Cyberpunk: Edgerunners belong to CD PROJEKT RED, Studio
Trigger and Netflix. This is a non-commercial fan work, not affiliated, sponsored or endorsed by them.
