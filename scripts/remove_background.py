#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove the outer white halo from a logo while preserving the blue border."
    )
    parser.add_argument("input", type=Path, help="Path to the source image.")
    parser.add_argument("output", type=Path, help="Path to the output PNG.")
    return parser.parse_args()


def is_background_candidate(r: int, g: int, b: int, a: int) -> bool:
    if a == 0:
        return True

    brightest = max(r, g, b)
    darkest = min(r, g, b)
    saturation = 0.0 if brightest == 0 else (brightest - darkest) / brightest

    # Remove only very light, low-saturation pixels that form the outer halo.
    return saturation < 0.18 and brightest > 205


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(args.input) as image:
        rgba = image.convert("RGBA")

    width, height = rgba.size
    pixels = rgba.load()
    background = [[False] * width for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if not background[y][x]:
            r, g, b, a = pixels[x, y]
            if is_background_candidate(r, g, b, a):
                background[y][x] = True
                queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)

    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    neighbors = (
        (-1, -1),
        (-1, 0),
        (-1, 1),
        (0, -1),
        (0, 1),
        (1, -1),
        (1, 0),
        (1, 1),
    )

    while queue:
        x, y = queue.popleft()
        for dx, dy in neighbors:
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not background[ny][nx]:
                r, g, b, a = pixels[nx, ny]
                if is_background_candidate(r, g, b, a):
                    background[ny][nx] = True
                    queue.append((nx, ny))

    cutout = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    cutout_pixels = cutout.load()
    for y in range(height):
        for x in range(width):
            if not background[y][x]:
                cutout_pixels[x, y] = pixels[x, y]

    bbox = cutout.getbbox()
    if bbox:
        cutout = cutout.crop(bbox)
        square_size = max(cutout.size)
        square = Image.new("RGBA", (square_size, square_size), (0, 0, 0, 0))
        square.paste(
            cutout,
            (
                (square_size - cutout.size[0]) // 2,
                (square_size - cutout.size[1]) // 2,
            ),
        )
        cutout = square

    cutout.save(args.output, format="PNG")


if __name__ == "__main__":
    main()
