#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert a PNG image to a WebP file.")
    parser.add_argument("input", type=Path, help="Path to the source PNG.")
    parser.add_argument("output", type=Path, help="Path to the output WebP.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(args.input) as image:
        rgba_image = image.convert("RGBA")
        rgba_image.save(args.output, format="WEBP", lossless=True, quality=100, method=6)


if __name__ == "__main__":
    main()
