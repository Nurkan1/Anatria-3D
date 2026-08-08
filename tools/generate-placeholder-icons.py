"""Generate placeholder application icons.

These are stand-ins so `tauri build` has the icon set it requires. Replace them
with the real Anatria3D mark by dropping a 1024x1024 PNG in and running
`pnpm tauri icon <file>`, which regenerates every size properly.

Written with zlib + struct rather than Pillow so the repo does not grow an
image dependency for a one-off placeholder.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

NAVY = (15, 27, 45, 255)
CYAN = (0, 168, 232, 255)

OUT_DIR = pathlib.Path(__file__).resolve().parents[1] / "src-tauri" / "icons"


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (None)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def _point_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Distance from a point to a line segment, for stroke rasterisation."""
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def render(size: int) -> list[list[tuple[int, int, int, int]]]:
    """A cyan 'A' on a navy rounded square — placeholder for the real mark."""
    s = float(size)
    radius = s * 0.22
    stroke = s * 0.085

    # The three strokes of a capital A, in normalised coordinates.
    segments = [
        (0.28, 0.78, 0.50, 0.22),
        (0.72, 0.78, 0.50, 0.22),
        (0.36, 0.58, 0.64, 0.58),
    ]

    rows: list[list[tuple[int, int, int, int]]] = []
    for y in range(size):
        row: list[tuple[int, int, int, int]] = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5

            # Rounded-square mask.
            cx = min(max(px, radius), s - radius)
            cy = min(max(py, radius), s - radius)
            outside = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - radius
            if outside > 0.5:
                row.append((0, 0, 0, 0))
                continue

            nearest = min(
                _point_to_segment(px, py, ax * s, ay * s, bx * s, by * s)
                for ax, ay, bx, by in segments
            )
            row.append(CYAN if nearest <= stroke / 2 else NAVY)
        rows.append(row)
    return rows


def encode_ico(pngs: list[tuple[int, bytes]]) -> bytes:
    """ICO container holding PNG-compressed entries (Vista+ format)."""
    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    entries, blobs = b"", b""
    for size, blob in pngs:
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        blobs += blob
        offset += len(blob)
    return header + entries + blobs


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cache: dict[int, bytes] = {}

    def png(size: int) -> bytes:
        if size not in cache:
            cache[size] = encode_png(size, size, render(size))
        return cache[size]

    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
        ("Square150x150Logo.png", 150),
        ("Square44x44Logo.png", 44),
        ("StoreLogo.png", 50),
    ]:
        (OUT_DIR / name).write_bytes(png(size))

    (OUT_DIR / "icon.ico").write_bytes(
        encode_ico([(s, png(s)) for s in (16, 32, 48, 64, 128, 256)])
    )

    print(f"wrote placeholder icons to {OUT_DIR}")


if __name__ == "__main__":
    main()
