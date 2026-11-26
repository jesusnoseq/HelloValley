"""Mediterranean roofs and roof parts: roof.gable, roof.hip, roof.stepped_gable (curved and
bell gables), dormer, chimney.

Low (25 degree) roofs covered in canal tiles: half-buried tubes running from the eave to the
ridge, with barrel ridge and hip tiles. Same 2 x 2 footprint and sockets as the European roofs,
so the M10 assembler scales and places them identically. The ``chimney`` and ``dormer``
sockets are the European ones (higher than this roof's surface); the chimney and dormer reach
below their pivots (``sink_m``) to meet the lower roof.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from hvkit.module import register
from hvkit.variants import VariantRng

from .common import (
    CHIMNEY_SINK_M,
    DORMER_SINK_M,
    EAVE_M,
    GABLE_OVERHANG_M,
    HALF,
    RIDGE_Z,
    ROOF_D,
    ROOF_RISE,
    ROOF_W,
    SLAB_UP,
    TAN,
    TILE_R,
    TILE_STEP,
    WALL_SWATCH_BY_VARIANT,
    WALL_T,
    MedModule,
    gable_clearance,
    mirror,
    pick,
)


def slope_profile(y_eave: float, y_ridge: float, up: float, front: bool = True) -> List[Tuple[float, float]]:
    """(y, z) outline of one roof slab whose underside passes through the wall top's outer
    edge at the roof pitch."""

    def under(y):
        return (y if front else ROOF_D - y) * TAN

    return [(y_eave, under(y_eave)), (y_ridge, under(y_ridge)), (y_ridge, under(y_ridge) + up), (y_eave, under(y_eave) + up)]


def tile_columns(x0: float, x1: float, step: float = TILE_STEP) -> List[float]:
    """Centre lines of the canal tile rows between ``x0`` and ``x1``."""
    n = max(1, int(round((x1 - x0) / step)))
    w = (x1 - x0) / n
    return [round(x0 + w * (i + 0.5), 6) for i in range(n)]


ROOF_KINDS = ("terracotta", "sunny", "faded")
"""Roof swatch per variant (``roofs`` 0, 1, 2)."""


class MedRoof(MedModule):
    max_overhang_m = 0.45

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return {"roof": variant % len(ROOF_KINDS), "tiles": round(rng.uniform(0.0, 1.0), 3)}

    def clay(self, ctx, params, tile: str = "roof_clay"):
        return ctx.paint("roofs", params["roof"], tile=tile)

    def canal_slabs(self, ctx, b, params, x0: float, x1: float) -> None:
        """Both slopes as slabs covered with canal tiles, plus the barrel ridge."""
        from hvkit import solids

        paint = self.clay(ctx, params)
        e = EAVE_M
        for front in (True, False):
            y_eave, y_ridge = (-e, HALF) if front else (ROOF_D + e, HALF)
            prof = slope_profile(y_eave, y_ridge, SLAB_UP, front)
            b.solid(solids.prism(prof, "x", x0, x1, slices=2), paint, bevel=0.015, segments=1)
            z_eave = (y_eave if front else ROOF_D - y_eave) * TAN + SLAB_UP
            z_top = RIDGE_Z
            for cx in tile_columns(x0 + 0.02, x1 - 0.02):
                spine = [(cx, y_eave + (0.01 if front else -0.01), z_eave), (cx, y_ridge, z_top)]
                b.solid(solids.tube(spine, [TILE_R, TILE_R * 0.9], sides=6), paint, bevel=0.0, smooth=True)
        cap = self.clay(ctx, params, tile="plain")
        b.solid(solids.tube([(x0 - 0.03, HALF, RIDGE_Z + 0.01), (x1 + 0.03, HALF, RIDGE_Z + 0.01)], [0.075, 0.075], sides=8), cap, bevel=0.0, smooth=True)


@register
@mirror
class RoofGable(MedRoof):
    """Low gable roof with canal tiles over stucco gable ends; tile corbels under the eaves, a
    round vent or a white eave band."""

    id = "roof.gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["eave"] = pick(rng, ("corbels", "plain", "white"), variant)
        p["vent"] = variant != 2
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        go = GABLE_OVERHANG_M
        self.canal_slabs(ctx, b, params, -go, ROOF_W + go)
        tri = solids.gable_profile(0.0, ROOF_D, 0.0, ROOF_RISE)
        stucco = ctx.paint("walls", WALL_SWATCH_BY_VARIANT[variant % 3], tile="stucco")
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            b.solid(solids.prism(tri, "x", xa, xb), stucco, bevel=0.0)
        # Verge: a white band under the tiles along both gable edges.
        white = ctx.paint("trims", 0, tile="stucco")
        for xa, xb in ((-go, -go + 0.06), (ROOF_W + go - 0.06, ROOF_W + go)):
            for front in (True, False):
                y_eave = -EAVE_M if front else ROOF_D + EAVE_M
                prof = [(y, z - 0.07) for y, z in slope_profile(y_eave, HALF, 0.08, front)]
                b.solid(solids.prism(prof, "x", xa, xb), white, bevel=0.0)
        eave = params["eave"]
        for front in (True, False):
            y = -EAVE_M + 0.02 if front else ROOF_D + EAVE_M - 0.02
            ya, yb = (y, 0.0) if front else (ROOF_D, y)
            if eave == "corbels":
                clay = self.clay(ctx, params, tile="plain")
                b.box((-go + 0.05, ya, -0.12), (ROOF_W + go - 0.05, yb, -0.04), clay, bevel=0.0)
                b.box((-go + 0.05, (ya + 0.06) if front else ya, -0.2), (ROOF_W + go - 0.05, yb, -0.12), white, bevel=0.0)
            elif eave == "white":
                b.box((-go + 0.05, ya, -0.1), (ROOF_W + go - 0.05, yb, 0.0), white, bevel=0.0)
        if params["vent"]:
            clay = self.clay(ctx, params, tile="plain")
            for xa, xb in ((-0.025, 0.0), (ROOF_W, ROOF_W + 0.025)):
                ring = [(HALF + 0.1 * math.cos(a), 0.22 + 0.1 * math.sin(a)) for a in (i * math.pi / 4 for i in range(8))]
                b.solid(solids.prism(ring, "x", xa, xb), clay, bevel=0.0)
        return [b.to_object(ctx.collection)]


HIP_BASE_Z = -0.1
HIP_RISE = (ROOF_D / 2 + EAVE_M) * TAN


def hip_rib_lengths(x0: float, x1: float, y0: float, y1: float, step: float = TILE_STEP) -> List[Tuple[float, float]]:
    """(x, run) of the canal tile rows on the front slope of a pyramid roof over the
    rectangle: each row runs up the slope until it meets a hip."""
    out = []
    for cx in tile_columns(x0 + 0.04, x1 - 0.04, step):
        run = min(cx - x0, x1 - cx, (y1 - y0) / 2) - 0.03
        if run > 0.05:
            out.append((cx, round(run, 6)))
    return out


@register
@mirror
class RoofHip(MedRoof):
    """Low pyramid roof with canal tiles, barrel hip tiles and a ceramic finial."""

    id = "roof.hip"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["finial"] = pick(rng, ("ball", "none", "pot"), variant)
        p["eave"] = pick(rng, ("white", "corbels", "plain"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        paint = self.clay(ctx, params)
        e = EAVE_M
        x0, x1, y0, y1 = -e, ROOF_W + e, -e, ROOF_D + e
        z0, z1 = HIP_BASE_Z, HIP_RISE
        b.solid(solids.hip_roof(x0, x1, y0, y1, z0, z1), paint, bevel=0.012, segments=1)
        half = (x1 - x0) / 2
        slope = (z1 - z0) / half
        cx, cy = ROOF_W / 2, ROOF_D / 2
        # Canal tile rows on all four slopes: the front rows turned about the roof centre.
        for turn in range(4):
            angle = turn * math.pi / 2
            ca, sa = math.cos(angle), math.sin(angle)

            def rot(x, y, z):
                dx, dy = x - cx, y - cy
                return (cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, z)

            for rx, run in hip_rib_lengths(x0, x1, y0, y1):
                a = rot(rx, y0 + 0.02, z0 + 0.02 * slope + 0.005)
                c = rot(rx, y0 + run, z0 + run * slope + 0.005)
                b.solid(solids.tube([a, c], [TILE_R, TILE_R * 0.85], sides=6), paint, bevel=0.0, smooth=True)
        cap = self.clay(ctx, params, tile="plain")
        for corner in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            b.solid(solids.tube([(corner[0] * 0.98 + cx * 0.02, corner[1] * 0.98 + cy * 0.02, z0 + 0.04), (cx, cy, z1 + 0.03)], [0.06, 0.06], sides=6), cap, bevel=0.0, smooth=True)
        white = ctx.paint("trims", 0, tile="stucco")
        if params["eave"] == "white":
            b.box((x0 + 0.06, y0 + 0.06, z0 - 0.1), (x1 - 0.06, y1 - 0.06, z0 + 0.01), white, bevel=0.015, segments=1)
        elif params["eave"] == "corbels":
            b.box((x0 + 0.08, y0 + 0.08, z0 - 0.08), (x1 - 0.08, y1 - 0.08, z0 + 0.01), cap, bevel=0.0)
            b.box((x0 + 0.14, y0 + 0.14, z0 - 0.16), (x1 - 0.14, y1 - 0.14, z0 - 0.08), white, bevel=0.0)
        finial = params["finial"]
        if finial == "ball":
            b.cylinder((cx, cy, z1 - 0.02), 0.06, 0.12, white, sides=8, radius_top=0.04, bevel=0.0)
            b.blob((cx, cy, z1 + 0.17), 0.08, ctx.paint("ceramic", 2, tile="plain"), subdivisions=1, wobble=0.0)
        elif finial == "pot":
            b.cylinder((cx, cy, z1 - 0.02), 0.09, 0.22, cap, sides=8, radius_top=0.05, bevel=0.0)
        return [b.to_object(ctx.collection)]


# --- stepped gable: the curved (Baroque) and bell gables --------------------------------


def _arc(cy: float, cz: float, r: float, a0: float, a1: float, n: int) -> List[Tuple[float, float]]:
    return [(round(cy + r * math.cos(a0 + (a1 - a0) * k / n), 6), round(cz + r * math.sin(a0 + (a1 - a0) * k / n), 6)) for k in range(n + 1)]


def scroll_gable_profile() -> List[Tuple[float, float]]:
    """(y, z) outline of the curved gable wall: concave shoulders rising to a round-topped
    crown, mirrored about the ridge. Pure, so a test checks it clears the roof."""
    left = [(0.0, 0.0), (0.0, 0.32), (0.22, 0.34), (0.4, 0.42), (0.53, 0.56), (0.6, 0.76), (0.62, 0.96), (0.7, 1.0)]
    crown = _arc(HALF, 1.0, 0.3, math.pi, 0.0, 6)[1:-1]
    right = [(ROOF_D - y, z) for y, z in reversed(left)]
    return left + crown + right


BELL_PIERS = (0.72, 1.28)
"""y range of the bell gable's raised centre (its piers carry the bell arch)."""
BELL_TOP = 0.95
BELL_CROWN = BELL_TOP + 0.4 + (BELL_PIERS[1] - BELL_PIERS[0] - 0.2) / 2 + 0.33
"""Top of the bell gable (finial included)."""


def bell_gable_profile() -> List[Tuple[float, float]]:
    """(y, z) outline of the bell gable (espadana) body: sloped shoulders and a raised flat
    centre that carries the bell arch."""
    y0, y1 = BELL_PIERS
    return [(0.0, 0.0), (ROOF_D, 0.0), (ROOF_D, 0.3), (y1 + 0.08, 0.3 + (ROOF_D - y1 - 0.08) * 0.62), (y1, BELL_TOP),
            (y0, BELL_TOP), (y0 - 0.08, 0.3 + (y0 - 0.08) * 0.62), (0.0, 0.3)]


PARAPET_STEPS = 2
PARAPET_TOP = RIDGE_Z + 0.55


def parapet_blocks() -> List[Tuple[float, float, float, float]]:
    """(y_lo, y_hi, z_lo, z_hi) blocks of the low stepped parapet gable."""
    from hvkit import solids

    return solids.stepped_gable_steps(0.0, ROOF_D, 0.0, PARAPET_TOP, PARAPET_STEPS)


@register
@mirror
class RoofSteppedGable(MedRoof):
    """The kit's showpiece gable (the semantic slot of the European crow-stepped gable): a low
    canal-tile roof between two curved Baroque gables, bell gables (espadanas) or low stepped
    parapets with white coping."""

    id = "roof.stepped_gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["gable"] = pick(rng, ("scroll", "bell", "parapet"), variant)
        p["wall"] = pick(rng, (0, 1, 2), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        self.canal_slabs(ctx, b, params, WALL_T * 0.5, ROOF_W - WALL_T * 0.5)
        wall = ctx.paint("walls", params["wall"], tile="stucco")
        white = ctx.paint("trims", 0, tile="stucco")
        gable = params["gable"]
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            if gable == "scroll":
                prof = scroll_gable_profile()
                b.solid(solids.prism(prof, "x", xa, xb), wall, bevel=0.0)
                trim = ctx.paint("trims", 2, tile="stone")
                for y, z in (prof[1], prof[-2]):
                    b.blob(((xa + xb) / 2, y + (0.05 if y < HALF else -0.05), z + 0.08), 0.07, trim, subdivisions=1, wobble=0.0)
                b.blob(((xa + xb) / 2, HALF, 1.36), 0.07, trim, subdivisions=1, wobble=0.0)
                b.box((xa - 0.02, HALF - 0.2, 0.72), (xb + 0.02, HALF + 0.2, 0.8), white, bevel=0.0)
            elif gable == "bell":
                b.solid(solids.prism(bell_gable_profile(), "x", xa, xb), wall, bevel=0.0)
                y0, y1 = BELL_PIERS
                b.box((xa - 0.02, y0 - 0.02, BELL_TOP), (xb + 0.02, y1 + 0.02, BELL_TOP + 0.05), white, bevel=0.0)
                ia, ib = y0 + 0.1, y1 - 0.1
                spring = BELL_TOP + 0.4
                r = (ib - ia) / 2
                top = spring + r
                for ya, yb in ((y0, ia), (ib, y1)):
                    b.box((xa, ya, BELL_TOP + 0.05), (xb, yb, top + 0.08), wall, bevel=0.0)
                for prof in solids.arch_spandrels(ia, ib, spring, r, 8):
                    b.solid(solids.prism(prof, "x", xa, xb), wall, bevel=0.0)
                b.box((xa, ia, top), (xb, ib, top + 0.08), wall, bevel=0.0)
                b.box((xa - 0.02, y0 - 0.02, top + 0.08), (xb + 0.02, y1 + 0.02, top + 0.13), white, bevel=0.0)
                b.blob(((xa + xb) / 2, HALF, top + 0.2), 0.06, white, subdivisions=1, wobble=0.0)
                bronze = ctx.paint("ceramic", 3, tile="plain")
                b.cylinder(((xa + xb) / 2, HALF, spring - 0.17), 0.1, 0.22, bronze, sides=8, radius_top=0.05, bevel=0.0)
            else:
                blocks = parapet_blocks()
                run = blocks[1][0] - blocks[0][0]
                for k, (ya, yb, za, zb) in enumerate(blocks):
                    b.box((xa, ya, za), (xb, yb, zb), wall, bevel=0.015, segments=1, seams=("z-",) if k == 0 else ())
                    top = k == len(blocks) - 1
                    spans = [(ya, yb)] if top else [(ya, ya + run), (yb - run, yb)]
                    for sa, sb in spans:
                        b.box((xa - 0.03, sa - 0.03, zb), (xb + 0.03, sb + 0.03, zb + 0.05), white, bevel=0.0)
                clay = self.clay(ctx, params, tile="plain")
                b.solid(solids.tube([((xa + xb) / 2, blocks[-1][0], blocks[-1][3] + 0.08), ((xa + xb) / 2, blocks[-1][1], blocks[-1][3] + 0.08)], [0.04, 0.04], sides=6), clay, bevel=0.0)
        return [b.to_object(ctx.collection)]


# --- roof parts --------------------------------------------------------------------------

DORMER_DROP = 0.6
"""How fast the dormer's own ridge falls towards the back (per metre), so it dies into the low
main roof behind it."""


@register
@mirror
class Dormer(MedModule):
    """A small arched roof window (lucarne) with its own little tiled gable. The European
    dormer socket is higher than this kit's roof surface, so the cheeks and front reach
    ``sink_m`` below the pivot into the attic."""

    id = "dormer"
    sink_m = DORMER_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "roof": variant % 3,
            "walls": WALL_SWATCH_BY_VARIANT[variant % 3],
            "frame": pick(rng, (("accents", 0), ("trims", 1), ("accents", 1)), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, depth, h = 0.2, 0.8, 0.85, 0.45
        z_lo = -self.sink_m
        stucco = ctx.paint("walls", params["walls"], tile="stucco")
        win = (0.36, 0.64, 0.02, 0.4)
        spring, rise = win[3] - 0.14, 0.14
        xs, zs = [x0, win[0], win[1], x1], [z_lo, win[2], win[3], h]
        b.solid(solids.grid_panel(xs, zs, [(1, 1)], 0.0, 0.06), stucco, bevel=0.012, segments=1)
        for prof in solids.arch_spandrels(win[0], win[1], spring, rise, 6):
            b.solid(solids.prism(prof, "y", 0.0, 0.06), stucco, bevel=0.0)
        b.solid(solids.prism(solids.gable_profile(x0, x1, h, h + 0.16), "y", 0.0, 0.06), stucco, bevel=0.0)
        drop = DORMER_DROP
        for xa, xb in ((x0, x0 + 0.06), (x1 - 0.06, x1)):
            cheek = [(0.06, z_lo), (depth, z_lo), (depth, h - depth * drop), (0.06, h - 0.06 * drop)]
            b.solid(solids.prism(cheek, "x", xa, xb), stucco, bevel=0.0)
        clay = ctx.paint("roofs", params["roof"], tile="roof_clay")
        mid = 0.5
        verts_all = []
        for sign in (-1.0, 1.0):
            ex = mid + sign * 0.38
            prof = [(ex, h - 0.06), (mid, h + 0.17), (mid, h + 0.25), (ex, h + 0.02)]
            verts, faces = solids.prism(prof, "y", -0.06, depth)
            sheared = [(x, y, z - drop * y) for x, y, z in verts]
            verts_all.append((sheared, faces))
        for solid in verts_all:
            b.solid(solid, clay, bevel=0.0)
        b.solid(solids.tube([(mid, -0.04, h + 0.25 + 0.04 * drop), (mid, depth, h + 0.25 - depth * drop)], [0.04, 0.04], sides=6), ctx.paint("roofs", params["roof"], tile="plain"), bevel=0.0)
        frame = ctx.paint(*params["frame"], tile="wood")
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        b.solid(solids.prism(solids.arched_profile(win[0], win[1], win[2], spring, rise, 6), "y", 0.03, 0.045), glass, bevel=0.0, noise=0.0)
        b.box((win[0] - 0.04, -0.03, win[2] - 0.04), (win[1] + 0.04, 0.02, win[2]), ctx.paint("trims", 0, tile="stucco"), bevel=0.0)
        b.box(((win[0] + win[1]) / 2 - 0.015, 0.01, win[2]), ((win[0] + win[1]) / 2 + 0.015, 0.03, win[3] - 0.01), frame, bevel=0.0)
        b.box((win[0], 0.01, spring - 0.015), (win[1], 0.03, spring + 0.015), frame, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Chimney(MedModule):
    """Whitewashed chimney stack with a tiled hood, a pierced lantern cap (Algarve-style) or
    clay pipe pots. The stack goes ``sink_m`` below the pivot to meet the low roof."""

    id = "chimney"
    sink_m = CHIMNEY_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "top": pick(rng, ("hood", "lantern", "pots"), variant),
            "height": round(rng.uniform(1.05, 1.25), 3),
            "body": pick(rng, (0, 3, 0), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        body = ctx.paint("walls", params["body"], tile="stucco")
        h = params["height"]
        lo, hi = 0.3, 0.7
        b.box((lo, lo, -self.sink_m), (hi, hi, h), body, bevel=0.03, segments=2)
        white = ctx.paint("trims", 0, tile="stucco")
        clay = ctx.paint("roofs", variant % 3, tile="roof_clay")
        b.box((lo - 0.04, lo - 0.04, h), (hi + 0.04, hi + 0.04, h + 0.06), white, bevel=0.015, segments=1)
        kind = params["top"]
        if kind == "hood":
            for x, y in ((lo, lo), (hi - 0.06, lo), (lo, hi - 0.06), (hi - 0.06, hi - 0.06)):
                b.box((x, y, h + 0.06), (x + 0.06, y + 0.06, h + 0.3), white, bevel=0.0)
            prof = solids.gable_profile(lo - 0.08, hi + 0.08, h + 0.3, h + 0.48)
            b.solid(solids.prism(prof, "y", lo - 0.08, hi + 0.08), clay, bevel=0.012, segments=1)
        elif kind == "lantern":
            b.box((lo + 0.02, lo + 0.02, h + 0.06), (hi - 0.02, hi - 0.02, h + 0.36), white, bevel=0.02, segments=1)
            dark = ctx.paint("iron", 0, tile="plain")
            for face_y in (lo + 0.015, hi - 0.025):
                for k in range(3):
                    x = lo + 0.08 + k * 0.1
                    b.box((x, face_y, h + 0.14), (x + 0.04, face_y + 0.01, h + 0.28), dark, bevel=0.0, noise=0.0)
            b.solid(solids.hip_roof(lo - 0.02, hi + 0.02, lo - 0.02, hi + 0.02, h + 0.36, h + 0.5), white, bevel=0.0)
            b.blob((0.5, 0.5, h + 0.55), 0.05, white, subdivisions=1, wobble=0.0)
        else:
            for cx in (0.42, 0.58):
                b.cylinder((cx, 0.5, h + 0.06), 0.06, 0.24, clay, sides=8, radius_top=0.05, bevel=0.0)
        return [b.to_object(ctx.collection)]


def gable_profiles() -> Dict[str, Sequence[Tuple[float, float]]]:
    """Every curved or raised gable outline, for the clearance test."""
    return {"scroll": scroll_gable_profile(), "bell": bell_gable_profile()}


__all__ = ["gable_clearance", "gable_profiles", "hip_rib_lengths", "tile_columns"]
