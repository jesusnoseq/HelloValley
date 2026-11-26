"""Europe roofs and roof parts: roof.gable, roof.hip, roof.stepped_gable, dormer, chimney.

Roofs cover a 2 x 2 cell building and sit on the top storey (z = 0 is the wall top; the walls'
facades are the footprint edges). The slopes pass through the top outer edge of the walls, so
the eaves hang below z = 0 in front of them.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from hvkit.grid import Footprint
from hvkit.module import Module, Socket, register
from hvkit.variants import VariantRng

from .common import (
    EAVE_M,
    GABLE_OVERHANG_M,
    PROP_BUDGET,
    ROOF_D,
    ROOF_PITCH_DEG,
    ROOF_RISE,
    ROOF_T,
    ROOF_W,
    STYLES,
    WALL_T,
    pick,
)

TAN = math.tan(math.radians(ROOF_PITCH_DEG))
COS = math.cos(math.radians(ROOF_PITCH_DEG))
SIN = math.sin(math.radians(ROOF_PITCH_DEG))
SLAB_UP = ROOF_T / COS
"""Vertical thickness of a roof slab."""
RIDGE_Z = ROOF_RISE + SLAB_UP
HALF = ROOF_D / 2

# Front-slope surface height at depth y (0 <= y <= HALF); the back slope mirrors it.
def roof_surface_z(y: float) -> float:
    y = min(y, ROOF_D - y)
    return y * TAN + SLAB_UP


def roof_material(params) -> Tuple[str, int, str]:
    kind = params["roof"]
    if kind == "slate":
        return ("roofs", 2, "roof_slate")
    return ("roofs", 0 if kind == "clay" else 1, "roof_clay")


ROOF_KINDS = ("clay", "slate", "clay_warm")


def slope_profile(y_eave: float, y_ridge: float, up: float, front: bool = True) -> List[Tuple[float, float]]:
    """(y, z) outline of one slab of a gable roof whose underside passes through (0, 0) (front)
    or (ROOF_D, 0) (back) at the roof pitch."""
    def under(y):
        return (y if front else ROOF_D - y) * TAN

    return [(y_eave, under(y_eave)), (y_ridge, under(y_ridge)), (y_ridge, under(y_ridge) + up), (y_eave, under(y_eave) + up)]


class EuropeRoof(Module):
    footprint = Footprint(w=ROOF_W, d=ROOF_D, h=1.5)
    variants = 3
    styles = STYLES
    tri_budget = PROP_BUDGET
    max_overhang_m = 0.45
    sockets = (
        Socket("base", "stack", (ROOF_W / 2, ROOF_D / 2, 0.0), (0.0, 0.0, -1.0)),
        Socket("ridge", "prop", (ROOF_W / 2, HALF, RIDGE_Z), (0.0, 0.0, 1.0)),
        Socket("chimney", "prop", (1.45, 1.3, roof_surface_z(1.3)), (0.0, 0.0, 1.0)),
        Socket("dormer", "attach", (0.5, 0.15, roof_surface_z(0.15)), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return {"roof": pick(rng, ROOF_KINDS, variant)}

    def slabs(self, ctx, b, params, x0: float, x1: float, courses: int = 4) -> None:
        """Both slopes, a ridge cap and raised tile courses (for the hand-made tiled look)."""
        from hvkit import solids

        group, idx, tile = roof_material(params)
        paint = ctx.paint(group, idx, tile=tile)
        e = EAVE_M
        for front in (True, False):
            y_eave, y_ridge = (-e, HALF) if front else (ROOF_D + e, HALF)
            prof = slope_profile(y_eave, y_ridge, SLAB_UP, front)
            b.solid(solids.prism(prof, "x", x0, x1, slices=2), paint, bevel=0.02, segments=1)
            for c in range(1, courses + 1):
                f = c / (courses + 1)
                ya = y_eave + (y_ridge - y_eave) * f
                yb = ya + (y_ridge - y_eave) * 0.05
                course = slope_profile(ya, yb, SLAB_UP + 0.025, front)
                b.solid(solids.prism(course, "x", x0 + 0.02, x1 - 0.02), paint, bevel=0.0)
        cap = ctx.paint(group, idx, tile="plain")
        b.solid(
            solids.prism([(HALF - 0.12, RIDGE_Z - 0.1), (HALF + 0.12, RIDGE_Z - 0.1), (HALF + 0.07, RIDGE_Z + 0.05), (HALF - 0.07, RIDGE_Z + 0.05)], "x", x0 - 0.02, x1 + 0.02),
            cap,
            bevel=0.02,
            segments=1,
        )


@register
class RoofGable(EuropeRoof):
    """Steep gable roof, ridge along x, with plaster, timber or slate-hung gable ends."""

    id = "roof.gable"
    tags = ("roof", "europe")

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["gable"] = pick(rng, ("timber", "boards", "plaster"), variant)
        p["barge"] = pick(rng, (("trims", 1), ("trims", 0), ("trims", 2)), variant)
        p["oculus"] = variant != 1
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        go = GABLE_OVERHANG_M
        self.slabs(ctx, b, params, -go, ROOF_W + go)
        tri = solids.gable_profile(0.0, ROOF_D, 0.0, ROOF_RISE)
        gable = params["gable"]
        if gable == "boards":
            gpaint = ctx.paint("trims", 2, tile="wood")
        else:
            gpaint = ctx.paint("walls", 0 if gable == "timber" else rng.randint(1, 3), tile="plaster")
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            b.solid(solids.prism(tri, "x", xa, xb), gpaint, bevel=0.0)
        barge = ctx.paint(*params["barge"], tile="wood")
        for xa, xb in ((-go, -go + 0.05), (ROOF_W + go - 0.05, ROOF_W + go)):
            for front in (True, False):
                y_eave = -EAVE_M if front else ROOF_D + EAVE_M
                prof = slope_profile(y_eave, HALF, 0.14, front)
                prof = [(y, z - 0.12) for y, z in prof]
                b.solid(solids.prism(prof, "x", xa, xb), barge, bevel=0.012, segments=1)
        if gable == "timber":
            wood = ctx.paint("trims", 0, tile="timber")
            for xa, xb in ((-0.03, 0.02), (ROOF_W - 0.02, ROOF_W + 0.03)):
                b.box((xa, HALF - 0.05, 0.0), (xb, HALF + 0.05, ROOF_RISE - 0.05), wood, bevel=0.01, segments=1)
                b.box((xa, 0.42, 0.33), (xb, ROOF_D - 0.42, 0.42), wood, bevel=0.01, segments=1)
                for p0, p1 in (((0.25, 0.05), (HALF - 0.05, 0.42)), ((ROOF_D - 0.25, 0.05), (HALF + 0.05, 0.42))):
                    prof = solids.beam_profile(p0, p1, 0.07)
                    b.solid(solids.prism(prof, "x", xa, xb), wood, bevel=0.0)
        if params["oculus"]:
            frame = ctx.paint("trims", 1, tile="wood")
            glass = ctx.paint("glass", 0, tile="plain", material="glass")
            ring = [(HALF + 0.14 * math.cos(a), 0.78 + 0.14 * math.sin(a)) for a in (i * math.pi / 4 for i in range(8))]
            pane = [(HALF + 0.1 * math.cos(a), 0.78 + 0.1 * math.sin(a)) for a in (i * math.pi / 4 for i in range(8))]
            for xa, xb, xg in ((-0.03, 0.0, (0.0, 0.01)), (ROOF_W, ROOF_W + 0.03, (ROOF_W - 0.01, ROOF_W))):
                b.solid(solids.prism(ring, "x", xa, xb), frame, bevel=0.0)
                b.solid(solids.prism(pane, "x", xa - 0.005 if xa < 0 else xb - 0.025, xa + 0.025 if xa < 0 else xb + 0.005), glass, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


HIP_BASE_Z = -0.12
HIP_RISE = (ROOF_D / 2 + EAVE_M) * math.tan(math.radians(45.0))
"""The hip roof uses a 45 degree pitch: at 50 degrees a pyramid over 2 x 2 cells looks like a
spire."""


def hip_surface_z(x: float, y: float) -> float:
    """Height of the plain (pyramid) hip roof surface above (x, y)."""
    e = EAVE_M
    edge = min(x + e, ROOF_W + e - x, y + e, ROOF_D + e - y)
    half = ROOF_W / 2 + e
    return HIP_BASE_Z + edge / half * (HIP_RISE - HIP_BASE_Z)


@register
class RoofHip(EuropeRoof):
    """Hip roof (all four sides slope): a pyramid, a short-ridged pavilion or a bell-cast
    roof with a flared lower course."""

    id = "roof.hip"
    tags = ("roof", "europe")
    footprint = Footprint(w=ROOF_W, d=ROOF_D, h=1.8)
    sockets = (
        Socket("base", "stack", (ROOF_W / 2, ROOF_D / 2, 0.0), (0.0, 0.0, -1.0)),
        Socket("ridge", "prop", (ROOF_W / 2, HALF, HIP_RISE), (0.0, 0.0, 1.0)),
        Socket("chimney", "prop", (1.45, 1.3, hip_surface_z(1.45, 1.3)), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["shape"] = pick(rng, ("pyramid", "pavilion", "bellcast"), variant)
        p["finial"] = variant != 1
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        group, idx, tile = roof_material(params)
        paint = ctx.paint(group, idx, tile=tile)
        e = EAVE_M
        x0, x1, y0, y1 = -e, ROOF_W + e, -e, ROOF_D + e
        base_z = HIP_BASE_Z
        fascia = ctx.paint("trims", 1 if params["roof"] != "slate" else 0, tile="wood")
        b.box((x0 + 0.04, y0 + 0.04, base_z - 0.06), (x1 - 0.04, y1 - 0.04, base_z + 0.02), fascia, bevel=0.015, segments=1)
        rise = HIP_RISE
        shape = params["shape"]
        if shape == "bellcast":
            # A shallow flared skirt, then a steeper pyramid set back on it.
            b.solid(solids.hip_roof(x0, x1, y0, y1, base_z, 0.22, top_scale=0.7), paint, bevel=0.015, segments=1)
            inset = (x1 - x0) * 0.15
            b.solid(solids.hip_roof(x0 + inset, x1 - inset, y0 + inset, y1 - inset, 0.2, rise + 0.1), paint, bevel=0.015, segments=1)
        else:
            ridge = 0.5 if shape == "pavilion" else None
            # Three stacked bands with a small lip each: tile courses seen from afar.
            levels = [base_z, 0.3, 0.7, rise]
            half = (x1 - x0) / 2
            for k in range(3):
                za, zb = levels[k], levels[k + 1]
                inset_a = (za - base_z) / (rise - base_z) * half
                lip = 0.03 if k else 0.0
                ia = inset_a - lip
                if k < 2:
                    ib = (zb - base_z) / (rise - base_z) * half
                    scale = (half - ib) / (half - ia)
                    b.solid(solids.hip_roof(x0 + ia, x1 - ia, y0 + ia, y1 - ia, za, zb, top_scale=scale), paint, bevel=0.012, segments=1)
                else:
                    r = None if ridge is None else ridge * (half - ia) / half
                    b.solid(solids.hip_roof(x0 + ia, x1 - ia, y0 + ia, y1 - ia, za, zb, ridge=r), paint, bevel=0.012, segments=1)
        if params["finial"]:
            iron = ctx.paint("iron", 0, tile="plain")
            cx, cy = ROOF_W / 2, ROOF_D / 2
            b.cylinder((cx, cy, rise - 0.1), 0.025, 0.4, iron, sides=6, bevel=0.0)
            b.blob((cx, cy, rise + 0.25), 0.05, ctx.paint("accents", 2, tile="plain"), wobble=0.0)
        return [b.to_object(ctx.collection)]


def stepped_gable_blocks() -> List[Tuple[float, float, float, float]]:
    """(y_lo, y_hi, z_lo, z_hi) blocks of the crow-stepped gable wall. Pure, so a test can
    check that every step clears the roof surface."""
    from hvkit import solids

    return solids.stepped_gable_steps(0.0, ROOF_D, 0.0, STEPPED_TOP, STEPS)


STEPS = 3
STEPPED_TOP = ROOF_RISE + 1.15
"""Tall enough that every step stands clear of the roof slope (a test checks it)."""


@register
class RoofSteppedGable(EuropeRoof):
    """Gable roof between two crow-stepped gable walls (Hanseatic/Dutch), coping on every
    step."""

    id = "roof.stepped_gable"
    tags = ("roof", "europe")
    footprint = Footprint(w=ROOF_W, d=ROOF_D, h=STEPPED_TOP + 0.1)

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["gable"] = pick(rng, (("roofs", 0, "brick"), ("walls", 1, "plaster"), ("walls", 2, "plaster")), variant)
        p["anchors"] = variant != 2
        return p

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        self.slabs(ctx, b, params, WALL_T * 0.5, ROOF_W - WALL_T * 0.5, courses=3)
        group, idx, tile = params["gable"]
        wall = ctx.paint(group, idx, tile=tile)
        coping = ctx.paint("trims", 1, tile="stone")
        blocks = stepped_gable_blocks()
        run = blocks[1][0] - blocks[0][0] if len(blocks) > 1 else 0.0
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            for k, (ya, yb, za, zb) in enumerate(blocks):
                b.box((xa, ya, za), (xb, yb, zb), wall, bevel=0.015, segments=1, seams=("z-",) if k == 0 else ())
                top = k == len(blocks) - 1
                spans = [(ya, yb)] if top else [(ya, ya + run), (yb - run, yb)]
                for sa, sb in spans:
                    b.box((xa - 0.03, sa - 0.03, zb), (xb + 0.03, sb + 0.03, zb + 0.06), coping, bevel=0.0)
            if params["anchors"]:
                iron = ctx.paint("iron", 0, tile="plain")
                face = xa - 0.02 if xa == 0.0 else xb
                for y in (0.6, ROOF_D - 0.6):
                    b.box((face, y - 0.015, 0.55), (face + 0.02, y + 0.015, 0.85), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Dormer(Module):
    """Gabled dormer window for a roof slope. The front (window) is at y = 0 and faces -Y;
    its base is at the bottom of the front and the back is buried in the roof."""

    id = "dormer"
    footprint = Footprint(w=1, d=1, h=1.1)
    variants = 3
    styles = STYLES
    tri_budget = PROP_BUDGET
    max_overhang_m = 0.1
    tags = ("roof", "window", "europe")
    sockets = (
        Socket("mount", "attach", (0.5, 0.0, 0.0), (0.0, -1.0, 0.0)),
        Socket("window", "attach", (0.5, 0.0, 0.3), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "roof": pick(rng, ROOF_KINDS, variant),
            "cheeks": pick(rng, (("walls", 0, "plaster"), ("roofs", 2, "roof_slate"), ("trims", 2, "wood")), variant),
            "pattern": pick(rng, ("cross", "single", "t"), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, depth, h = 0.15, 0.85, 0.85, 0.55
        cheek = ctx.paint(*params["cheeks"][:2], tile=params["cheeks"][2])
        win = (0.3, 0.7, 0.1, 0.48)
        xs, zs = [x0, win[0], win[1], x1], [0.0, win[2], win[3], h]
        b.solid(solids.grid_panel(xs, zs, [(1, 1)], 0.0, 0.06), cheek, bevel=0.012, segments=1)
        for xa, xb in ((x0, x0 + 0.06), (x1 - 0.06, x1)):
            b.box((xa, 0.06, 0.0), (xb, depth, h), cheek, bevel=0.0)
        b.solid(solids.prism(solids.gable_profile(x0, x1, h, h + (x1 - x0) / 2), "y", 0.0, 0.06), cheek, bevel=0.0)
        group, idx, tile = roof_material(params)
        roof = ctx.paint(group, idx, tile=tile)
        mid, rise_t = 0.5, 0.08 / math.cos(math.radians(45.0))
        for sign in (-1.0, 1.0):
            ex = mid + sign * 0.42
            prof = [(ex, h + (0.35 - 0.42)), (mid, h + 0.35), (mid, h + 0.35 + rise_t), (ex, h - 0.07 + rise_t)]
            b.solid(solids.prism(prof, "y", -0.08, depth), roof, bevel=0.012, segments=1)
        frame = ctx.paint("trims", 1, tile="wood")
        wx0, wx1, wz0, wz1 = win
        b.box((wx0 - 0.04, -0.025, wz0 - 0.05), (wx1 + 0.04, 0.02, wz0), frame, bevel=0.01, segments=1)
        b.box((wx0 - 0.04, -0.02, wz0), (wx0, 0.02, wz1), frame, bevel=0.0)
        b.box((wx1, -0.02, wz0), (wx1 + 0.04, 0.02, wz1), frame, bevel=0.0)
        b.box((wx0 - 0.04, -0.02, wz1), (wx1 + 0.04, 0.02, wz1 + 0.04), frame, bevel=0.0)
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        b.box((wx0, 0.03, wz0), (wx1, 0.045, wz1), glass, bevel=0.0, noise=0.0)
        if params["pattern"] in ("cross", "t"):
            b.box(((wx0 + wx1) / 2 - 0.015, 0.01, wz0), ((wx0 + wx1) / 2 + 0.015, 0.03, wz1), frame, bevel=0.0)
        if params["pattern"] == "cross":
            zc = (wz0 + wz1) / 2
            b.box((wx0, 0.01, zc - 0.015), (wx1, 0.03, zc + 0.015), frame, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Chimney(Module):
    """Chimney stack for a roof; the base is buried in the roof, ``smoke`` is where the client
    emits smoke particles (TODO(backlog): not part of the M12 weather pass)."""

    id = "chimney"
    footprint = Footprint(w=1, d=1, h=2.0)
    variants = 3
    styles = STYLES
    tri_budget = PROP_BUDGET
    max_overhang_m = 0.0
    tags = ("roof", "europe")
    sockets = (
        Socket("base", "stack", (0.5, 0.5, 0.0), (0.0, 0.0, -1.0)),
        Socket("smoke", "prop", (0.5, 0.5, 1.75), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "body": pick(rng, (("roofs", 0, "brick"), ("walls", 0, "plaster"), ("ground", 1, "stone")), variant),
            "top": pick(rng, ("pots", "band", "hood"), variant),
            "height": round(rng.uniform(1.25, 1.45), 3),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        group, idx, tile = params["body"]
        body = ctx.paint(group, idx, tile=tile)
        h = params["height"]
        lo, hi = 0.3, 0.72
        b.box((lo, lo, 0.0), (hi, hi, h), body, bevel=0.03, segments=2)
        brick = ctx.paint("roofs", 0, tile="brick")
        cap = ctx.paint("trims", 1, tile="stone")
        if params["top"] == "band":
            b.box((lo - 0.03, lo - 0.03, h - 0.25), (hi + 0.03, hi + 0.03, h - 0.15), brick, bevel=0.015, segments=1)
        b.box((lo - 0.04, lo - 0.04, h), (hi + 0.04, hi + 0.04, h + 0.08), cap, bevel=0.02, segments=1)
        kind = params["top"]
        if kind == "pots":
            pot = ctx.paint("roofs", 1, tile="plain")
            for cx in (0.42, 0.6):
                b.cylinder((cx, 0.51, h + 0.08), 0.06, 0.22, pot, sides=8, radius_top=0.05, bevel=0.0)
        elif kind == "hood":
            b.box((lo + 0.02, lo + 0.02, h + 0.08), (lo + 0.07, lo + 0.07, h + 0.3), cap, bevel=0.0)
            b.box((hi - 0.07, hi - 0.07, h + 0.08), (hi - 0.02, hi - 0.02, h + 0.3), cap, bevel=0.0)
            b.box((lo + 0.02, hi - 0.07, h + 0.08), (lo + 0.07, hi - 0.02, h + 0.3), cap, bevel=0.0)
            b.box((hi - 0.07, lo + 0.02, h + 0.08), (hi - 0.02, lo + 0.07, h + 0.3), cap, bevel=0.0)
            prof = solids.gable_profile(lo - 0.06, hi + 0.06, h + 0.3, h + 0.48)
            b.solid(solids.prism(prof, "y", lo - 0.06, hi + 0.06), ctx.paint("roofs", 2, tile="roof_slate"), bevel=0.012, segments=1)
        return [b.to_object(ctx.collection)]

