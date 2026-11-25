"""Shared dimensions and helpers for the style-neutral kit (M06), built into ``kits/common/``.

Placement conventions (also in tools/blender/README.md):

- **Ground level** is the pivot plane (z = 0). Terrain tiles are slabs on it whose grass top is
  at ``GROUND_Z``; paths and sand sit a little lower, so edges read as a soft step.
- **Marching-squares edges**: every transition (path, cobble or sand into grass, and water
  into land for river banks) crosses a cell side at its midpoint, so pieces chain in any
  90-degree rotation. ``edge`` has the feature (path, water...) on the front half (y < 0.5),
  ``outer`` has it only in a quarter disc around the front-left corner (a convex corner of
  the feature) and ``inner`` everywhere except a quarter disc of grass/land around the
  back-right corner (a concave corner of the feature).
- **Water** pieces dig below the pivot (``sink_m``): the river bed is at ``BED_Z`` and the
  water surface at ``WATER_Z``, a separate ``water`` mesh the client shades (TODO(M12)).
- **Vegetation** stands on the ground at the footprint centre. Tree canopies are their own
  mesh (``hv_part: canopy``) with the ``canopy`` material and the object origin at the top of
  the trunk, so the client can sway them in a vertex shader (TODO(M12)).
"""

from __future__ import annotations

import math
from typing import List, Sequence, Tuple

from hvkit.budgets import budget_for
from hvkit.module import Module

STYLES = ("common",)

GROUND_Z = 0.1
"""Top of the grass terrain tiles (and of river-bank land)."""
PATH_Z = 0.085
SAND_Z = 0.08
COBBLE_Z = 0.095
WATER_Z = -0.15
"""Water surface of the river (and the bank pieces)."""
BED_Z = -0.45
"""River bed."""
SINK_M = 0.5
"""How far river pieces, the bridge and the dock reach below the pivot."""

Point = Tuple[float, float]


class CommonModule(Module):
    variants = 3
    styles = STYLES

    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        if cls.id and "tri_budget" not in cls.__dict__:
            cls.tri_budget = budget_for(cls.id)


def pick(rng, items: Sequence, variant: int, offset: int = 0):
    """Variant-indexed choice so the three variants differ, with a seeded fallback for extra
    variants."""
    if variant < len(items):
        return items[(variant + offset) % len(items)]
    return rng.choice(items)


def point_in_polygon(p: Point, poly: Sequence[Point]) -> bool:
    """Even-odd rule."""
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            t = (y - y0) / (y1 - y0)
            if x < x0 + (x1 - x0) * t:
                inside = not inside
    return inside


def scatter(
    rng, n: int, accept, lo: Point = (0.0, 0.0), hi: Point = (1.0, 1.0), min_gap: float = 0.1, tries: int = 200
) -> List[Point]:
    """Up to ``n`` seeded points in the box ``lo``..``hi`` for which ``accept(x, y)`` holds,
    at least ``min_gap`` apart (decorations: tufts, pebbles, reeds)."""
    out: List[Point] = []
    for _ in range(tries):
        if len(out) >= n:
            break
        p = (round(rng.uniform(lo[0], hi[0]), 4), round(rng.uniform(lo[1], hi[1]), 4))
        if accept(*p) and all(math.dist(p, q) >= min_gap for q in out):
            out.append(p)
    return out


def smoothstep(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def arc(cx: float, cy: float, r0: float, a0: float, a1: float, segments: int, wobble: float = 0.0, k: int = 1) -> List[Point]:
    """Points on an arc around (cx, cy) from angle ``a0`` to ``a1`` (inclusive). ``wobble``
    varies the radius with ``sin(k * pi * t)``, zero at both ends so seams stay on the cell-side
    midpoints."""
    pts: List[Point] = []
    for s in range(segments + 1):
        t = s / segments
        a = a0 + (a1 - a0) * t
        r = r0 + wobble * math.sin(k * math.pi * t)
        pts.append((round(cx + r * math.cos(a), 6), round(cy + r * math.sin(a), 6)))
    return pts
