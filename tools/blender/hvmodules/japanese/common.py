"""Shared dimensions and helpers for the Japanese kit (M34).

The kit mirrors the European kit (M05) module for module, like the Mediterranean (M32) and Arabic
(M33) kits: every module copies its id, footprint, sockets, triangle budget and ``fits:`` tags
from the European one (:func:`mirror`), so the M10 assembler places every building recipe
exactly where it does with the European kit and recipes need no changes. Only the look differs
(GDD §7.3, art.md §2.4): dark wood frames and white plaster, grey kawara tile roofs with gently
curved eaves, shoji and sliding doors, noren curtains, bamboo, stone lanterns.

Walls: a dark post (hashira) stands at each side of every wall cell (half a post per cell, so
two neighbouring cells show one post), a tie beam (nageshi) crosses the storey and a wall-plate
beam (keta) runs along the top. The base band is a dark board wainscot (koshi-ita), namako tiles
(grey tiles with white diagonal joints) or a stone plinth.

Roofs: the slopes are concave (steeper at the ridge, flatter towards the eave), drawn by
:func:`roof_under`. The European ``chimney`` and ``dormer`` sockets lie above this roof's
surface, so the chimney (a roofed smoke vent) and the dormer reach below their pivots
(``Module.sink_m``) into the attic; a test checks the reach for the largest roof scale of any
recipe.

Opening sizes are the European ones (``WINDOW``, ``DOOR``, ``SHOPFRONT``), so shutters, planters
and awnings fit any wall variant.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from hvkit.grid import STOREY_M
from hvkit.module import Module, get_module
from hvmodules.europe.common import (  # noqa: F401  (re-exported: same openings and grid)
    CORNICE_Z,
    DOOR,
    FASCIA_Z,
    ROOF_D,
    ROOF_W,
    SHOPFRONT,
    WALL_OVERHANG_M,
    WALL_T,
    WINDOW,
    WallKit,
    lines,
    opening_cells,
    pick,
)

STYLE_ID = "japanese"
STYLES = (STYLE_ID,)
MIRRORED_STYLE = "european"
"""The kit whose footprints, sockets and budgets this one copies."""

ROOF_PITCH_DEG = 32.0
"""``JAPANESE.roof_pitch_deg`` (a test keeps them equal): the mean pitch of the curved slope."""
HALF = ROOF_D / 2
ROOF_RISE = HALF * math.tan(math.radians(ROOF_PITCH_DEG))
CURVE = 0.22
"""Concavity of the slope: ``roof_under(u) = a u + CURVE u^2`` with ``a + CURVE = ROOF_RISE``."""
SLOPE_A = ROOF_RISE - CURVE
EAVE_M = 0.4
"""Deep eaves (``JAPANESE.eave_overhang_m``)."""
GABLE_OVERHANG_M = 0.2
SLAB_UP = 0.11
"""Vertical thickness of a roof slab."""
TILE_UP = 0.045
"""How far the round tile rows stand above the slab."""
RIDGE_Z = ROOF_RISE + SLAB_UP
CORNER_LIFT = 0.09
"""How far the eave corners of hipped roofs turn up (sori)."""

POST_W = 0.05
"""Half a post (hashira) at each side of a wall cell."""
POST_PROUD = 0.03
DADO_Z = 0.55
"""Top of the base band (koshi-ita boards, namako tiles or stone)."""
NAGESHI_Z = (2.36, 2.46)
"""The tie beam across the storey (above the openings, below the fascia of shopfronts)."""

WALL_SWATCH_BY_VARIANT = (0, 1, 2)
"""Plaster swatch per wall variant: white lime, earth, pale grey. Every wall-like module uses the
same swatch for the same variant (the M10 assembler builds one facade from one variant)."""
BASE_BY_VARIANT = ("boards", "namako", "stone")
WOOD_BY_VARIANT = (0, 1, 0)
"""Frame wood per variant (``trims``): dark, cedar, dark."""

CHIMNEY_SINK_M = 1.2
"""How far the chimney (a roofed smoke vent) reaches below its pivot to meet the roof (worst
case: the European chimney socket over the apartment block's roof, scaled x2 across the ridge)."""
DORMER_SINK_M = 0.45

Rect = Tuple[float, float, float, float]


def roof_under(u: float) -> float:
    """Height of a slope's underside at horizontal distance ``u`` inside the wall line (u < 0
    under the eave). It passes through the wall top's outer edge (u = 0, z = 0) and reaches
    ``ROOF_RISE`` at the ridge; flatter at the eave, steeper at the ridge."""
    return SLOPE_A * u + CURVE * u * u


def roof_surface_z(y: float) -> float:
    """Height of the gable roof slab's top at depth ``y`` (wall top = 0), without the tiles."""
    y = min(y, ROOF_D - y)
    return roof_under(y) + SLAB_UP


def slope_points(u0: float, u1: float, n: int) -> List[float]:
    return [u0 + (u1 - u0) * k / n for k in range(n + 1)]


def mirror(cls):
    """Class decorator (apply under ``@register``): copy the European module's footprint,
    sockets, variant count, budget, overhang and tags, renaming the ``europe`` tag."""
    eu = get_module(cls.id, MIRRORED_STYLE)
    cls.footprint = eu.footprint
    cls.sockets = eu.sockets
    cls.variants = eu.variants
    cls.tri_budget = eu.tri_budget
    if "max_overhang_m" not in cls.__dict__:
        cls.max_overhang_m = eu.max_overhang_m
    extra = tuple(t for t in cls.__dict__.get("extra_tags", ()) if t not in eu.tags)
    cls.tags = tuple(STYLE_ID if t == "europe" else t for t in eu.tags) + extra
    return cls


class JapModule(Module):
    variants = 3
    styles = STYLES
    extra_tags: Tuple[str, ...] = ()


def wall_params(style, variant: int, rng) -> Dict[str, object]:
    """Choices every wall-like module shares: plaster swatch, base band and frame wood."""
    walls = style.palette["walls"]
    i = variant % 3
    return {
        "swatch": WALL_SWATCH_BY_VARIANT[i] % len(walls),
        "base": BASE_BY_VARIANT[i],
        "wood": WOOD_BY_VARIANT[i],
        "grain": [round(rng.uniform(-0.01, 0.01), 3) for _ in range(3)],
    }


class JapWallKit(WallKit):
    """Plaster between dark posts and beams: the European wall helpers (panel, frame) with a
    plaster tile, Japanese base bands, posts, beams, shoji and lattices."""

    def plaster(self, swatch: Optional[int] = None):
        return self.ctx.paint("walls", self.p["swatch"] if swatch is None else swatch, tile="shikkui")

    def wood(self, index: Optional[int] = None):
        return self.ctx.paint("trims", self.p["wood"] if index is None else index, tile="timber")

    def panel(self, openings: Sequence[Rect] = (), x0: float = 0.0, x1: float = 1.0, y0: float = 0.0, seams=("x", "z")) -> None:
        from hvkit import solids

        xcuts = [c for r in openings for c in (r[0], r[1])]
        zcuts = [c for r in openings for c in (r[2], r[3])] + [DADO_Z, CORNICE_Z]
        xs = lines(x0, x1, xcuts, 0.34)
        zs = lines(0.0, STOREY_M, zcuts, 0.6)
        holes = [c for r in openings for c in opening_cells(xs, zs, r)]
        self.b.solid(solids.grid_panel(xs, zs, holes, y0, y0 + self.t), self.plaster(), bevel=0.0, seams=seams)

    def posts(self, z0: float = 0.0, z1: float = STOREY_M) -> None:
        """Half a post at each side of the cell, standing a little proud of the plaster."""
        w = self.wood()
        self.b.box((0.0, -POST_PROUD, z0), (POST_W, self.t, z1), w, bevel=0.0, seams=("x", "z"))
        self.b.box((1.0 - POST_W, -POST_PROUD, z0), (1.0, self.t, z1), w, bevel=0.0, seams=("x", "z"))

    def beams(self, nageshi: bool = True, x0: float = 0.0, x1: float = 1.0) -> None:
        """The wall-plate beam along the top (keta) and the tie beam (nageshi)."""
        w = self.wood()
        self.b.box((x0, -0.05, CORNICE_Z), (x1, self.t, STOREY_M), w, bevel=0.0, seams=("x", "z+"))
        if nageshi:
            self.b.box((x0, -0.045, NAGESHI_Z[0]), (x1, 0.0, NAGESHI_Z[1]), w, bevel=0.0, seams=("x",))

    def base(self, x0: float = 0.0, x1: float = 1.0, skip: Optional[Tuple[float, float]] = None) -> None:
        """The base band up to ``DADO_Z``: vertical dark boards with a batten, namako tiles or
        a stone plinth."""
        from hvkit import solids

        kind = self.p["base"]
        spans = [(x0, x1)] if skip is None else [(x0, skip[0]), (skip[1], x1)]
        for a, b in spans:
            if b - a <= 1e-3:
                continue
            if kind == "boards":
                dark = self.ctx.paint("trims", 0, tile="timber")
                self.b.box((a, -0.02, 0.0), (b, self.t, DADO_Z), dark, bevel=0.0, seams=("x", "z-"))
                self.b.box((a, -0.04, DADO_Z - 0.06), (b, -0.02, DADO_Z), dark, bevel=0.0, seams=("x",))
                n = max(1, int(round((b - a) / 0.2)))
                for i in range(1, n):
                    x = a + (b - a) * i / n
                    self.b.box((x - 0.008, -0.03, 0.0), (x + 0.008, -0.02, DADO_Z - 0.06), dark, bevel=0.0, noise=0.0)
            elif kind == "namako":
                grey = self.ctx.paint("roofs", 1, tile="kawara")
                white = self.ctx.paint("walls", 0, tile="shikkui")
                self.b.box((a, -0.02, 0.0), (b, self.t, DADO_Z), grey, bevel=0.0, seams=("x", "z-"))
                # White diagonal joints (raised plaster strips) at 45 degrees (not on the narrow
                # strips beside a door: the budget goes to the door).
                if b - a < 0.3:
                    continue
                step = 0.42
                k0 = int(math.floor((a - DADO_Z) / step))
                k1 = int(math.ceil(b / step))
                for k in range(k0, k1 + 1):
                    for sign in (1.0, -1.0):
                        xa = k * step
                        p0, p1 = (xa, 0.0), (xa + DADO_Z, DADO_Z)
                        if sign < 0:
                            p0, p1 = (xa + DADO_Z, 0.0), (xa, DADO_Z)
                        prof = solids.clip_beam_profile(p0, p1, 0.028, (a, 0.0), (b, DADO_Z))
                        if len(prof) >= 3 and abs(solids.signed_area(prof)) > 1e-5:
                            self.b.solid(solids.prism(prof, "y", -0.032, -0.02), white, bevel=0.0, noise=0.0)
            else:
                stone = self.ctx.paint("stone", 0, tile="paving")
                self.b.box((a, -0.04, 0.0), (b, self.t, DADO_Z - 0.15), stone, bevel=0.012, segments=1, seams=("x", "z-"))
                self.b.box((a, -0.025, DADO_Z - 0.15), (b, self.t, DADO_Z), self.ctx.paint("trims", 0, tile="timber"), bevel=0.0, seams=("x",))

    def shoji(self, rect: Rect, y: float, nx: int = 3, nz: int = 4, paint_frame=None, frame: float = 0.035) -> None:
        """A shoji screen in ``rect`` at depth ``y`` (its front face): a translucent paper pane
        (the ``glass`` material, so it glows at night) behind a light kumiko lattice."""
        x0, x1, z0, z1 = rect
        b = self.b
        paper = self.ctx.paint("glass", 0, tile="plain", material="glass")
        b.box((x0, y + 0.015, z0), (x1, y + 0.025, z1), paper, bevel=0.0, noise=0.0)
        f = paint_frame or self.ctx.paint("trims", 2, tile="timber")
        b.box((x0, y, z0), (x1, y + 0.015, z0 + frame), f, bevel=0.0)
        b.box((x0, y, z1 - frame), (x1, y + 0.015, z1), f, bevel=0.0)
        b.box((x0, y, z0 + frame), (x0 + frame, y + 0.015, z1 - frame), f, bevel=0.0)
        b.box((x1 - frame, y, z0 + frame), (x1, y + 0.015, z1 - frame), f, bevel=0.0)
        bar = 0.012
        for i in range(1, nx):
            x = x0 + (x1 - x0) * i / nx
            b.box((x - bar / 2, y + 0.004, z0 + frame), (x + bar / 2, y + 0.015, z1 - frame), f, bevel=0.0, noise=0.0)
        for j in range(1, nz):
            z = z0 + (z1 - z0) * j / nz
            b.box((x0 + frame, y + 0.004, z - bar / 2), (x1 - frame, y + 0.015, z + bar / 2), f, bevel=0.0, noise=0.0)

    def koshi(self, rect: Rect, y0: float, y1: float, paint, n: int = 7, rail: bool = True) -> None:
        """A koshi lattice: thin vertical slats across ``rect`` between two rails."""
        x0, x1, z0, z1 = rect
        b = self.b
        if rail:
            b.box((x0, y0, z0), (x1, y1, z0 + 0.04), paint, bevel=0.0)
            b.box((x0, y0, z1 - 0.04), (x1, y1, z1), paint, bevel=0.0)
        for i in range(n):
            x = x0 + (x1 - x0) * (i + 0.5) / n
            b.box((x - 0.016, y0 + 0.004, z0 + 0.04), (x + 0.016, y1, z1 - 0.04), paint, bevel=0.0, noise=0.0)

    def noren(self, x0: float, x1: float, z_top: float, length: float, y: float, colour, panels: int = 3, mon: bool = True) -> None:
        """A noren curtain: ``panels`` fabric strips hanging from a rod, with a white crest."""
        b = self.b
        b.box((x0 - 0.04, y, z_top - 0.02), (x1 + 0.04, y + 0.03, z_top), self.wood(0), bevel=0.0)
        w = (x1 - x0) / panels
        for i in range(panels):
            xa, xb = x0 + i * w + 0.006, x0 + (i + 1) * w - 0.006
            b.box((xa, y + 0.005, z_top - 0.02 - length), (xb, y + 0.02, z_top - 0.02), colour, bevel=0.0, noise=0.0)
        if mon:
            white = self.ctx.paint("fabric", 2, tile="plain")
            cx, cz = (x0 + x1) / 2, z_top - 0.02 - length * 0.45
            ring = [(cx + 0.065 * math.cos(a), cz + 0.065 * math.sin(a)) for a in (k * math.pi / 4 for k in range(8))]
            from hvkit import solids

            b.solid(solids.prism(ring, "y", y - 0.001, y + 0.005), white, bevel=0.0, noise=0.0)


def corner_post(b, paint, x: float, y: float, half: float, z0: float, z1: float) -> None:
    """A square post centred on (x, y)."""
    b.box((x - half, y - half, z0), (x + half, y + half, z1), paint, bevel=0.0)
