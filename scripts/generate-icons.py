#!/usr/bin/env python3
"""Generate Ephemeral's original raster icon set from geometric primitives."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def shield_icon(size: int) -> Image.Image:
    scale = 8
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    s = size * scale
    shield = [(0.49*s, 0.07*s), (0.82*s, 0.19*s), (0.82*s, 0.49*s),
              (0.78*s, 0.68*s), (0.64*s, 0.82*s), (0.49*s, 0.91*s),
              (0.34*s, 0.82*s), (0.20*s, 0.68*s), (0.16*s, 0.49*s), (0.16*s, 0.19*s)]
    # Vertical gradient clipped by a high-resolution shield mask.
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).polygon(shield, fill=255)
    gradient = Image.new("RGBA", canvas.size)
    pixels = gradient.load()
    top, bottom = (13, 101, 112), (50, 184, 189)
    for y in range(s):
        t = y / max(1, s - 1)
        color = tuple(round(top[i] * (1-t) + bottom[i] * t) for i in range(3)) + (255,)
        for x in range(s):
            pixels[x, y] = color
    canvas.alpha_composite(Image.composite(gradient, Image.new("RGBA", canvas.size), mask))
    draw = ImageDraw.Draw(canvas)
    inner = [(0.49*s, 0.25*s), (0.66*s, 0.31*s), (0.66*s, 0.50*s),
             (0.62*s, 0.61*s), (0.49*s, 0.70*s), (0.36*s, 0.61*s),
             (0.32*s, 0.50*s), (0.32*s, 0.31*s)]
    inner2 = [(0.49*s, 0.35*s), (0.57*s, 0.38*s), (0.57*s, 0.50*s),
              (0.55*s, 0.55*s), (0.49*s, 0.60*s), (0.43*s, 0.55*s),
              (0.41*s, 0.50*s), (0.41*s, 0.38*s)]
    draw.polygon(inner, fill=(255, 255, 255, 242))
    draw.polygon(inner2, fill=(24, 133, 143, 255))
    for cx, cy, r, color in [
        (0.84, 0.59, 0.064, (50, 184, 189, 255)),
        (0.89, 0.73, 0.043, (112, 211, 211, 255)),
        (0.84, 0.84, 0.029, (179, 236, 232, 255)),
    ]:
        draw.ellipse(((cx-r)*s, (cy-r)*s, (cx+r)*s, (cy+r)*s), fill=color)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def toolbar(size: int, color: tuple[int, int, int, int]) -> Image.Image:
    scale = 8
    s = size * scale
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    points = [(0.47*s, 0.08*s), (0.77*s, 0.19*s), (0.77*s, 0.46*s),
              (0.73*s, 0.62*s), (0.62*s, 0.76*s), (0.47*s, 0.87*s),
              (0.32*s, 0.76*s), (0.21*s, 0.62*s), (0.17*s, 0.46*s), (0.17*s, 0.19*s)]
    draw.line(points + [points[0]], fill=color, width=max(2, round(0.09*s)), joint="curve")
    draw.ellipse((0.76*s, 0.57*s, 0.90*s, 0.71*s), fill=color)
    draw.ellipse((0.84*s, 0.75*s, 0.93*s, 0.84*s), fill=color)
    return image.resize((size, size), Image.Resampling.LANCZOS)


for icon_size in (16, 32, 48, 64, 96, 128):
    shield_icon(icon_size).save(OUT / f"icon-{icon_size}.png", optimize=True)
toolbar(32, (245, 250, 251, 255)).save(OUT / "toolbar-light-32.png", optimize=True)
toolbar(32, (25, 36, 42, 255)).save(OUT / "toolbar-dark-32.png", optimize=True)
print(f"Generated icons in {OUT}")
