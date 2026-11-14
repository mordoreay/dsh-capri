"""Builds one contact sheet of every rendered clip: three drawings per act, two acts per row.

Not a motion test (that is what the app does) but a look at all 22 clips at once: every drawing
decodes, nothing is blank, cropped or mirrored by accident.

    python compose-sheet.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
FRAMES = HERE / "frames"
OUT = HERE / "shots" / "all-clips.png"

CELL_H = 150
PAD = 6
LABEL_W = 74
COLUMNS = 4  # drawings shown per act


def strip(act: str, paths: list[Path]) -> Image.Image:
    first = Image.open(paths[0]).convert("RGBA")
    cell_w = round(first.width * CELL_H / first.height)
    width = LABEL_W + len(paths) * (cell_w + PAD)
    out = Image.new("RGBA", (width, CELL_H + PAD), (12, 14, 18, 255))
    draw = ImageDraw.Draw(out)
    draw.text((4, CELL_H // 2 - 6), act, fill=(140, 255, 61, 255))
    for i, path in enumerate(paths):
        image = Image.open(path).convert("RGBA")
        image = image.resize((cell_w, CELL_H), Image.LANCZOS)
        x = LABEL_W + i * (cell_w + PAD)
        out.paste(image, (x, 0), image)
    return out


def main() -> int:
    acts = sorted(p.name for p in FRAMES.iterdir() if p.is_dir())
    strips = []
    for act in acts:
        files = sorted((FRAMES / act).glob("*.png"))
        if not files:
            continue
        picks = [0, len(files) // 3, (2 * len(files)) // 3, len(files) - 1]
        picks = sorted(set(picks))
        strips.append(strip(act, [files[i] for i in picks]))

    row_w = max(s.width for s in strips)
    rows = (len(strips) + 1) // 2
    sheet = Image.new("RGBA", (row_w * 2, rows * (CELL_H + PAD)), (12, 14, 18, 255))
    for index, image in enumerate(strips):
        x = (index % 2) * row_w
        y = (index // 2) * (CELL_H + PAD)
        sheet.paste(image, (x, y))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(OUT, optimize=True)
    print(f"{len(strips)} clips -> {OUT} ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
