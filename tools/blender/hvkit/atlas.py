"""The per-style tiling texture atlas (GDD §7.1: vertex colours plus one small hand-painted
atlas per style).

The atlas is a grid of square tiles. Each tile is a seamless, low-contrast, near-white
"painted" detail texture (plaster blotches, planks, tiles...). Hue comes from vertex colours;
the atlas only adds brush-stroke detail, so one atlas serves every palette of the style.

Generation is pure Python and deterministic (seeded), and :func:`write_png` saves it without
Blender, so ``python -m hvkit.atlas`` can preview a style's atlas. Hand-painted textures made
with docs/prompts/art.md §4 can later replace a tile by dropping a PNG next to the style
(TODO(M37): needs an image-generation pass, which this repo's tooling does not run; see
pending.md M05).

UV convention: Blender UVs (origin bottom-left). Tile 0 is the top-left tile of the image.
"""

from __future__ import annotations

import math
import struct
import zlib
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

from .variants import VariantRng

PATTERNS = ("plain", "plaster", "planks", "bricks", "tiles", "cobble", "speckle", "streaks")


@dataclass(frozen=True)
class AtlasTile:
    name: str
    pattern: str = "plaster"
    strength: float = 0.08
    """Peak-to-peak brightness variation, 0..1. Keep it subtle (low contrast)."""

    def __post_init__(self) -> None:
        if self.pattern not in PATTERNS:
            raise ValueError(f"unknown atlas pattern {self.pattern!r}")


@dataclass(frozen=True)
class AtlasLayout:
    size: int = 512
    columns: int = 4
    gutter: int = 4
    """Pixels inset on each side of a tile's UV rect so mipmapped sampling does not bleed."""

    def __post_init__(self) -> None:
        if self.size % self.columns != 0:
            raise ValueError("atlas size must be divisible by the column count")
        if self.gutter * 2 >= self.tile_px:
            raise ValueError("gutter too large for the tile size")

    @property
    def tile_px(self) -> int:
        return self.size // self.columns

    @property
    def capacity(self) -> int:
        return self.columns * self.columns

    def tile_origin_px(self, index: int) -> Tuple[int, int]:
        """Top-left pixel (x, y from the top) of a tile."""
        self._check(index)
        return (index % self.columns) * self.tile_px, (index // self.columns) * self.tile_px

    def tile_uv_rect(self, index: int) -> Tuple[float, float, float, float]:
        """(u0, v0, u1, v1) in Blender UV space, inset by the gutter."""
        x, y_top = self.tile_origin_px(index)
        s = float(self.size)
        g = self.gutter
        u0 = (x + g) / s
        u1 = (x + self.tile_px - g) / s
        # Pixel rows count from the top; UV v counts from the bottom.
        v1 = 1.0 - (y_top + g) / s
        v0 = 1.0 - (y_top + self.tile_px - g) / s
        return (u0, v0, u1, v1)

    def map_uv(self, index: int, u: float, v: float) -> Tuple[float, float]:
        """Map a local (u, v) in [0, 1] (clamped) into a tile's rect."""
        u0, v0, u1, v1 = self.tile_uv_rect(index)
        u = min(max(u, 0.0), 1.0)
        v = min(max(v, 0.0), 1.0)
        return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)

    def _check(self, index: int) -> None:
        if not 0 <= index < self.capacity:
            raise IndexError(f"atlas tile {index} out of range 0..{self.capacity - 1}")


class Atlas:
    """A layout plus named tiles."""

    def __init__(self, tiles: Sequence[AtlasTile], layout: AtlasLayout = AtlasLayout()) -> None:
        if len(tiles) > layout.capacity:
            raise ValueError(f"{len(tiles)} tiles do not fit a {layout.columns}x{layout.columns} atlas")
        names = [t.name for t in tiles]
        if len(set(names)) != len(names):
            raise ValueError("atlas tile names must be unique")
        self.layout = layout
        self.tiles = list(tiles)
        self._index: Dict[str, int] = {t.name: i for i, t in enumerate(tiles)}

    def index(self, name: str) -> int:
        try:
            return self._index[name]
        except KeyError:
            raise KeyError(f"atlas has no tile {name!r}; known: {sorted(self._index)}") from None

    def uv_rect(self, name: str) -> Tuple[float, float, float, float]:
        return self.layout.tile_uv_rect(self.index(name))

    def map_uv(self, name: str, u: float, v: float) -> Tuple[float, float]:
        return self.layout.map_uv(self.index(name), u, v)

    def tile_manifest(self) -> Dict[str, List[float]]:
        """UV rects per tile name, written into kit-manifest.json for runtime use."""
        return {t.name: [round(c, 6) for c in self.uv_rect(t.name)] for t in self.tiles}


# --- procedural painting -------------------------------------------------------------------


def _smooth(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


class _PeriodicNoise:
    """Value noise on a lattice that wraps every ``period`` cells, so it tiles seamlessly."""

    def __init__(self, rng: VariantRng, period: int) -> None:
        self.period = period
        self.values = [[rng.random() for _ in range(period)] for _ in range(period)]

    def sample(self, x: float, y: float) -> float:
        """x, y in [0, 1) tile space; returns [0, 1]."""
        p = self.period
        fx, fy = x * p, y * p
        ix, iy = int(math.floor(fx)), int(math.floor(fy))
        tx, ty = _smooth(fx - ix), _smooth(fy - iy)
        v = self.values
        a = v[iy % p][ix % p]
        b = v[iy % p][(ix + 1) % p]
        c = v[(iy + 1) % p][ix % p]
        d = v[(iy + 1) % p][(ix + 1) % p]
        top = a + (b - a) * tx
        bottom = c + (d - c) * tx
        return top + (bottom - top) * ty


def _seam(t: float, width: float) -> float:
    """1 near integer boundaries of t (within ``width``), fading to 0."""
    f = t - math.floor(t)
    dist = min(f, 1.0 - f)
    return max(0.0, 1.0 - dist / width) if width > 0 else 0.0


def tile_value(tile: AtlasTile, octaves: Sequence[_PeriodicNoise], x: float, y: float) -> float:
    """Brightness in [0, 1] for one tile pixel at tile-space (x, y), both in [0, 1)."""
    noise = 0.0
    weight = 0.0
    amp = 1.0
    for o in octaves:
        noise += o.sample(x, y) * amp
        weight += amp
        amp *= 0.5
    noise = noise / weight - 0.5  # [-0.5, 0.5]

    base = 1.0 - tile.strength  # leave headroom so the peak stays <= 1
    detail = noise * tile.strength
    if tile.pattern == "plain":
        return 1.0
    if tile.pattern == "plaster":
        return base + tile.strength * 0.5 + detail
    if tile.pattern == "speckle":
        # Grass, dirt, sand and leaves: soft blotches plus small darker flecks.
        fine = octaves[-1].sample(x, y)
        fleck = max(0.0, fine - 0.72) / 0.28
        return base + tile.strength * 0.55 + detail * 0.8 - fleck * tile.strength * 1.1
    if tile.pattern == "streaks":
        # Bark: vertical grain (varies with x only, so it stays seamless) plus a little noise.
        grain = sum(o.sample(x, 0.37) for o in octaves) / len(octaves) - 0.5
        return base + tile.strength * 0.5 + grain * tile.strength * 1.6 + detail * 0.3
    rows = 4
    if tile.pattern == "planks":
        band = math.floor(y * rows)
        shade = ((band * 7919) % 5) / 5.0 - 0.4  # deterministic per-band tone
        seam = _seam(y * rows, 0.06)
        return base + tile.strength * (0.5 + 0.4 * shade) + detail * 0.6 - seam * tile.strength * 1.2
    if tile.pattern in ("bricks", "tiles", "cobble"):
        cols = 2 if tile.pattern == "bricks" else 4
        row = math.floor(y * rows)
        offset = 0.5 if (tile.pattern == "bricks" and row % 2 == 1) else 0.0
        if tile.pattern == "cobble":
            offset = 0.25 * (row % 2)
        seam = max(_seam(y * rows, 0.07), _seam(x * cols + offset, 0.07))
        return base + tile.strength * 0.6 + detail - seam * tile.strength * 1.4
    raise ValueError(tile.pattern)  # pragma: no cover - guarded by AtlasTile


def render_atlas(atlas: Atlas, seed: int, background: float = 1.0) -> List[float]:
    """RGBA floats (sRGB, 0..1) in Blender ``Image.pixels`` order: rows from the bottom.

    Unused tiles are filled with ``background``. The gutter keeps wrapping the tile pattern,
    which is what mipmaps want for a seamless tile.
    """
    layout = atlas.layout
    size, tp = layout.size, layout.tile_px
    rows_top_down: List[List[float]] = [[background] * size for _ in range(size)]
    root = VariantRng(seed)
    for i, tile in enumerate(atlas.tiles):
        rng = root.fork(tile.name)
        octaves = [_PeriodicNoise(rng, 4), _PeriodicNoise(rng, 8), _PeriodicNoise(rng, 16)]
        ox, oy = layout.tile_origin_px(i)
        for py in range(tp):
            row = rows_top_down[oy + py]
            ty = (py + 0.5) / tp
            for px in range(tp):
                v = tile_value(tile, octaves, (px + 0.5) / tp, ty)
                row[ox + px] = min(max(v, 0.0), 1.0)
    out: List[float] = []
    for row in reversed(rows_top_down):
        for v in row:
            out.extend((v, v, v, 1.0))
    return out


def write_png(path: str, size: int, pixels_bottom_up: Sequence[float]) -> None:
    """Write RGBA floats (Blender order, bottom row first) as an 8-bit RGB PNG."""
    if len(pixels_bottom_up) != size * size * 4:
        raise ValueError("pixel buffer does not match the image size")
    raw = bytearray()
    for y in range(size - 1, -1, -1):  # PNG rows go top-down
        raw.append(0)  # filter: none
        start = y * size * 4
        for x in range(size):
            i = start + x * 4
            for c in range(3):
                raw.append(int(round(min(max(pixels_bottom_up[i + c], 0.0), 1.0) * 255)))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":  # pragma: no cover - manual preview
    import argparse

    from .styles import get_style

    parser = argparse.ArgumentParser(description="Render a style atlas to PNG without Blender.")
    parser.add_argument("--style", default="european")
    parser.add_argument("out")
    args = parser.parse_args()
    style = get_style(args.style)
    atlas = style.atlas()
    write_png(args.out, atlas.layout.size, render_atlas(atlas, style.seed))
    print(f"wrote {args.out}")
