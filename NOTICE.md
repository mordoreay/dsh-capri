# Notice

This repository is an unofficial DeepSeek Harness adaptation of the fan app
**capri-desktop** by **mochiiwuff**:

- Original repository: https://github.com/mochiiwuff/capri-desktop
- Original author: mochiiwuff
- Original licence: PolyForm Noncommercial 1.0.0 (versions up to 0.4.3 were MIT)

The character, her artwork, her animation data and the dialogue this plugin uses come from the
original project. What this repository adds is the DeepSeek Harness part: the bundle packaging, the
host half that reads what the agent is doing, the browser half that draws her inside the DSH window,
the settings page, and the offline renderer that turns her own WebGL shader and exposure sheets into
the PNG clips the plugin plays.

**How the drawings were made.** They were rendered offline from the original's own renderer
(`src/renderer/js/sprite.js`) and its own exposure sheets (`src/renderer/js/acting.js`), by driving
that shader frame by frame and baking each drawing to a PNG. No artwork was redrawn or copied from
the show; the frames are output of the original's own code, and they stay under the original
noncommercial terms.

**Character rights.** Capri, Project Capricorn, Cyberpunk and Cyberpunk: Edgerunners belong to
CD PROJEKT RED, Studio Trigger and Netflix. This is a non-commercial fan work, not affiliated with,
sponsored or endorsed by them. The licence in [LICENSE](LICENSE) covers code and documentation only;
it does not grant rights to trademarks or third-party characters, and it does not cover the character
artwork in `assets/`.

**No other borrowed material.** No fonts, sounds or images from the show or from other projects are
bundled. The contact sheet in `docs/` is a render of this repository's own frames.
