"""Pure geometry helpers used by the Blender shape builders (no bpy, so they are testable):
atlas UV projection, grid-safe vertex noise and hand-painted colour jitter."""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from .color import RGBA, scale_brightness
from .grid import EPSILON, Vec3
from .variants import VariantRng

TILE_M = 1.0
"""Metres covered by one atlas tile at full size. Faces up to this size keep a constant
texel density; larger faces stretch (the tiles live in an atlas, so they cannot repeat)."""


def dominant_axis(normal: Sequence[float]) -> int:
    """0, 1 or 2: the axis the face mostly faces along."""
    ax = [abs(c) for c in normal]
    return max(range(3), key=lambda i: (ax[i], -i))


def project_face_uvs(
    points: Sequence[Sequence[float]],
    normal: Sequence[float],
    rect: Tuple[float, float, float, float],
    tile_m: float = TILE_M,
) -> List[Tuple[float, float]]:
    """Box-project a face's corner positions into an atlas tile rect ``(u0, v0, u1, v1)``.

    The face is projected on the plane perpendicular to its dominant axis (side faces use
    the vertical axis as V, so planks and bricks stay horizontal). Local coordinates are
    measured from the face's minimum corner and divided by ``max(extent, tile_m)``, so small
    faces sample a proportional part of the tile and nothing leaves the rect.
    """
    if not points:
        return []
    axis = dominant_axis(normal)
    if axis == 2:  # floor/roof-like: X -> U, Y -> V
        ui, vi = 0, 1
    elif axis == 0:  # faces looking along X: Y -> U, Z -> V
        ui, vi = 1, 2
    else:  # faces looking along Y: X -> U, Z -> V
        ui, vi = 0, 2
    us = [float(p[ui]) for p in points]
    vs = [float(p[vi]) for p in points]
    umin, vmin = min(us), min(vs)
    uspan = max(max(us) - umin, tile_m)
    vspan = max(max(vs) - vmin, tile_m)
    u0, v0, u1, v1 = rect
    out = []
    for u, v in zip(us, vs):
        lu = (u - umin) / uspan
        lv = (v - vmin) / vspan
        out.append((u0 + (u1 - u0) * lu, v0 + (v1 - v0) * lv))
    return out


def grid_safe_jitter(
    pos: Sequence[float],
    amount: float,
    rng: VariantRng,
    lo: Optional[Vec3] = None,
    hi: Optional[Vec3] = None,
    eps: float = EPSILON,
) -> Vec3:
    """A small random offset for a vertex, zero along any axis where the vertex sits on the
    module's footprint box (``lo``/``hi``). Neighbouring modules therefore still meet without
    gaps while interior vertices get the slightly hand-made wobble."""
    offset = list(rng.jitter3(amount)) if amount > 0 else [0.0, 0.0, 0.0]
    for i in range(3):
        on_lo = lo is not None and abs(pos[i] - lo[i]) <= eps
        on_hi = hi is not None and abs(pos[i] - hi[i]) <= eps
        if on_lo or on_hi:
            offset[i] = 0.0
            continue
        # Never push an interior vertex out of the box either.
        if lo is not None and pos[i] >= lo[i] and pos[i] + offset[i] < lo[i]:
            offset[i] = lo[i] - pos[i]
        if hi is not None and pos[i] <= hi[i] and pos[i] + offset[i] > hi[i]:
            offset[i] = hi[i] - pos[i]
    return (offset[0], offset[1], offset[2])


def painted_colour(base: RGBA, jitter: float, rng: VariantRng) -> RGBA:
    """Vary a linear colour's brightness by up to ``jitter`` (fraction) for a hand-painted
    look."""
    return scale_brightness(base, 1.0 + rng.jitter(jitter))
