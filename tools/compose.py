"""Composite Capri's raw GL readbacks into sprite frames.

The page renders each key drawing of an exposure sheet with her real shader and posts the raw
RGBA pixels. Her squash/stretch, float (bob) and lean (tilt) are applied by CSS transforms in the
original app (canvas transform around the sprite centre), so they are baked here: one affine pass
per frame, premultiplied so the alpha edges do not halo.

    python compose.py [--raw out] [--frames frames] [--quantize 192]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def premultiply(arr: np.ndarray) -> np.ndarray:
    alpha = arr[..., 3:4].astype(np.float32) / 255.0
    out = np.empty_like(arr, dtype=np.uint8)
    out[..., :3] = np.clip(arr[..., :3].astype(np.float32) * alpha, 0, 255).astype(np.uint8)
    out[..., 3] = arr[..., 3]
    return out


def unpremultiply(arr: np.ndarray) -> np.ndarray:
    alpha = arr[..., 3:4].astype(np.float32) / 255.0
    out = np.empty_like(arr, dtype=np.uint8)
    safe = np.maximum(alpha, 1e-4)
    out[..., :3] = np.clip(arr[..., :3].astype(np.float32) / safe, 0, 255).astype(np.uint8)
    out[..., 3] = arr[..., 3]
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="out")
    parser.add_argument("--frames", default="frames")
    parser.add_argument("--quantize", type=int, default=192)
    args = parser.parse_args()

    raw_dir = Path(args.raw).resolve()
    frames_dir = Path(args.frames).resolve()
    manifest = json.loads((raw_dir / "manifest.json").read_text(encoding="utf-8"))

    scale = float(manifest["scale"])
    margin = float(manifest["margin"])
    sprite = manifest["sprite"]
    surface = manifest["surface"]
    sw, sh = int(surface["width"]), int(surface["height"])

    out_w = round((sprite["width"] + margin * 2) * scale)
    out_h = round((sprite["height"] + margin * 2) * scale)
    ox, oy = out_w / 2.0, out_h / 2.0
    cx, cy = sw / 2.0, sh / 2.0

    clips = {
        "scale": scale,
        "margin": margin,
        "sprite": sprite,
        "surface": surface,
        "canvas": {"width": out_w, "height": out_h},
        "acts": {},
    }

    total = 0
    for act_name, act in manifest["acts"].items():
        act_dir = frames_dir / act_name
        act_dir.mkdir(parents=True, exist_ok=True)
        steps = []
        for frame in act["frames"]:
            blob = (raw_dir / "raw" / act_name / f"{frame['name']}.rgba").read_bytes()
            expected = sw * sh * 4
            if len(blob) != expected:
                raise SystemExit(f"{act_name}/{frame['name']}: {len(blob)} bytes, expected {expected}")
            arr = np.frombuffer(blob, dtype=np.uint8).reshape(sh, sw, 4)[::-1]
            prem = Image.fromarray(premultiply(arr), "RGBA")

            theta = math.radians(float(frame["tilt"]))
            cos, sin = math.cos(theta), math.sin(theta)
            sx = float(frame["sx"]) or 1.0
            sy = float(frame["sy"]) or 1.0
            bob = float(frame["bob"]) * scale

            a = cos / sx
            b = sin / sy
            d = -sin / sx
            e = cos / sy
            c = cx - a * ox - b * (oy + bob)
            f = cy - d * ox - e * (oy + bob)

            moved = prem.transform((out_w, out_h), Image.AFFINE, (a, b, c, d, e, f),
                                   resample=Image.BICUBIC, fillcolor=(0, 0, 0, 0))
            image = Image.fromarray(unpremultiply(np.array(moved)), "RGBA")
            if args.quantize:
                image = image.quantize(colors=int(args.quantize), method=Image.FASTOCTREE)
            image.save(act_dir / f"{frame['name']}.png", optimize=True)

            steps.append([frame["name"], int(frame["hold"])])
            total += 1

        clips["acts"][act_name] = {
            "fps": act["fps"],
            "loop": act["loop"],
            "stance": act["stance"],
            "sit": act["sit"],
            "ms": act["ms"],
            "steps": steps,
        }
        print(f"{act_name}: {len(steps)} frames, {act['ms']} ms")

    (frames_dir / "clips.json").write_text(json.dumps(clips, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in frames_dir.rglob("*.png"))
    print(f"done: {total} frames, {size / 1024 / 1024:.1f} MB, canvas {out_w}x{out_h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
