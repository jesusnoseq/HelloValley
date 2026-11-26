"""Arabic roofs and roof parts: roof.gable (flat roof behind a crenellated parapet), roof.hip
(a dome on a drum, a green glazed tile pyramid or a small onion dome), roof.stepped_gable (the
showpiece: a raised gate crest, a great dome with corner kiosks, or a corner minaret), dormer
(a rooftop kiosk) and chimney (a wind catcher, a domed stack or clay pots).

Same 2 x 2 footprint and sockets as the European roofs, so the M10 assembler scales and places
them identically. The ``chimney`` and ``dormer`` sockets are the European ones, which float above
a flat deck; the chimney and dormer reach below their pivots (``sink_m``) down to it.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from hvkit.module import register
from hvkit.variants import VariantRng

from .common import (
    CHIMNEY_SINK_M,
    DECK_Z,
    DORMER_SINK_M,
    HALF,
    HORSESHOE_DEG,
    MERLON_H,
    PARAPET_T,
    PARAPET_Z,
    ROOF_D,
    ROOF_W,
    WALL_SWATCH_BY_VARIANT,
    ArabModule,
    lattice,
    merlon_positions,
    mirror,
    pick,
)

MERLONS = ("stepped", "round", "saw")
SPOUT_M = 0.25
"""How far the waterspouts (mizab) stick out past the parapet."""
GREAT_DOME_R = 0.42
DOME_R = 0.36
"""The roof.hip dome: kept clear of the chimney socket at the recipes' roof scales (a test
checks it)."""
TILE_ROOF = (-0.12, 0.0, 0.75)
"""Eave overhang, base and apex height of the green tile pyramid."""


def dome(b, paint, cx: float, cy: float, z: float, r: float, rise: float, onion: float = 0.0, sides: int = 12, rings: int = 5) -> float:
    """A dome of revolution standing on ``z``; returns the crown height."""
    from hvkit import solids

    pts = solids.dome_rings(r, rise, rings, onion)
    b.solid(solids.tube([(cx, cy, z + dz) for dz, _ in pts], [rad for _, rad in pts], sides=sides), paint, bevel=0.0, smooth=True)
    return z + rise


def finial(b, paint, cx: float, cy: float, z: float, balls: int = 3, scale: float = 1.0) -> None:
    """A brass jamour: a rod with stacked balls of shrinking size."""
    b.cylinder((cx, cy, z), 0.012 * scale, (0.08 + 0.07 * balls) * scale, paint, sides=5, bevel=0.0)
    zz = z + 0.06 * scale
    for k in range(balls):
        r = (0.045 - 0.01 * k) * scale
        b.blob((cx, cy, zz + r), r, paint, subdivisions=1, wobble=0.0)
        zz += 2 * r + 0.012 * scale


def merlon(b, paint, kind: str, axis: str, u0: float, u1: float, w0: float, w1: float, z: float, h: float) -> None:
    """One merlon on a parapet top at ``z``: ``u`` runs along the parapet, ``w`` across it
    (``axis`` is the direction of ``w``: "y" for parapets along x, "x" for parapets along y)."""
    from hvkit import solids

    def box(ua, ub, za, zb, inset=0.0):
        if axis == "y":
            b.box((ua, w0 + inset, za), (ub, w1 - inset, zb), paint, bevel=0.0)
        else:
            b.box((w0 + inset, ua, za), (w1 - inset, ub, zb), paint, bevel=0.0)

    if kind == "stepped":
        third = (u1 - u0) / 4
        box(u0, u1, z, z + h * 0.55)
        box(u0 + third, u1 - third, z + h * 0.55, z + h, inset=0.01)
        return
    mid = (u0 + u1) / 2
    if kind == "round":
        r = (u1 - u0) / 2
        prof = [(u0, z), (u1, z), (u1, z + h - r)] + [(mid + r * math.cos(a), z + h - r + r * math.sin(a)) for a in (math.pi * k / 4 for k in range(1, 4))] + [(u0, z + h - r)]
    else:
        prof = [(u0, z), (u1, z), (mid, z + h)]
    if axis == "y":
        b.solid(solids.prism(prof, "y", w0, w1), paint, bevel=0.0)
    else:
        b.solid(solids.prism(prof, "x", w0, w1), paint, bevel=0.0)


class ArabRoof(ArabModule):
    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return {"wall": WALL_SWATCH_BY_VARIANT[variant % 3], "jars": rng.randint(2, 3)}

    def parapet(self, ctx, b, params, kind: str, z_top: float = PARAPET_Z, h: float = MERLON_H, band: bool = False, spouts: bool = True) -> None:
        """The flat deck, a parapet around the 2 x 2 roof flush with the facades, merlons of
        ``kind`` on top, a cornice line at its foot and optional zellige band and spouts."""
        t = PARAPET_T
        wall = ctx.paint("walls", params["wall"], tile="stucco")
        white = ctx.paint("trims", 0, tile="stucco")
        b.box((t, t, -0.02), (ROOF_W - t, ROOF_D - t, DECK_Z), ctx.paint("roofs", 0, tile="stucco"), bevel=0.0)
        b.box((-0.03, -0.03, -0.02), (ROOF_W + 0.03, ROOF_D + 0.03, 0.05), white, bevel=0.012, segments=1)
        for lo, hi in (((0.0, 0.0), (ROOF_W, t)), ((0.0, ROOF_D - t), (ROOF_W, ROOF_D)), ((0.0, t), (t, ROOF_D - t)), ((ROOF_W - t, t), (ROOF_W, ROOF_D - t))):
            b.box((lo[0], lo[1], 0.05), (hi[0], hi[1], z_top), wall, bevel=0.0)
        coping = ctx.paint("trims", 0, tile="stucco")
        if band:
            tile = ctx.paint("zellige", 1, tile="zellige")
            za, zb = z_top * 0.45, z_top * 0.75
            for lo, hi in (((-0.012, -0.012), (ROOF_W + 0.012, 0.0)), ((-0.012, ROOF_D), (ROOF_W + 0.012, ROOF_D + 0.012)), ((-0.012, 0.0), (0.0, ROOF_D)), ((ROOF_W, 0.0), (ROOF_W + 0.012, ROOF_D))):
                b.box((lo[0], lo[1], za), (hi[0], hi[1], zb), tile, bevel=0.0, noise=0.0)
        for y0, y1 in ((0.0, t), (ROOF_D - t, ROOF_D)):
            for u0, u1 in merlon_positions(0.0, ROOF_W):
                merlon(b, coping if kind == "round" else wall, kind, "y", u0, u1, y0, y1, z_top, h)
        for x0, x1 in ((0.0, t), (ROOF_W - t, ROOF_W)):
            for u0, u1 in merlon_positions(0.0, ROOF_D)[1:-1]:
                merlon(b, coping if kind == "round" else wall, kind, "x", u0, u1, x0, x1, z_top, h)
        if spouts:
            clay = ctx.paint("trims", 1, tile="timber")
            for x, ya, yb in ((0.5, -SPOUT_M, t), (1.5, ROOF_D - t, ROOF_D + SPOUT_M)):
                b.box((x - 0.04, ya, DECK_Z), (x + 0.04, yb, DECK_Z + 0.07), clay, bevel=0.0)

    def jars(self, ctx, b, params, spots: Sequence[Tuple[float, float]]) -> None:
        clay = ctx.paint("roofs", 2, tile="plain")
        for i, (x, y) in enumerate(spots[: params["jars"]]):
            b.cylinder((x, y, DECK_Z), 0.05, 0.08, clay, sides=7, radius_top=0.09, bevel=0.0)
            b.cylinder((x, y, DECK_Z + 0.08), 0.09, 0.1, clay, sides=7, radius_top=0.04, bevel=0.0)


@register
@mirror
class RoofGable(ArabRoof):
    """Flat roof behind a parapet with stepped, rounded or saw-tooth merlons, a zellige band
    on one variant, clay jars on the deck and waterspouts."""

    id = "roof.gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["merlon"] = pick(rng, MERLONS, variant)
        p["band"] = variant == 1
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        b = ctx.builder(self, variant, rng)
        self.parapet(ctx, b, params, params["merlon"], band=params["band"])
        self.jars(ctx, b, params, ((0.35, 1.55), (0.55, 1.7), (0.3, 1.25)))
        return [b.to_object(ctx.collection)]


@register
@mirror
class RoofHip(ArabRoof):
    """A white dome on an octagonal drum, a green glazed tile pyramid over a carved cedar
    frieze, or a small turquoise onion dome, each crowned by a brass finial."""

    id = "roof.hip"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["shape"] = pick(rng, ("dome", "tiles", "onion"), variant)
        p["dome"] = pick(rng, (0, 1, 1), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        brass = ctx.paint("brass", 0, tile="plain")
        shape = params["shape"]
        cx, cy = ROOF_W / 2, ROOF_D / 2
        if shape == "tiles":
            e, z0, z1 = TILE_ROOF
            wood = ctx.paint("trims", 1, tile="timber")
            b.box((-0.04, -0.04, -0.16), (ROOF_W + 0.04, ROOF_D + 0.04, 0.0), wood, bevel=0.01, segments=1)
            for i in range(8):
                u = 0.125 + i * 0.25
                for x, y in ((u, -0.04), (u, ROOF_D + 0.04), (-0.04, u), (ROOF_W + 0.04, u)):
                    b.box((x - 0.03, y - 0.03, -0.12), (x + 0.03, y + 0.03, -0.04), ctx.paint("trims", 2, tile="stone"), bevel=0.0)
            green = ctx.paint("roofs", 1, tile="roof_tile")
            b.solid(solids.hip_roof(e, ROOF_W - e, e, ROOF_D - e, z0, z1), green, bevel=0.012, segments=1)
            cap = ctx.paint("roofs", 1, tile="plain")
            for corner in ((e, e), (ROOF_W - e, e), (ROOF_W - e, ROOF_D - e), (e, ROOF_D - e)):
                b.solid(solids.tube([(corner[0], corner[1], z0 + 0.02), (cx, cy, z1 + 0.02)], [0.04, 0.04], sides=5), cap, bevel=0.0)
            finial(b, brass, cx, cy, z1)
            return [b.to_object(ctx.collection)]
        self.parapet(ctx, b, params, "stepped" if shape == "dome" else "round", band=shape == "onion")
        stone = ctx.paint("walls", params["wall"], tile="stucco")
        if shape == "dome":
            drum = 0.18
            b.cylinder((cx, cy, DECK_Z), DOME_R + 0.02, drum, stone, sides=8, bevel=0.0)
            for k in range(8):
                a = math.pi / 8 + 2 * math.pi * k / 8
                px, py = cx + (DOME_R + 0.015) * math.cos(a), cy + (DOME_R + 0.015) * math.sin(a)
                b.box((px - 0.03, py - 0.03, DECK_Z + 0.05), (px + 0.03, py + 0.03, DECK_Z + 0.14), ctx.paint("trims", 1, tile="plain"), bevel=0.0, noise=0.0)
            b.cylinder((cx, cy, DECK_Z + drum), DOME_R + 0.04, 0.03, ctx.paint("trims", 0, tile="stucco"), sides=8, bevel=0.0)
            top = dome(b, ctx.paint("dome", params["dome"], tile="stucco"), cx, cy, DECK_Z + drum + 0.03, DOME_R, 0.34)
            finial(b, brass, cx, cy, top - 0.01)
        else:
            b.box((cx - 0.3, cy - 0.3, DECK_Z), (cx + 0.3, cy + 0.3, DECK_Z + 0.16), stone, bevel=0.015, segments=1)
            b.cylinder((cx, cy, DECK_Z + 0.16), 0.27, 0.1, ctx.paint("zellige", 2, tile="zellige"), sides=8, bevel=0.0)
            top = dome(b, ctx.paint("dome", 1, tile="stucco"), cx, cy, DECK_Z + 0.26, 0.26, 0.42, onion=0.35)
            finial(b, brass, cx, cy, top - 0.02, balls=2)
        return [b.to_object(ctx.collection)]


GATE_X = (0.6, 1.4)
GATE_TOP = 0.62
"""The raised central crest of the gate variant."""
MINARET = (1.5, 1.92, 1.5, 1.92)
MINARET_TOP = 1.45
KIOSK = 0.22
LOW_PARAPET_Z = 0.22
"""The town hall roof is scaled x3 vertically; its parapet is lower."""


@register
@mirror
class RoofSteppedGable(ArabRoof):
    """The kit's showpiece roof (the semantic slot of the European crow-stepped gable): a flat
    roof with a raised, tiled gate crest front and back, a great dome with four corner kiosks,
    or a square corner minaret with a gallery and a small dome."""

    id = "roof.stepped_gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["kind"] = pick(rng, ("gate", "domes", "minaret"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        kind = params["kind"]
        brass = ctx.paint("brass", 0, tile="plain")
        wall = ctx.paint("walls", params["wall"], tile="stucco")
        white = ctx.paint("trims", 0, tile="stucco")
        t = PARAPET_T
        if kind == "gate":
            self.parapet(ctx, b, params, "stepped", z_top=LOW_PARAPET_Z, h=0.1, spouts=False)
            x0, x1 = GATE_X
            for y0, y1 in ((0.0, t), (ROOF_D - t, ROOF_D)):
                b.box((x0, y0, LOW_PARAPET_Z), (x1, y1, GATE_TOP), wall, bevel=0.0)
                ya, yb = (y0 - 0.012, y0) if y0 == 0.0 else (y1, y1 + 0.012)
                b.box((x0 + 0.06, ya, LOW_PARAPET_Z + 0.06), (x1 - 0.06, yb, GATE_TOP - 0.08), ctx.paint("zellige", 1, tile="zellige"), bevel=0.0, noise=0.0)
                for u0, u1 in merlon_positions(x0, x1, 0.2, 0.1):
                    merlon(b, wall, "stepped", "y", u0, u1, y0, y1, GATE_TOP, 0.12)
            return [b.to_object(ctx.collection)]
        if kind == "domes":
            self.parapet(ctx, b, params, "round", z_top=LOW_PARAPET_Z, h=0.1, spouts=False)
            cx, cy = ROOF_W / 2, ROOF_D / 2
            b.cylinder((cx, cy, DECK_Z), GREAT_DOME_R + 0.03, 0.14, wall, sides=8, bevel=0.0)
            b.cylinder((cx, cy, DECK_Z + 0.14), GREAT_DOME_R + 0.05, 0.03, white, sides=8, bevel=0.0)
            top = dome(b, ctx.paint("dome", 2 if variant == 1 else 0, tile="stucco"), cx, cy, DECK_Z + 0.17, GREAT_DOME_R, 0.3, sides=14, rings=6)
            finial(b, brass, cx, cy, top - 0.01)
            for x, y in ((t, t), (ROOF_W - t - KIOSK, t), (t, ROOF_D - t - KIOSK), (ROOF_W - t - KIOSK, ROOF_D - t - KIOSK)):
                b.box((x, y, DECK_Z), (x + KIOSK, y + KIOSK, 0.34), wall, bevel=0.012, segments=1)
                b.box((x - 0.015, y - 0.015, 0.34), (x + KIOSK + 0.015, y + KIOSK + 0.015, 0.37), white, bevel=0.0)
                dome(b, ctx.paint("dome", 1, tile="stucco"), x + KIOSK / 2, y + KIOSK / 2, 0.37, KIOSK * 0.45, 0.12, sides=8, rings=3)
            return [b.to_object(ctx.collection)]
        # Minaret: a square shaft at the back-right corner, a zellige band, a balcony gallery
        # on corbels, a lantern storey and a small dome.
        self.parapet(ctx, b, params, "saw", z_top=LOW_PARAPET_Z, h=0.1, spouts=False)
        x0, x1, y0, y1 = MINARET
        b.box((x0, y0, DECK_Z), (x1, y1, 1.0), wall, bevel=0.015, segments=1)
        tile = ctx.paint("zellige", 1, tile="zellige")
        b.box((x0 - 0.01, y0 - 0.01, 0.75), (x1 + 0.01, y1 + 0.01, 0.93), tile, bevel=0.0, noise=0.0)
        dark = ctx.paint("trims", 1, tile="plain")
        # Two dark slit windows on the faces seen from the square.
        b.box((x0 + 0.15, y0 - 0.012, 0.45), (x1 - 0.15, y0, 0.62), dark, bevel=0.0, noise=0.0)
        b.box((x0 - 0.012, y0 + 0.15, 0.45), (x0, y1 - 0.15, 0.62), dark, bevel=0.0, noise=0.0)
        b.box((x0 - 0.05, y0 - 0.05, 1.0), (x1 + 0.05, y1 + 0.05, 1.05), white, bevel=0.0)
        for u0, u1 in merlon_positions(x0 - 0.05, x1 + 0.05, 0.12, 0.06):
            for yy0, yy1 in ((y0 - 0.05, y0 - 0.02), (y1 + 0.02, y1 + 0.05)):
                merlon(b, white, "saw", "y", u0, u1, yy0, yy1, 1.05, 0.06)
        b.box((x0 + 0.08, y0 + 0.08, 1.05), (x1 - 0.08, y1 - 0.08, 1.28), wall, bevel=0.012, segments=1)
        b.box((x0 + 0.06, y0 + 0.06, 1.28), (x1 - 0.06, y1 - 0.06, 1.31), white, bevel=0.0)
        top = dome(b, ctx.paint("dome", 1, tile="stucco"), (x0 + x1) / 2, (y0 + y1) / 2, 1.31, 0.12, 0.13, onion=0.3, sides=8, rings=4)
        finial(b, brass, (x0 + x1) / 2, (y0 + y1) / 2, top - 0.02, balls=2, scale=0.7)
        return [b.to_object(ctx.collection)]


# --- roof parts --------------------------------------------------------------------------


@register
@mirror
class Dormer(ArabModule):
    """A small rooftop kiosk with a horseshoe window: a flat top with merlons, a little dome,
    or a mashrabiya-screened window under a green tile cap. The European dormer socket floats
    above this kit's flat deck, so the kiosk reaches ``sink_m`` below its pivot."""

    id = "dormer"
    sink_m = DORMER_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "top": pick(rng, ("merlons", "dome", "screen"), variant),
            "walls": WALL_SWATCH_BY_VARIANT[variant % 3],
            "frame": pick(rng, (("trims", 1), ("accents", 0), ("trims", 1)), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, depth, h = 0.2, 0.8, 0.7, 0.55
        z_lo = -self.sink_m
        stucco = ctx.paint("walls", params["walls"], tile="stucco")
        white = ctx.paint("trims", 0, tile="stucco")
        win = (0.36, 0.64, 0.05, 0.45)
        xs, zs = [x0, win[0], win[1], x1], [z_lo, win[2], win[3], h]
        b.solid(solids.grid_panel(xs, zs, [(1, 1)], 0.0, 0.06), stucco, bevel=0.012, segments=1)
        for prof in solids.horseshoe_fillers(*win, HORSESHOE_DEG, 6, 1):
            b.solid(solids.prism(prof, "y", 0.0, 0.06), stucco, bevel=0.0)
        b.box((x0, 0.06, z_lo), (x1, depth, h), stucco, bevel=0.012, segments=1)
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        b.solid(solids.prism(solids.horseshoe_profile(*win, HORSESHOE_DEG, 6, 1), "y", 0.035, 0.05), glass, bevel=0.0, noise=0.0)
        b.box((win[0] - 0.04, -0.04, win[2] - 0.04), (win[1] + 0.04, 0.02, win[2]), white, bevel=0.0)
        b.box((x0 - 0.03, -0.03, h), (x1 + 0.03, depth + 0.03, h + 0.04), white, bevel=0.01, segments=1)
        top = params["top"]
        if top == "merlons":
            wall = stucco
            for u0, u1 in merlon_positions(x0 - 0.03, x1 + 0.03, 0.2, 0.1):
                merlon(b, wall, "stepped", "y", u0, u1, -0.03, 0.06, h + 0.04, 0.12)
        elif top == "dome":
            d = dome(b, ctx.paint("dome", 0, tile="stucco"), 0.5, depth / 2, h + 0.04, 0.24, 0.22, sides=10, rings=4)
            finial(b, ctx.paint("brass", 0, tile="plain"), 0.5, depth / 2, d - 0.01, balls=1, scale=0.7)
        else:
            wood = ctx.paint(*params["frame"], tile="timber")
            lattice(b, win[0] - 0.02, win[1] + 0.02, win[2], win[3] + 0.02, -0.04, -0.025, wood, 4, 5)
            b.box((win[0] - 0.04, -0.045, win[2] - 0.02), (win[1] + 0.04, -0.02, win[2] + 0.02), wood, bevel=0.0)
            b.box((win[0] - 0.04, -0.045, win[3]), (win[1] + 0.04, -0.02, win[3] + 0.04), wood, bevel=0.0)
            green = ctx.paint("roofs", 1, tile="roof_tile")
            b.solid(solids.hip_roof(x0 - 0.06, x1 + 0.06, -0.06, depth + 0.06, h + 0.04, h + 0.3), green, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Chimney(ArabModule):
    """A wind catcher (badgir) with slotted openings and merlons, a plaster stack with a
    pierced domed cap, or a stack with clay pipe pots. The stack goes ``sink_m`` below the
    pivot to meet the flat deck."""

    id = "chimney"
    sink_m = CHIMNEY_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "top": pick(rng, ("windcatcher", "domed", "pots"), variant),
            "height": round(rng.uniform(1.15, 1.3), 3),
            "body": pick(rng, (0, 1, 2), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint("walls", params["body"], tile="stucco")
        white = ctx.paint("trims", 0, tile="stucco")
        kind = params["top"]
        h = params["height"]
        if kind == "windcatcher":
            lo, hi = 0.28, 0.72
            slot = 1.05
            b.box((lo, lo, -self.sink_m), (hi, hi, slot), body, bevel=0.03, segments=2)
            dark = ctx.paint("trims", 1, tile="plain")
            b.box((lo + 0.04, lo + 0.04, slot), (hi - 0.04, hi - 0.04, 1.42), dark, bevel=0.0, noise=0.0)
            post = 0.06
            for x in (lo, (lo + hi) / 2 - post / 2, hi - post):
                for y in (lo, hi - post):
                    b.box((x, y, slot), (x + post, y + post, 1.42), body, bevel=0.0)
            for y in ((lo + hi) / 2 - post / 2,):
                for x in (lo, hi - post):
                    b.box((x, y, slot), (x + post, y + post, 1.42), body, bevel=0.0)
            b.box((lo - 0.03, lo - 0.03, 1.42), (hi + 0.03, hi + 0.03, 1.48), white, bevel=0.01, segments=1)
            for x in (lo - 0.03, hi - 0.07):
                for y in (lo - 0.03, hi - 0.07):
                    merlon(b, white, "stepped", "y", x, x + 0.1, y, y + 0.1, 1.48, 0.14)
            return [b.to_object(ctx.collection)]
        lo, hi = 0.32, 0.68
        b.box((lo, lo, -self.sink_m), (hi, hi, h), body, bevel=0.03, segments=2)
        b.box((lo - 0.04, lo - 0.04, h), (hi + 0.04, hi + 0.04, h + 0.06), white, bevel=0.015, segments=1)
        if kind == "domed":
            dark = ctx.paint("trims", 1, tile="plain")
            for k in range(4):
                a = math.pi / 2 * k
                px, py = 0.5 + 0.17 * math.cos(a), 0.5 + 0.17 * math.sin(a)
                b.box((px - 0.03, py - 0.03, h + 0.09), (px + 0.03, py + 0.03, h + 0.18), dark, bevel=0.0, noise=0.0)
            b.cylinder((0.5, 0.5, h + 0.06), 0.16, 0.14, body, sides=8, bevel=0.0)
            top = dome(b, ctx.paint("dome", 1, tile="stucco"), 0.5, 0.5, h + 0.2, 0.17, 0.16, sides=8, rings=3)
            finial(b, ctx.paint("brass", 0, tile="plain"), 0.5, 0.5, top - 0.01, balls=1, scale=0.6)
        else:
            clay = ctx.paint("roofs", 2, tile="plain")
            for cx in (0.42, 0.58):
                b.cylinder((cx, 0.5, h + 0.06), 0.06, 0.24, clay, sides=8, radius_top=0.05, bevel=0.0)
        return [b.to_object(ctx.collection)]


def dome_clear_of(x: float, y: float, half: float, sx: float, sy: float, r: float = DOME_R + 0.04) -> bool:
    """True when a ``half``-wide square (unscaled metres, centred at roof-local socket ``(x, y)``
    scaled by ``(sx, sy)``) stays outside the roof.hip dome drum scaled the same way."""
    cx, cy = ROOF_W / 2 * sx, ROOF_D / 2 * sy
    px, py = x * sx, y * sy
    nx = max(abs(px - cx) - half, 0.0) / (r * sx)
    ny = max(abs(py - cy) - half, 0.0) / (r * sy)
    return math.hypot(nx, ny) > 1.0


__all__ = ["dome", "dome_clear_of", "finial", "merlon", "HALF"]
