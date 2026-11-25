"""Builder helpers shared by the interior modules: legs, knobs, frames, shelf cases, rows of
books and jars. They only call ``MeshBuilder`` methods, so importing this file needs no Blender;
calling the helpers does."""

from __future__ import annotations

from typing import Optional, Sequence, Tuple

from hvkit import solids
from hvkit.variants import VariantRng

from .base import ellipse


def legs(b, paint, x0: float, y0: float, x1: float, y1: float, h: float, t: float = 0.05, inset: float = 0.0,
         round_: bool = False, z0: float = 0.0) -> None:
    """Four legs at the corners of the rectangle (x0, y0)..(x1, y1), ``t`` thick."""
    for x in (x0 + inset, x1 - inset - t):
        for y in (y0 + inset, y1 - inset - t):
            if round_:
                b.cylinder((x + t / 2, y + t / 2, z0), t / 2, h, paint, sides=6, radius_top=t * 0.4, bevel=0.0)
            else:
                b.box((x, y, z0), (x + t, y + t, z0 + h), paint, bevel=0.0)


def knob(b, paint, x: float, y: float, z: float, r: float = 0.022) -> None:
    """A small round knob on a front face (y is the face plane; the knob sticks out to -Y, about
    ``1.4 * r`` in front of it)."""
    b.blob((x, y - r * 0.6, z), r, paint, scale=(1.0, 0.8, 1.0), subdivisions=1, wobble=0.0)


def rect_frame(b, paint, x0: float, z0: float, x1: float, z1: float, y0: float, y1: float, w: float = 0.04) -> None:
    """A flat rectangular frame in the x/z plane (picture frames, door casings)."""
    b.box((x0, y0, z0), (x1, y1, z0 + w), paint, bevel=0.0)
    b.box((x0, y0, z1 - w), (x1, y1, z1), paint, bevel=0.0)
    b.box((x0, y0, z0 + w), (x0 + w, y1, z1 - w), paint, bevel=0.0)
    b.box((x1 - w, y0, z0 + w), (x1, y1, z1 - w), paint, bevel=0.0)


def oval_frame(b, paint, inner, cx: float, cz: float, rx: float, rz: float, y0: float, y1: float, border: float = 0.04,
               segments: int = 16, inset: float = 0.008) -> None:
    """An oval frame: a slab of ``paint`` with an ``inner`` oval (glass, canvas) just in front."""
    b.solid(solids.prism(ellipse(cx, cz, rx, rz, segments), "y", y0, y1), paint, bevel=0.0)
    b.solid(solids.prism(ellipse(cx, cz, rx - border, rz - border, segments), "y", y0 - inset, y0), inner, bevel=0.0, noise=0.0)


def case(b, paint, x0: float, y0: float, x1: float, y1: float, h: float, shelves: Sequence[float], t: float = 0.03,
         back=None, top_overhang: float = 0.0, plinth: float = 0.06) -> None:
    """An open shelf case: two sides, a back, a plinth, a top and shelves at the given heights.
    The front is y0 (open), the back y1."""
    for x in (x0, x1 - t):
        b.box((x, y0, 0.0), (x + t, y1, h), paint, bevel=0.0)
    b.box((x0 + t, y1 - 0.015, plinth), (x1 - t, y1, h - t), back or paint, bevel=0.0)
    b.box((x0 + t, y0, 0.0), (x1 - t, y1 - 0.015, plinth), paint, bevel=0.0)
    b.box((x0 - top_overhang, y0 - top_overhang, h - t), (x1 + top_overhang, y1, h), paint, bevel=0.008, segments=1)
    for z in shelves:
        b.box((x0 + t, y0 + 0.01, z - t * 0.7), (x1 - t, y1 - 0.015, z), paint, bevel=0.0)


def books(b, ctx, rng: VariantRng, x0: float, x1: float, y0: float, y1: float, z: float, hmax: float,
          group: str = "books", gap_chance: float = 0.12, lean: bool = True) -> None:
    """A row of books standing on a shelf at height ``z`` from x0 to x1, at most ``hmax`` tall,
    with seeded heights, thicknesses and spine colours (and the odd gap or leaning book)."""
    n = len(ctx.style.palette[group])
    x = x0
    leaned = False
    while x < x1 - 0.025:
        w = rng.uniform(0.025, 0.055)
        if x + w > x1:
            break
        if rng.chance(gap_chance):
            x += rng.uniform(0.03, 0.08)
            continue
        h = rng.uniform(0.62, 0.95) * hmax
        d = rng.uniform(0.7, 0.95) * (y1 - y0)
        paint = ctx.paint(group, rng.randint(0, n - 1), tile="plain")
        if lean and not leaned and x1 - x > 0.25 and rng.chance(0.1):
            # One book leaning on its neighbours.
            solid = solids.box((x, y0, z), (x + w, y0 + d, z + h * 0.9))
            solid = rotate_x_free(solid, x, z, -0.35)
            b.solid(solid, paint, bevel=0.0)
            x += w + h * 0.3
            leaned = True
            continue
        b.box((x, y0, z), (x + w, y0 + d, z + h), paint, bevel=0.0)
        x += w + rng.uniform(0.0, 0.006)


def rotate_x_free(solid, x_pivot: float, z_pivot: float, angle: float):
    """Tilt a solid in the x/z plane around (x_pivot, z_pivot) (a leaning book)."""
    import math

    verts, faces = solid
    c, s = math.cos(angle), math.sin(angle)
    out = []
    for x, y, z in verts:
        dx, dz = x - x_pivot, z - z_pivot
        out.append((x_pivot + dx * c - dz * s, y, z_pivot + dx * s + dz * c))
    return out, faces


def jars(b, ctx, rng: VariantRng, x0: float, x1: float, yc: float, z: float, hmax: float, rmax: float = 0.05,
         groups: Sequence[Tuple[str, int]] = (("glass", 0),), lids: Optional[Tuple[str, int]] = ("metal", 2), sides: int = 8) -> None:
    """A row of jars, tins or bottles on a shelf at height ``z``, centred on depth ``yc``."""
    x = x0
    while x < x1:
        r = rng.uniform(0.6, 1.0) * rmax
        if x + 2 * r > x1:
            break
        h = rng.uniform(0.55, 1.0) * hmax
        group, idx = groups[rng.randint(0, len(groups) - 1)]
        cx = x + r
        b.cylinder((cx, yc, z), r, h, ctx.paint(group, idx, tile="plain"), sides=sides, bevel=0.0)
        if lids:
            b.cylinder((cx, yc, z + h), r * 1.02, min(0.02, h * 0.15), ctx.paint(*lids, tile="plain"), sides=sides, bevel=0.0)
        x += 2 * r + rng.uniform(0.01, 0.03)


def bread(b, ctx, rng: VariantRng, x: float, y: float, z: float, kind: str, swatch: int = 0) -> None:
    """One baked good resting on a surface at height ``z``."""
    crust = ctx.paint("bread", swatch, tile="plain")
    if kind == "loaf":
        b.blob((x, y, z + 0.04), 0.075, crust, scale=(1.5, 0.95, 0.65), subdivisions=1, wobble=0.04)
    elif kind == "round":
        b.blob((x, y, z + 0.04), 0.07, crust, scale=(1.0, 1.0, 0.7), subdivisions=1, wobble=0.05)
    elif kind == "croissant":
        pts = [(x - 0.06, y + 0.02, z + 0.02), (x - 0.03, y - 0.015, z + 0.035), (x + 0.03, y - 0.015, z + 0.035), (x + 0.06, y + 0.02, z + 0.02)]
        b.solid(solids.tube(pts, [0.014, 0.03, 0.03, 0.014], sides=6), crust, bevel=0.0, smooth=True)
    else:  # a little cake: sponge, icing and a cherry
        b.cylinder((x, y, z), 0.06, 0.06, ctx.paint("bread", 2, tile="plain"), sides=10, bevel=0.0)
        b.cylinder((x, y, z + 0.06), 0.062, 0.018, ctx.paint("food", 3, tile="plain"), sides=10, bevel=0.0)
        b.blob((x, y, z + 0.09), 0.015, ctx.paint("food", 0, tile="plain"), subdivisions=1, wobble=0.0)


def leafy(b, ctx, rng: VariantRng, base: Tuple[float, float, float], n: int, length: float, swatch: int = 0,
          spread: float = 1.0, width: float = 0.09) -> None:
    """A tuft of ``n`` arching leaves from ``base`` (potted plants, ferns)."""
    import math

    bx, by, bz = base
    paint = ctx.paint("foliage", swatch, tile="leaves")
    for i in range(n):
        a = 2 * math.pi * (i + rng.uniform(-0.15, 0.15)) / n
        rise = length * rng.uniform(0.55, 0.9)
        reach = length * spread * rng.uniform(0.45, 0.7)
        ca, sa = math.cos(a), math.sin(a)
        pts = [
            (bx, by, bz),
            (bx + ca * reach * 0.45, by + sa * reach * 0.45, bz + rise * 0.8),
            (bx + ca * reach, by + sa * reach, bz + rise),
            (bx + ca * reach * 1.25, by + sa * reach * 1.25, bz + rise * 0.8),
        ]
        widths = [width * 0.15, width, width * 0.8, width * 0.1]
        b.solid(solids.leaf(pts, widths, 0.012), paint, bevel=0.0, recalc_normals=True)
