"""Japanese roofs and roof parts: roof.gable (kirizuma), roof.hip (irimoya, yosemune, hogyo),
roof.stepped_gable (the showpiece: a gable with a great barge board and shachihoko, a two-tier
roof, a gable with chidori gables on the slopes), dormer, chimney.

Grey kawara tiles: the slab follows the concave curve of :func:`common.roof_under` (steeper at
the ridge, flatter at the deep eave) and carries rows of round tiles from the eave to the ridge;
a heavy tiled ridge ends in onigawara blocks. Hipped roofs turn their eave corners up. Same 2 x 2
footprint and sockets as the European roofs, so the M10 assembler scales and places them
identically. The ``chimney`` and ``dormer`` sockets are the European ones (higher than this
roof's surface); the chimney and dormer reach below their pivots (``sink_m``).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from hvkit.module import register
from hvkit.variants import VariantRng

from .common import (
    CHIMNEY_SINK_M,
    CORNER_LIFT,
    DORMER_SINK_M,
    EAVE_M,
    GABLE_OVERHANG_M,
    HALF,
    RIDGE_Z,
    ROOF_D,
    ROOF_W,
    SLAB_UP,
    TILE_UP,
    WALL_SWATCH_BY_VARIANT,
    WALL_T,
    JapModule,
    mirror,
    pick,
    roof_under,
    slope_points,
)

Vec3 = Tuple[float, float, float]

TILE_R = 0.04
TILE_STEP = 0.2
SLOPE_SEGMENTS = 4


def tile_columns(x0: float, x1: float, step: float = TILE_STEP) -> List[float]:
    """Centre lines of the round tile rows between ``x0`` and ``x1``."""
    n = max(1, int(round((x1 - x0) / step)))
    w = (x1 - x0) / n
    return [round(x0 + w * (i + 0.5), 6) for i in range(n)]


def slab_profile(u0: float, u1: float, front: bool, up: float = SLAB_UP, drop: float = 0.0, n: int = SLOPE_SEGMENTS, dz: float = 0.0) -> List[Tuple[float, float]]:
    """(y, z) outline of one curved slab from ``u0`` (eave side) to ``u1`` (ridge side): the
    underside follows ``roof_under`` and the top stands ``up`` above it."""
    us = slope_points(u0, u1, n)

    def y_of(u):
        return u if front else ROOF_D - u

    bottom = [(y_of(u), roof_under(u) - drop + dz) for u in us]
    top = [(y_of(u), roof_under(u) + up + dz) for u in reversed(us)]
    return bottom + top


def gable_wall_profile(n: int = 6) -> List[Tuple[float, float]]:
    """(y, z) outline of the gable-end wall under the curved slopes."""
    pts = [(0.0, 0.0)]
    for k in range(1, n):
        y = ROOF_D * k / n
        pts.append((y, roof_under(min(y, ROOF_D - y))))
    pts.append((ROOF_D, 0.0))
    return pts


def hip_ring(u: float, k: float, lift: float, z_off: float = SLAB_UP) -> List[Vec3]:
    """One ring of a hipped roof: the 8 points (corners and edge middles, counter-clockwise from
    above) of the rectangle ``u`` inside the walls along y and ``k * u`` along x, at the slab
    height for ``u``; the corners are raised by ``lift``."""
    x0, x1, y0, y1 = k * u, ROOF_W - k * u, u, ROOF_D - u
    mx, my = ROOF_W / 2, ROOF_D / 2
    z = roof_under(u) + z_off
    pts = [(x0, y0, z + lift), (mx, y0, z), (x1, y0, z + lift), (x1, my, z), (x1, y1, z + lift), (mx, y1, z), (x0, y1, z + lift), (x0, my, z)]
    return [(round(a, 6), round(b, 6), round(c, 6)) for a, b, c in pts]


def curved_hip(us: Sequence[float], k: float = 1.0, lift: float = CORNER_LIFT, top_cap: bool = True):
    """A closed solid hipped roof through the rings at ``us`` (ascending, the first one at the
    eave). ``k`` < 1 insets the ends more slowly than the sides, which leaves a ridge along x
    at ``u = HALF``. The eave corners turn up by ``lift`` (fading out by ``u = 0.3``)."""
    from hvkit import solids

    def lift_at(u: float) -> float:
        return lift * max(0.0, min(1.0, (0.3 - u) / (0.3 - us[0]))) if us[0] < 0.3 else 0.0

    rings = [hip_ring(u, k, lift_at(u)) for u in us]
    eave = rings[0]
    under = [(x, y, round(z - SLAB_UP, 6)) for x, y, z in eave]
    verts: List[Vec3] = [p for ring in rings for p in ring] + under
    faces: List[List[int]] = []
    for r in range(len(rings) - 1):
        a, b = r * 8, (r + 1) * 8
        for j in range(8):
            jn = (j + 1) % 8
            faces.append([a + j, a + jn, b + jn, b + j])
    last = (len(rings) - 1) * 8
    if top_cap and us[-1] < HALF - 1e-6:
        # (At the ridge the top ring has collapsed onto a line or a point: nothing to cap.)
        faces.append([last + j for j in range(8)])
    u0 = len(rings) * 8
    for j in range(8):
        jn = (j + 1) % 8
        faces.append([u0 + j, u0 + jn, jn, j])
    faces.append([u0 + j for j in reversed(range(8))])
    return solids._weld(verts, faces, eps=1e-6)


ROOF_KINDS = ("grey", "dark", "silver")
"""Tile swatch per variant (``roofs`` 0, 1, 2)."""


class JapRoof(JapModule):
    max_overhang_m = 0.45

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return {"roof": variant % len(ROOF_KINDS), "tiles": round(rng.uniform(0.0, 1.0), 3)}

    def kawara(self, ctx, params, tile: str = "kawara"):
        return ctx.paint("roofs", params["roof"], tile=tile)

    def gable_slopes(self, ctx, b, params, x0: float, x1: float, u0: float = -EAVE_M, rows: bool = True, dz: float = 0.0, step: float = TILE_STEP, sides: int = 5) -> None:
        """Both curved slopes from ``u0`` to the ridge between ``x0`` and ``x1``, with round tile
        rows, raised by ``dz``."""
        from hvkit import solids

        paint = self.kawara(ctx, params)
        for front in (True, False):
            b.solid(solids.prism(slab_profile(u0, HALF, front, dz=dz), "x", x0, x1, slices=2), paint, bevel=0.0)
            if not rows:
                continue
            us = slope_points(u0 + 0.02, HALF - 0.04, 3)
            for cx in tile_columns(x0 + 0.03, x1 - 0.03, step):
                spine = [(cx, u if front else ROOF_D - u, roof_under(u) + SLAB_UP + TILE_UP * 0.4 + dz) for u in us]
                b.solid(solids.tube(spine, [TILE_R] * len(spine), sides=sides), paint, bevel=0.0)
        # Eave edge: a row of round end tiles (nokigawara) read as one thick lip.
        lip = ctx.paint("roofs", params["roof"], tile="plain")
        for front in (True, False):
            u = u0
            y = u if front else ROOF_D - u
            ya, yb = (y - 0.03, y + 0.06) if front else (y - 0.06, y + 0.03)
            b.box((x0, ya, roof_under(u) - 0.02 + dz), (x1, yb, roof_under(u) + SLAB_UP + TILE_UP + dz), lip, bevel=0.0)

    def ridge(self, ctx, b, params, x0: float, x1: float, z: float = RIDGE_Z, y: float = HALF, oni: bool = True, height: float = 0.16) -> float:
        """The tiled ridge (munegawara) from ``x0`` to ``x1`` with onigawara blocks at both ends;
        returns the top of the ridge."""
        from hvkit import solids

        dark = ctx.paint("roofs", params["roof"], tile="kawara")
        cap = ctx.paint("roofs", params["roof"], tile="plain")
        b.box((x0, y - 0.1, z - 0.08), (x1, y + 0.1, z + height * 0.55), dark, bevel=0.0)
        b.box((x0 + 0.02, y - 0.075, z + height * 0.55), (x1 - 0.02, y + 0.075, z + height), dark, bevel=0.0)
        b.solid(solids.tube([(x0 - 0.02, y, z + height), (x1 + 0.02, y, z + height)], [0.06, 0.06], sides=6), cap, bevel=0.0)
        top = z + height + 0.06
        if oni:
            for xa, xb, out in ((x0 - 0.08, x0 + 0.06, -1), (x1 - 0.06, x1 + 0.08, 1)):
                prof = [(y - 0.14, z - 0.1), (y + 0.14, z - 0.1), (y + 0.15, top + 0.06), (y + 0.06, top + 0.14), (y - 0.06, top + 0.14), (y - 0.15, top + 0.06)]
                b.solid(solids.prism(prof, "x", xa, xb), cap, bevel=0.0)
        return top

    def barge_boards(self, ctx, b, params, x: float, width: float = 0.05, drop: float = 0.1) -> None:
        """Barge boards (hafu) under both slopes' edges at ``x``, with a hanging ornament (gegyo)
        under the ridge."""
        from hvkit import solids

        wood = ctx.paint("trims", 0, tile="timber")
        for front in (True, False):
            prof = slab_profile(-EAVE_M, HALF, front, up=SLAB_UP + 0.02, drop=drop)
            b.solid(solids.prism(prof, "x", x, x + width), wood, bevel=0.0)
        gegyo = [(HALF - 0.12, RIDGE_Z - 0.05), (HALF + 0.12, RIDGE_Z - 0.05), (HALF + 0.07, RIDGE_Z - 0.3), (HALF, RIDGE_Z - 0.36), (HALF - 0.07, RIDGE_Z - 0.3)]
        b.solid(solids.prism(gegyo, "x", x - 0.015, x + width + 0.015), ctx.paint("trims", 2, tile="timber"), bevel=0.0)

    def gable_end(self, ctx, b, xa: float, xb: float, variant: int, kind: str) -> None:
        """The gable-end wall (tsuma): white plaster framed in dark wood, vertical boards, or
        a fox lattice (kitsune-goshi)."""
        from hvkit import solids

        prof = gable_wall_profile()
        plaster = ctx.paint("walls", WALL_SWATCH_BY_VARIANT[variant % 3], tile="shikkui")
        dark = ctx.paint("trims", 0, tile="timber")
        outer = xa if xa < ROOF_W / 2 else xb
        face = (outer - 0.02, outer) if outer < ROOF_W / 2 else (outer, outer + 0.02)
        if kind == "boards":
            b.solid(solids.prism(prof, "x", xa, xb), dark, bevel=0.0)
            for y in (0.4, 0.7, 1.0, 1.3, 1.6):
                z_top = roof_under(min(y, ROOF_D - y)) - 0.02
                if z_top > 0.05:
                    b.box((face[0], y - 0.015, 0.0), (face[1], y + 0.015, z_top), ctx.paint("trims", 1, tile="timber"), bevel=0.0, noise=0.0)
            return
        b.solid(solids.prism(prof, "x", xa, xb), plaster, bevel=0.0)
        top = roof_under(HALF) - 0.03
        b.box((face[0], 0.05, 0.0), (face[1], ROOF_D - 0.05, 0.06), dark, bevel=0.0, noise=0.0)
        b.box((face[0], HALF - 0.03, 0.0), (face[1], HALF + 0.03, top), dark, bevel=0.0, noise=0.0)
        if kind == "lattice":
            z0 = 0.22
            for y in (0.55, 0.75, 1.25, 1.45):
                zt = roof_under(min(y, ROOF_D - y)) - 0.02
                if zt > z0:
                    b.box((face[0], y - 0.012, z0), (face[1], y + 0.012, zt), dark, bevel=0.0, noise=0.0)
            b.box((face[0], 0.35, z0 - 0.03), (face[1], ROOF_D - 0.35, z0), dark, bevel=0.0, noise=0.0)
        else:
            b.box((face[0], 0.3, 0.22), (face[1], ROOF_D - 0.3, 0.27), dark, bevel=0.0, noise=0.0)


@register
@mirror
class RoofGable(JapRoof):
    """Kirizuma: a gable roof with curved kawara slopes, a tiled ridge with onigawara ends, dark
    barge boards with a gegyo ornament, and plaster, board or lattice gable ends."""

    id = "roof.gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["gable"] = pick(rng, ("plaster", "boards", "lattice"), variant)
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        b = ctx.builder(self, variant, rng)
        go = GABLE_OVERHANG_M
        self.gable_slopes(ctx, b, params, -go, ROOF_W + go)
        self.ridge(ctx, b, params, -go + 0.02, ROOF_W + go - 0.02)
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            self.gable_end(ctx, b, xa, xb, variant, params["gable"])
        for x in (-go - 0.01, ROOF_W + go - 0.04):
            self.barge_boards(ctx, b, params, x)
        return [b.to_object(ctx.collection)]


HIP_US = (-EAVE_M, -0.15, 0.15, 0.5, HALF)
"""Rings of the hipped roofs (eave to top)."""
HIP_TILE_STEP = 0.26
"""Tile rows are sparser on hipped roofs (four faces share the triangle budget)."""
IRIMOYA_U = 0.55
"""Where the irimoya's hipped skirt ends and its small gable roof begins."""


def hip_tile_rows(k: float, u_top: float, step: float = HIP_TILE_STEP) -> List[Tuple[str, float, float]]:
    """(face, lateral position, last u) of the tile rows on a hipped roof: each row runs up
    its face from the eave until it meets a hip (or ``u_top``)."""
    rows = []
    for cx in tile_columns(-EAVE_M * k + 0.08, ROOF_W + EAVE_M * k - 0.08, step):
        reach = min(min(cx, ROOF_W - cx) / k, u_top) - 0.05
        if reach > -EAVE_M + 0.1:
            rows.append(("front", cx, round(reach, 6)))
    for cy in tile_columns(-EAVE_M + 0.08, ROOF_D + EAVE_M - 0.08, step):
        reach = min(min(cy, ROOF_D - cy), u_top) - 0.05
        if reach > -EAVE_M + 0.1:
            rows.append(("side", cy, round(reach, 6)))
    return rows


class JapHipped(JapRoof):
    def hipped(self, ctx, b, params, k: float, u_top: float, ridge: bool, rows: bool = True) -> float:
        """The hipped body up to ``u_top`` with tile rows on its four faces and hip ridges;
        returns the height of the top ring."""
        from hvkit import solids

        paint = self.kawara(ctx, params)
        us = [u for u in HIP_US if u < u_top - 1e-6] + [u_top]
        b.solid(curved_hip(us, k), paint, bevel=0.0, recalc_normals=True)
        cx, cy = ROOF_W / 2, ROOF_D / 2
        for face, s, reach in hip_tile_rows(k, u_top) if rows else ():
            pts = slope_points(-EAVE_M + 0.04, reach, 2)
            for mirror_side in (False, True):
                spine = []
                for u in pts:
                    z = roof_under(u) + SLAB_UP + TILE_UP * 0.4
                    if face == "front":
                        y = u if not mirror_side else ROOF_D - u
                        spine.append((s, y, z))
                    else:
                        x = k * u if not mirror_side else ROOF_W - k * u
                        spine.append((x, s, z))
                b.solid(solids.tube(spine, [TILE_R] * len(spine), sides=4), paint, bevel=0.0)
        cap = ctx.paint("roofs", params["roof"], tile="plain")
        for sx in (-1, 1):
            for sy in (-1, 1):
                spine = []
                for u in [u for u in HIP_US if u <= u_top + 1e-6]:
                    lift = CORNER_LIFT * max(0.0, (0.3 - u) / (0.3 + EAVE_M))
                    x = cx + sx * (cx - k * u)
                    y = cy + sy * (cy - u)
                    spine.append((x, y, roof_under(u) + SLAB_UP + lift + 0.04))
                b.solid(solids.tube(spine, [0.06] * len(spine), sides=5), cap, bevel=0.0)
        top = roof_under(u_top) + SLAB_UP
        if ridge and k < 1.0:
            self.ridge(ctx, b, params, k * HALF, ROOF_W - k * HALF, z=top, oni=True, height=0.12)
        return top

    def irimoya_gable(self, ctx, b, params, variant: int, x0: float, x1: float, u0: float = IRIMOYA_U - 0.12, rows: bool = True) -> float:
        """The small gable roof on top of an irimoya skirt: curved slopes from ``u0`` (a step
        above the skirt), plaster gable faces with dark battens set in from its ends, a ridge.
        Returns the top of the ridge."""
        from hvkit import solids

        self.gable_slopes(ctx, b, params, x0, x1, u0=u0, rows=rows, dz=IRIMOYA_STEP, step=0.24, sides=4)
        us = slope_points(IRIMOYA_U, HALF, 3)
        prof = [(u, roof_under(u)) for u in us] + [(ROOF_D - u, roof_under(u)) for u in reversed(us[:-1])]
        plaster = ctx.paint("walls", WALL_SWATCH_BY_VARIANT[variant % 3], tile="shikkui")
        dark = ctx.paint("trims", 0, tile="timber")
        for x in (x0 + 0.12, x1 - 0.16):
            b.solid(solids.prism(prof, "x", x, x + 0.04), plaster, bevel=0.0)
            xa, xb = (x - 0.012, x) if x < ROOF_W / 2 else (x + 0.04, x + 0.052)
            for y in (0.8, HALF, 1.2):
                zt = roof_under(min(y, ROOF_D - y)) - 0.02
                b.box((xa, y - 0.01, roof_under(IRIMOYA_U) + 0.01), (xb, y + 0.01, zt), dark, bevel=0.0, noise=0.0)
        return self.ridge(ctx, b, params, x0 + 0.02, x1 - 0.02, z=RIDGE_Z + IRIMOYA_STEP)


@register
@mirror
class RoofHip(JapHipped):
    """Hipped roofs with upturned eave corners: an irimoya (hip skirt under a small gable roof),
    a yosemune (a hipped roof with a short ridge) or a hogyo pyramid with a jewel finial."""

    id = "roof.hip"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["form"] = pick(rng, ("irimoya", "yosemune", "hogyo"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        form = params["form"]
        if form == "irimoya":
            self.hipped(ctx, b, params, 1.0, IRIMOYA_U, ridge=False)
            self.irimoya_gable(ctx, b, params, variant, IRIMOYA_U - 0.25, ROOF_W - IRIMOYA_U + 0.25)
        elif form == "yosemune":
            self.hipped(ctx, b, params, 0.6, HALF, ridge=True)
        else:
            top = self.hipped(ctx, b, params, 1.0, HALF, ridge=False)
            bronze = ctx.paint("roofs", 3, tile="plain")
            cx, cy = ROOF_W / 2, ROOF_D / 2
            b.cylinder((cx, cy, top - 0.05), 0.12, 0.12, bronze, sides=8, radius_top=0.08, bevel=0.0)
            b.cylinder((cx, cy, top + 0.07), 0.05, 0.1, bronze, sides=8, bevel=0.0)
            b.blob((cx, cy, top + 0.24), 0.09, bronze, scale=(1.0, 1.0, 1.15), subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


# --- the showpiece roof ------------------------------------------------------------------

IRIMOYA_STEP = 0.04
"""How far the irimoya's upper gable roof stands above the skirt it overlaps."""
SKIRT_U = 0.3
"""Where the two-tier roof's lower skirt (mokoshi) ends."""
DRUM_H = 0.42
"""Height of the plaster storey between the two-tier roof's skirts."""
UPPER_SCALE = 0.62
"""Size of the two-tier roof's upper irimoya relative to the whole roof."""


def shachihoko(ctx, b, x: float, y: float, z: float, facing: float) -> None:
    """A gilded shachihoko (a tiger-fish ridge ornament) standing on ``z`` at a ridge end;
    ``facing`` is +1 or -1 along x."""
    from hvkit import solids

    gold = ctx.paint("accents", 3, tile="plain")
    body = [(x, y, z), (x + facing * 0.05, y, z + 0.12), (x - facing * 0.02, y, z + 0.22), (x - facing * 0.1, y, z + 0.3)]
    b.solid(solids.tube(body, [0.055, 0.06, 0.045, 0.02], sides=5), gold, bevel=0.0)
    b.solid(solids.leaf([(x - facing * 0.08, y, z + 0.28), (x - facing * 0.16, y, z + 0.36)], [0.12, 0.02], thickness=0.02), gold, bevel=0.0, recalc_normals=True)


@register
@mirror
class RoofSteppedGable(JapHipped):
    """The kit's showpiece roof (the semantic slot of the European crow-stepped gable): a tall
    kirizuma with a great barge board, gegyo and gilded shachihoko; a two-tier roof (a hipped
    skirt, a short plaster storey and an irimoya on top, like a castle keep; the town hall); or
    a kirizuma with small chidori gables on both slopes."""

    id = "roof.stepped_gable"

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p["form"] = pick(rng, ("great_gable", "two_tier", "chidori"), variant)
        p["roof"] = pick(rng, (1, 0, 2), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        form = params["form"]
        go = GABLE_OVERHANG_M
        if form == "two_tier":
            paint = self.kawara(ctx, params)
            us = [u for u in HIP_US if u < SKIRT_U] + [SKIRT_U]
            b.solid(curved_hip(us, 1.0), paint, bevel=0.0, recalc_normals=True)
            cap = ctx.paint("roofs", params["roof"], tile="plain")
            for face, s, reach in hip_tile_rows(1.0, SKIRT_U):
                pts = slope_points(-EAVE_M + 0.04, reach, 2)
                for flip in (False, True):
                    spine = []
                    for u in pts:
                        z = roof_under(u) + SLAB_UP + TILE_UP * 0.4
                        spine.append((s, u if not flip else ROOF_D - u, z) if face == "front" else (u if not flip else ROOF_W - u, s, z))
                    b.solid(solids.tube(spine, [TILE_R] * len(spine), sides=4), paint, bevel=0.0)
            z0 = roof_under(SKIRT_U)
            plaster = ctx.paint("walls", 0, tile="shikkui")
            dark = ctx.paint("trims", 0, tile="timber")
            lo, hi = SKIRT_U - 0.05, ROOF_W - SKIRT_U + 0.05
            b.box((lo, lo, z0), (hi, hi, z0 + DRUM_H), plaster, bevel=0.0)
            for x, y in ((lo, lo), (hi, lo), (lo, hi), (hi, hi)):
                b.box((x - 0.04, y - 0.04, z0), (x + 0.04, y + 0.04, z0 + DRUM_H), dark, bevel=0.0)
            b.box((lo - 0.03, lo - 0.03, z0 + DRUM_H - 0.07), (hi + 0.03, hi + 0.03, z0 + DRUM_H), dark, bevel=0.0)
            for i in range(3):
                x = lo + (hi - lo) * (i + 0.5) / 3
                for y in (lo - 0.012, hi):
                    b.box((x - 0.12, y, z0 + 0.12), (x + 0.12, y + 0.012, z0 + 0.3), ctx.paint("glass", 0, tile="plain", material="glass"), bevel=0.0, noise=0.0)
                    b.box((x - 0.005, y - 0.01, z0 + 0.12), (x + 0.005, y + 0.022, z0 + 0.3), dark, bevel=0.0, noise=0.0)
            # The upper irimoya: a smaller copy of the hipped skirt and gable, shrunk about the
            # centre and lifted so its underside meets the top of the drum.
            s = UPPER_SCALE
            u_edge = HALF - (HALF - lo) / s
            lift = z0 + DRUM_H - s * roof_under(u_edge)
            upper = ctx.builder(self, variant, rng, "upper")
            self.hipped(ctx, upper, params, 1.0, IRIMOYA_U, ridge=False, rows=False)
            x0, x1 = IRIMOYA_U - 0.25, ROOF_W - IRIMOYA_U + 0.25
            top = self.irimoya_gable(ctx, upper, params, variant, x0, x1, rows=False)
            for x, facing in ((x0 + 0.04, -1.0), (x1 - 0.04, 1.0)):
                shachihoko(ctx, upper, x, HALF, top - 0.04, facing)
            obj = upper.to_object(ctx.collection)
            from mathutils import Matrix, Vector

            centre = Vector((ROOF_W / 2, ROOF_D / 2, 0.0))
            m = Matrix.Translation(centre + Vector((0.0, 0.0, lift))) @ Matrix.Diagonal((s, s, s, 1.0)) @ Matrix.Translation(-centre)
            obj.data.transform(m)
            base = b.to_object(ctx.collection)
            return [base, obj]
        self.gable_slopes(ctx, b, params, -go, ROOF_W + go)
        top = self.ridge(ctx, b, params, -go + 0.02, ROOF_W + go - 0.02, height=0.22)
        for xa, xb in ((0.0, WALL_T), (ROOF_W - WALL_T, ROOF_W)):
            self.gable_end(ctx, b, xa, xb, variant, "lattice" if form == "great_gable" else "plaster")
        for x in (-go - 0.01, ROOF_W + go - 0.04):
            self.barge_boards(ctx, b, params, x, width=0.06, drop=0.14)
        for x, facing in ((-go + 0.05, -1.0), (ROOF_W + go - 0.05, 1.0)):
            shachihoko(ctx, b, x, HALF, top - 0.04, facing)
        if form == "chidori":
            # A small triangular gable on each slope, its ridge running down the slope.
            paint = self.kawara(ctx, params)
            plaster = ctx.paint("walls", 0, tile="shikkui")
            dark = ctx.paint("trims", 0, tile="timber")
            for front in (True, False):
                ya, yb = (-EAVE_M + 0.12, 0.75) if front else (ROOF_D - 0.75, ROOF_D + EAVE_M - 0.12)
                face_y = ya if front else yb
                base_z = roof_under(-EAVE_M + 0.12) + SLAB_UP
                peak = base_z + 0.42
                tri = [(0.55, base_z), (1.45, base_z), (1.0, peak)]
                b.solid(solids.prism(tri, "y", ya, yb), plaster, bevel=0.0)
                for sx in (-1.0, 1.0):
                    roof_prof = [(1.0, peak + 0.02), (1.0 + sx * 0.6, base_z - 0.08), (1.0 + sx * 0.6, base_z - 0.0), (1.0, peak + 0.12)]
                    b.solid(solids.prism(roof_prof, "y", ya - 0.12 if front else ya, yb if front else yb + 0.12), paint, bevel=0.0)
                fy = (face_y - 0.13, face_y - 0.1) if front else (face_y + 0.1, face_y + 0.13)
                gegyo = [(0.92, peak - 0.02), (1.08, peak - 0.02), (1.0, peak - 0.2)]
                b.solid(solids.prism(gegyo, "y", fy[0], fy[1]), ctx.paint("trims", 2, tile="timber"), bevel=0.0)
                b.box((0.62, ya if front else yb - 0.02, base_z + 0.05), (1.38, ya + 0.02 if front else yb, base_z + 0.09), dark, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


# --- roof parts --------------------------------------------------------------------------

DORMER_DROP = 0.55
"""How fast the dormer's ridge falls towards the back (per metre), so it dies into the main
roof behind it."""


@register
@mirror
class Dormer(JapModule):
    """A small gabled roof window with a shoji pane and its own kawara roof. The European dormer
    socket is higher than this kit's roof surface, so the front and cheeks reach ``sink_m``
    below the pivot into the attic."""

    id = "dormer"
    sink_m = DORMER_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "roof": variant % 3,
            "walls": WALL_SWATCH_BY_VARIANT[variant % 3],
            "window": pick(rng, ("shoji", "lattice", "round"), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, depth, h = 0.22, 0.78, 0.85, 0.42
        z_lo = -self.sink_m
        plaster = ctx.paint("walls", params["walls"], tile="shikkui")
        dark = ctx.paint("trims", 0, tile="timber")
        win = (0.36, 0.64, 0.04, 0.34)
        xs, zs = [x0, win[0], win[1], x1], [z_lo, win[2], win[3], h]
        b.solid(solids.grid_panel(xs, zs, [(1, 1)], 0.0, 0.06), plaster, bevel=0.0)
        b.solid(solids.prism(solids.gable_profile(x0, x1, h, h + 0.15), "y", 0.0, 0.06), plaster, bevel=0.0)
        for xa, xb in ((x0, x0 + 0.05), (x1 - 0.05, x1)):
            b.box((xa, -0.02, z_lo), (xb, 0.06, h), dark, bevel=0.0)
            cheek = [(0.06, z_lo), (depth, z_lo), (depth, h - depth * DORMER_DROP), (0.06, h - 0.06 * DORMER_DROP)]
            b.solid(solids.prism(cheek, "x", xa, xb), plaster, bevel=0.0)
        b.box((x0, -0.025, h - 0.05), (x1, 0.06, h), dark, bevel=0.0)
        kawara = ctx.paint("roofs", params["roof"], tile="kawara")
        mid = 0.5
        for sign in (-1.0, 1.0):
            ex = mid + sign * 0.42
            prof = [(ex, h - 0.08), (mid, h + 0.17), (mid, h + 0.25), (ex, h + 0.0)]
            verts, faces = solids.prism(prof, "y", -0.08, depth)
            b.solid(([(x, y, z - DORMER_DROP * max(0.0, y)) for x, y, z in verts], faces), kawara, bevel=0.0)
        b.solid(solids.tube([(mid, -0.07, h + 0.27), (mid, depth, h + 0.25 - depth * DORMER_DROP)], [0.045, 0.045], sides=6), ctx.paint("roofs", params["roof"], tile="plain"), bevel=0.0)
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        light = ctx.paint("trims", 2, tile="timber")
        if params["window"] == "round":
            cx, cz, r = 0.5, (win[2] + win[3]) / 2, 0.13
            disc = [(cx + r * math.cos(a), cz + r * math.sin(a)) for a in (i * math.pi / 5 for i in range(10))]
            b.box((win[0], 0.03, win[2]), (win[1], 0.06, win[3]), plaster, bevel=0.0)
            b.solid(solids.prism(disc, "y", 0.02, 0.03), glass, bevel=0.0, noise=0.0)
        else:
            b.box((win[0], 0.035, win[2]), (win[1], 0.045, win[3]), glass, bevel=0.0, noise=0.0)
            n = 3 if params["window"] == "shoji" else 5
            for i in range(1, n):
                x = win[0] + (win[1] - win[0]) * i / n
                b.box((x - 0.006, 0.02, win[2]), (x + 0.006, 0.035, win[3]), light if n == 3 else dark, bevel=0.0, noise=0.0)
            if n == 3:
                b.box((win[0], 0.02, (win[2] + win[3]) / 2 - 0.006), (win[1], 0.035, (win[2] + win[3]) / 2 + 0.006), light, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Chimney(JapModule):
    """A roofed smoke vent (kemuridashi): a louvred box under a little kawara gable, a clay pipe
    under a hat, or a copper-hooded vent. It reaches ``sink_m`` below the pivot to meet the roof."""

    id = "chimney"
    sink_m = CHIMNEY_SINK_M

    def variant_params(self, style, variant, rng):
        return {
            "top": pick(rng, ("yagura", "pipe", "copper"), variant),
            "height": round(rng.uniform(0.7, 0.85), 3),
            "body": pick(rng, (0, 1, 2), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        h = params["height"]
        kind = params["top"]
        dark = ctx.paint("trims", 0, tile="timber")
        kawara = ctx.paint("roofs", variant % 3, tile="kawara")
        if kind == "pipe":
            clay = ctx.paint("roofs", 2, tile="plain")
            b.cylinder((0.5, 0.5, -self.sink_m), 0.12, self.sink_m + h, clay, sides=8, bevel=0.0)
            b.cylinder((0.5, 0.5, h), 0.14, 0.05, clay, sides=8, bevel=0.0)
            for i in range(3):
                a = 2 * math.pi * i / 3
                b.box((0.5 + 0.1 * math.cos(a) - 0.01, 0.5 + 0.1 * math.sin(a) - 0.01, h + 0.05), (0.5 + 0.1 * math.cos(a) + 0.01, 0.5 + 0.1 * math.sin(a) + 0.01, h + 0.2), ctx.paint("iron", 0, tile="plain"), bevel=0.0)
            b.cylinder((0.5, 0.5, h + 0.2), 0.22, 0.1, ctx.paint("iron", 0, tile="plain"), sides=8, radius_top=0.03, bevel=0.0)
            return [b.to_object(ctx.collection)]
        lo, hi = 0.28, 0.72
        body = ctx.paint("walls", params["body"], tile="shikkui")
        b.box((lo, lo, -self.sink_m), (hi, hi, h), body, bevel=0.0)
        for x, y in ((lo, lo), (hi - 0.05, lo), (lo, hi - 0.05), (hi - 0.05, hi - 0.05)):
            b.box((x - 0.01, y - 0.01, -0.1), (x + 0.06, y + 0.06, h + 0.3), dark, bevel=0.0)
        # Louvres on the front and back.
        for y in (lo - 0.02, hi):
            for k in range(4):
                z = h + 0.04 + k * 0.065
                b.box((lo + 0.05, y, z), (hi - 0.05, y + 0.02, z + 0.035), dark, bevel=0.0, noise=0.0)
        top = h + 0.3
        if kind == "yagura":
            prof = solids.gable_profile(lo - 0.12, hi + 0.12, top - 0.04, top + 0.2)
            b.solid(solids.prism(prof, "y", lo - 0.14, hi + 0.14), kawara, bevel=0.0)
            b.solid(solids.tube([(0.5, lo - 0.16, top + 0.21), (0.5, hi + 0.16, top + 0.21)], [0.04, 0.04], sides=6), ctx.paint("roofs", variant % 3, tile="plain"), bevel=0.0)
        else:
            copper = ctx.paint("roofs", 3, tile="plain")
            b.solid(solids.hip_roof(lo - 0.12, hi + 0.12, lo - 0.12, hi + 0.12, top - 0.04, top + 0.2), copper, bevel=0.0)
            b.blob((0.5, 0.5, top + 0.24), 0.05, copper, subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


__all__ = ["curved_hip", "gable_wall_profile", "hip_ring", "hip_tile_rows", "slab_profile", "tile_columns"]
