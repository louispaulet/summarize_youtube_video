#!/usr/bin/env python3
from __future__ import annotations

import argparse
from colorsys import rgb_to_hsv
from io import BytesIO
from pathlib import Path

from PIL import Image
from rembg import remove


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove the background from an image and write a transparent PNG."
    )
    parser.add_argument("input", type=Path, help="Path to the source image.")
    parser.add_argument("output", type=Path, help="Path to the output PNG.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(args.input) as image:
        rgba_image = image.convert("RGBA")
        input_buffer = BytesIO()
        rgba_image.save(input_buffer, format="PNG")

    output_bytes = remove(
        input_buffer.getvalue(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=10,
    )

    with Image.open(BytesIO(output_bytes)) as output_image:
        rgba_image = output_image.convert("RGBA")
        filtered = Image.new("RGBA", rgba_image.size, (0, 0, 0, 0))
        source_pixels = rgba_image.load()
        filtered_pixels = filtered.load()

        for y in range(rgba_image.height):
            for x in range(rgba_image.width):
                red, green, blue, alpha = source_pixels[x, y]
                if alpha == 0:
                    continue

                hue, saturation, value = rgb_to_hsv(red / 255, green / 255, blue / 255)
                keep_pixel = (
                    value < 0.45
                    or (saturation > 0.45 and not (0.46 <= hue <= 0.78))
                    or (saturation < 0.2 and value < 0.7)
                )

                if keep_pixel:
                    filtered_pixels[x, y] = (red, green, blue, alpha)

        bbox = filtered.getbbox()
        if bbox:
            filtered = filtered.crop(bbox)
            square_size = max(filtered.size)
            square = Image.new("RGBA", (square_size, square_size), (0, 0, 0, 0))
            square.paste(
                filtered,
                (
                    (square_size - filtered.size[0]) // 2,
                    (square_size - filtered.size[1]) // 2,
                ),
            )
            filtered = square

        filtered.save(args.output, format="PNG")


if __name__ == "__main__":
    main()
