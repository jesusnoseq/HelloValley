"""Grid constants and coordinate helpers (GDD §7.2).

Every module snaps to a 1 m x 1 m x 3 m grid. Modules are authored in Blender space
(Z up, the front face looks towards -Y) and pivot at their bottom-left-front corner, so a
module with a footprint of ``w x d`` cells occupies ``x in [0, w]``, ``y in [0, d]`` and
``z >= 0``. The glTF exporter converts to Y-up: Blender ``(x, y, z)`` becomes glTF
``(x, z, -y)``, so in the exported GLB the module occupies ``x in [0, w]``, ``y >= 0`` and
``z in [-d, 0]``, with the front face at ``z = 0`` looking towards +Z.

Keep CELL_M and STOREY_M in sync with ``packages/shared/src/assets/kit.ts`` (a unit test
checks this).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence, Tuple

CELL_M = 1.0
"""Edge of one grid cell, in metres."""

STOREY_M = 3.0
"""Height of one storey, in metres."""

EPSILON = 1e-4
"""Tolerance used when comparing coordinates (bounds, pivots, snapping)."""

Vec3 = Tuple[float, float, float]


@dataclass(frozen=True)
class Footprint:
    """How many grid cells a module covers on the ground (``w`` along X, ``d`` along the
    depth) and its nominal height ``h`` in metres (one storey for walls, 0 for flat tiles,
    anything for props)."""

    w: int = 1
    d: int = 1
    h: float = STOREY_M

    def __post_init__(self) -> None:
        if self.w < 1 or self.d < 1:
            raise ValueError(f"footprint must cover at least one cell, got {self.w}x{self.d}")
        if self.h < 0:
            raise ValueError("height must be >= 0")

    @property
    def width_m(self) -> float:
        return self.w * CELL_M

    @property
    def depth_m(self) -> float:
        return self.d * CELL_M

    @property
    def height_m(self) -> float:
        return self.h

    @property
    def storeys(self) -> float:
        return self.h / STOREY_M

    def to_json(self) -> dict:
        return {"w": self.w, "d": self.d, "h": round_float(self.h)}


def round_float(value: float, places: int = 4) -> float:
    """Round for stable JSON output; turns -0.0 into 0.0."""
    rounded = round(float(value), places)
    return 0.0 if rounded == 0 else rounded


def round_vec(v: Iterable[float], places: int = 4) -> list:
    return [round_float(c, places) for c in v]


def cells_to_m(cells: float) -> float:
    return cells * CELL_M


def storeys_to_m(storeys: float) -> float:
    return storeys * STOREY_M


def snap(value: float, step: float = CELL_M) -> float:
    """Snap a coordinate to the nearest multiple of ``step``."""
    if step <= 0:
        raise ValueError("step must be > 0")
    return round(value / step) * step


def is_on_grid(value: float, step: float = CELL_M, eps: float = EPSILON) -> bool:
    return abs(value - snap(value, step)) <= eps


def blender_to_gltf(v: Sequence[float]) -> Vec3:
    """Convert a Blender (Z-up) position or direction to glTF (Y-up)."""
    x, y, z = v
    return (float(x), float(z), -float(y))


def gltf_to_blender(v: Sequence[float]) -> Vec3:
    """Inverse of :func:`blender_to_gltf`."""
    x, y, z = v
    return (float(x), -float(z), float(y))


def bounds_of(points: Iterable[Sequence[float]]) -> Tuple[Vec3, Vec3]:
    """Axis-aligned bounds (min, max) of a set of points."""
    it = iter(points)
    try:
        first = next(it)
    except StopIteration:
        raise ValueError("bounds_of needs at least one point") from None
    lo = [float(c) for c in first]
    hi = list(lo)
    for p in it:
        for i in range(3):
            c = float(p[i])
            if c < lo[i]:
                lo[i] = c
            if c > hi[i]:
                hi[i] = c
    return (lo[0], lo[1], lo[2]), (hi[0], hi[1], hi[2])


def union_bounds(boxes: Iterable[Tuple[Sequence[float], Sequence[float]]]) -> Tuple[Vec3, Vec3]:
    corners = []
    for lo, hi in boxes:
        corners.append(lo)
        corners.append(hi)
    return bounds_of(corners)


def blender_bounds_to_gltf(lo: Sequence[float], hi: Sequence[float]) -> Tuple[Vec3, Vec3]:
    """Convert Blender-space bounds to glTF-space bounds (the Y flip swaps min and max)."""
    return bounds_of([blender_to_gltf(lo), blender_to_gltf(hi)])


def footprint_bounds_blender(fp: Footprint) -> Tuple[Vec3, Vec3]:
    """The nominal Blender-space box of a footprint, pivot at the origin."""
    return (0.0, 0.0, 0.0), (fp.width_m, fp.depth_m, fp.height_m)


def pivot_offset(lo: Sequence[float], eps: float = EPSILON) -> Vec3:
    """How far a Blender-space bounding box's bottom-left-front corner is from the origin.

    A module whose geometry sits exactly on its pivot returns ``(0, 0, 0)``. Overhangs (eaves,
    awnings) legitimately push the box below zero; callers decide how much overhang is fine.
    """
    return tuple(0.0 if abs(c) <= eps else float(c) for c in lo)  # type: ignore[return-value]
