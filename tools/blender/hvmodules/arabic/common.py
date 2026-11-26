"""Shared dimensions and helpers for the Arabic kit (M33).

The kit mirrors the European kit (M05) module for module, like the Mediterranean kit (M32):
every module copies its id, footprint, sockets, triangle budget and ``fits:`` tags from the
European one (:func:`mirror`), so the M10 assembler places every building recipe exactly where
it does with the European kit and recipes need no changes. Only the look differs (GDD §7.3,
art.md §2.3): sand and rose plaster, flat roofs behind crenellated parapets, horseshoe arches,
mashrabiya screens, small domes, zellige tile accents, brass lanterns.

Flat roofs: the roof modules are a deck just above the wall tops inside a parapet, so the
European ``chimney`` and ``dormer`` sockets (on the 50 degree European slope) float above them.
The chimney (a wind-catcher tower or a domed stack) and the dormer (a rooftop kiosk) reach
below their pivots (``Module.sink_m``) down to the deck; a test checks the reach for the largest
roof scale of any recipe.

The assembler scales roofs non-uniformly (x along the ridge, y and z with the span across it),
so parapets, merlons and domes stretch with the building; heights are kept low for that.

Opening sizes are the European ones (``WINDOW``, ``DOOR``, ``SHOPFRONT``), so shutters, planters
and awnings fit any wall variant; horseshoe arches sit inside the same rectangles.
"""

from __future__ import annotations

from typing import Dict, Optional, Sequence, Tuple

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

STYLE_ID = "arabic"
STYLES = (STYLE_ID,)
MIRRORED_STYLE = "european"
"""The kit whose footprints, sockets and budgets this one copies."""

ROOF_PITCH_DEG = 0.0
"""``ARABIC.roof_pitch_deg`` (a test keeps them equal): flat roofs."""
DECK_Z = 0.08
"""Top of the flat roof deck above the wall tops (unscaled)."""
PARAPET_T = 0.12
"""Parapet thickness (unscaled; the assembler scales it with the roof)."""
PARAPET_Z = 0.34
"""Top of the parapet wall, below the merlons."""
MERLON_H = 0.16
HALF = ROOF_D / 2

DADO_Z = 0.5
"""Top of the dado band (zellige, lime or stone) at the foot of every wall."""

HORSESHOE_DEG = 25.0
"""How far horseshoe arches return below their centre line."""
ARC_SEG = 6
ARC_LOW = 1
"""Segments over the half circle and below the centre line of the walls' horseshoe arches
(kept low for the 600-triangle wall budget)."""

WALL_SWATCH_BY_VARIANT = (0, 1, 2)
"""Plaster swatch per wall variant: sand, rose, lime white. Every wall-like module uses the same
swatch for the same variant (the M10 assembler builds one facade from one variant)."""
DADO_BY_VARIANT = ("zellige", "lime", "stone")
CORNICE_BY_VARIANT = ("band", "zellige", "corbels")

CHIMNEY_SINK_M = 2.0
"""How far the chimney reaches below its pivot to meet the flat deck (worst case: the European
gable chimney socket over the apartment block's roof, scaled x2 across the ridge)."""
DORMER_SINK_M = 0.65

Rect = Tuple[float, float, float, float]
Horseshoe = Tuple[float, float, float, float]
"""x0, x1 (widest span), z0 (sill), z_top (apex)."""


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


class ArabModule(Module):
    variants = 3
    styles = STYLES
    extra_tags: Tuple[str, ...] = ()


def wall_params(style, variant: int, rng) -> Dict[str, object]:
    """Choices every wall-like module shares: plaster swatch, dado band and cornice."""
    walls = style.palette["walls"]
    i = variant % 3
    return {
        "swatch": WALL_SWATCH_BY_VARIANT[i] % len(walls),
        "dado": DADO_BY_VARIANT[i],
        "cornice": CORNICE_BY_VARIANT[i],
        "tiles": [rng.randint(1, 5) for _ in range(2)],
    }


class ArabWallKit(WallKit):
    """Plaster walls: the European wall helpers with a plaster panel that can have horseshoe
    openings, a dado band and Arabic cornices."""

    def plaster(self, swatch: Optional[int] = None):
        return self.ctx.paint("walls", self.p["swatch"] if swatch is None else swatch, tile="stucco")

    def panel(self, openings: Sequence[Rect] = (), horseshoes: Sequence[Horseshoe] = (), x0: float = 0.0, x1: float = 1.0, y0: float = 0.0, seams=("x", "z")) -> None:
        """The plaster slab with rectangular openings; each horseshoe fills its rectangle (which
        must be one of the openings) down to a horseshoe outline."""
        from hvkit import solids

        xcuts = [c for r in openings for c in (r[0], r[1])]
        zcuts = [c for r in openings for c in (r[2], r[3])] + [DADO_Z, CORNICE_Z]
        xs = lines(x0, x1, xcuts, 0.34)
        zs = lines(0.0, STOREY_M, zcuts, 0.6)
        holes = [c for r in openings for c in opening_cells(xs, zs, r)]
        paint = self.plaster()
        # Walls with horseshoe openings keep sharp edges (the fillers are not bevelled either,
        # and the budget is tight).
        bevel = 0.0 if horseshoes else 0.02
        self.b.solid(solids.grid_panel(xs, zs, holes, y0, y0 + self.t), paint, bevel=bevel, segments=1, seams=seams)
        for hx0, hx1, hz0, htop in horseshoes:
            for prof in solids.horseshoe_fillers(hx0, hx1, hz0, htop, HORSESHOE_DEG, ARC_SEG, ARC_LOW):
                self.b.solid(solids.prism(prof, "y", y0, y0 + self.t), paint, bevel=0.0)

    def zellige_strip(self, x0: float, x1: float, z0: float, z1: float, y: float, n: int, colours: Sequence[int]) -> None:
        """A row of ``n`` small square tiles (alternating ``colours`` of the ``zellige`` group)
        standing just proud of the face at ``y``."""
        w = (x1 - x0) / n
        for i in range(n):
            tile = self.ctx.paint("zellige", colours[i % len(colours)], tile="zellige")
            self.b.box((x0 + i * w + 0.006, y - 0.012, z0), (x0 + (i + 1) * w - 0.006, y, z1), tile, bevel=0.0, noise=0.0)

    def dado(self, x0: float = 0.0, x1: float = 1.0, skip: Optional[Tuple[float, float]] = None) -> None:
        kind = self.p["dado"]
        if kind == "zellige":
            paint = self.ctx.paint("zellige", 0, tile="zellige")
        elif kind == "stone":
            paint = self.ctx.paint("trims", 2, tile="stone")
        else:
            paint = self.ctx.paint("trims", 0, tile="stucco")
        spans = [(x0, x1)] if skip is None else [(x0, skip[0]), (skip[1], x1)]
        proud = 0.03 if kind == "stone" else 0.015
        for a, b in spans:
            if b - a <= 1e-3:
                continue
            self.b.box((a, -proud, 0.0), (b, self.t, DADO_Z), paint, bevel=0.012, segments=1, seams=("x", "z-"))
            if kind == "zellige" and b - a > 0.2:
                n = max(1, int(round((b - a) / 0.25)))
                self.zellige_strip(a, b, 0.12, 0.38, -proud, n, self.p["tiles"])
            elif kind == "lime":
                band = self.ctx.paint("accents", 0, tile="stucco")
                self.b.box((a, -proud - 0.008, DADO_Z - 0.06), (b, 0.0, DADO_Z), band, bevel=0.0, noise=0.0, seams=("x",))

    def cornice(self, x0: float = 0.0, x1: float = 1.0) -> None:
        kind = self.p["cornice"]
        white = self.ctx.paint("trims", 0, tile="stucco")
        if kind == "zellige":
            self.b.box((x0, -0.03, CORNICE_Z), (x1, self.t, STOREY_M), white, bevel=0.015, segments=1, seams=("x", "z+"))
            n = max(1, int(round((x1 - x0) / 0.25)))
            self.zellige_strip(x0, x1, CORNICE_Z + 0.04, STOREY_M - 0.05, -0.03, n, (1, 2))
            return
        if kind == "corbels":
            wood = self.ctx.paint("trims", 1, tile="timber")
            self.b.box((x0, -0.05, CORNICE_Z + 0.06), (x1, self.t, STOREY_M), wood, bevel=0.012, segments=1, seams=("x", "z+"))
            for cx in (x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75):
                self.b.box((cx - 0.04, -0.09, CORNICE_Z - 0.06), (cx + 0.04, 0.0, CORNICE_Z + 0.06), wood, bevel=0.0)
            return
        self.b.box((x0, -0.025, CORNICE_Z), (x1, self.t, STOREY_M), white, bevel=0.02, segments=1, seams=("x", "z+"))
        self.b.box((x0, -0.045, CORNICE_Z + 0.04), (x1, 0.0, CORNICE_Z + 0.09), white, bevel=0.01, segments=1, seams=("x",))

    def horseshoe_surround(self, shoe: Horseshoe, paint, width: float = 0.06, depth: float = 0.03) -> None:
        """A raised band around a horseshoe opening: jambs up to the imposts and a ring around
        the horseshoe."""
        from hvkit import solids

        x0, x1, z0, top = shoe
        b = self.b
        r, zc, xj0, xj1, z_imp = solids.horseshoe_dims(x0, x1, top, HORSESHOE_DEG)
        b.box((xj0 - width, -depth, z0), (xj0, 0.04, z_imp), paint, bevel=0.0)
        b.box((xj1, -depth, z0), (xj1 + width, 0.04, z_imp), paint, bevel=0.0)
        outer = solids.horseshoe_arc(x0 - width, x1 + width, top + width, HORSESHOE_DEG, ARC_SEG, ARC_LOW)
        inner = solids.horseshoe_arc(x0, x1, top, HORSESHOE_DEG, ARC_SEG, ARC_LOW)
        b.solid(solids.prism(outer + list(reversed(inner)), "y", -depth, 0.04), paint, bevel=0.0)

    def alfiz(self, shoe: Horseshoe, paint, width: float = 0.05, depth: float = 0.035, pad: float = 0.1) -> None:
        """The rectangular frame (alfiz) around a horseshoe arch, from the imposts to above the
        apex."""
        x0, x1, z0, top = shoe
        from hvkit import solids

        _, _, _, _, z_imp = solids.horseshoe_dims(x0, x1, top, HORSESHOE_DEG)
        b = self.b
        xa, xb, za, zb = x0 - pad, x1 + pad, z_imp, min(top + pad, CORNICE_Z - 0.02)
        b.box((xa - width, -depth, za), (xa, 0.02, zb + width), paint, bevel=0.0)
        b.box((xb, -depth, za), (xb + width, 0.02, zb + width), paint, bevel=0.0)
        b.box((xa, -depth, zb), (xb, 0.02, zb + width), paint, bevel=0.0)

    def horseshoe_glass(self, shoe: Horseshoe, bar_paint, depth: float = 0.09) -> None:
        """A horseshoe pane set back in the reveal with a bar at the imposts."""
        from hvkit import solids

        x0, x1, z0, top = shoe
        glass = self.ctx.paint("glass", 0, tile="plain", material="glass")
        self.b.solid(solids.prism(solids.horseshoe_profile(x0, x1, z0, top, HORSESHOE_DEG, ARC_SEG, ARC_LOW), "y", depth, depth + 0.02), glass, bevel=0.0, noise=0.0)
        _, _, xj0, xj1, z_imp = solids.horseshoe_dims(x0, x1, top, HORSESHOE_DEG)
        bar = 0.035
        self.b.box((xj0, depth - 0.03, z_imp - bar / 2), (xj1, depth, z_imp + bar / 2), bar_paint, bevel=0.0)

    def lattice(self, x0: float, x1: float, z0: float, z1: float, y0: float, y1: float, paint, nx: int = 5, nz: int = 7, frame: float = 0.035) -> None:
        """A framed mashrabiya screen: a frame around a grid of thin bars (turned wood kept to
        plain bars for the budget)."""
        b = self.b
        b.box((x0, y0, z0), (x1, y1, z0 + frame), paint, bevel=0.0)
        b.box((x0, y0, z1 - frame), (x1, y1, z1), paint, bevel=0.0)
        b.box((x0, y0, z0 + frame), (x0 + frame, y1, z1 - frame), paint, bevel=0.0)
        b.box((x1 - frame, y0, z0 + frame), (x1, y1, z1 - frame), paint, bevel=0.0)
        lattice(b, x0 + frame, x1 - frame, z0 + frame, z1 - frame, y0 + 0.004, y1 - 0.004, paint, nx, nz)


def lattice(b, x0: float, x1: float, z0: float, z1: float, y0: float, y1: float, paint, nx: int, nz: int, bar: float = 0.014, axis: str = "y") -> None:
    """Bars of a mashrabiya grid inside ``x0..x1`` x ``z0..z1`` (a screen facing -Y; with
    ``axis="x"`` the screen faces -X and the first range is y)."""
    def box(u0, u1, w0, w1):
        if axis == "y":
            b.box((u0, y0, w0), (u1, y1, w1), paint, bevel=0.0, noise=0.0)
        else:
            b.box((y0, u0, w0), (y1, u1, w1), paint, bevel=0.0, noise=0.0)

    for i in range(1, nx):
        u = x0 + (x1 - x0) * i / nx
        box(u - bar / 2, u + bar / 2, z0, z1)
    for j in range(1, nz):
        w = z0 + (z1 - z0) * j / nz
        box(x0, x1, w - bar / 2, w + bar / 2)


def merlon_positions(x0: float, x1: float, step: float = 0.25, width: float = 0.12) -> list:
    """(x_lo, x_hi) of the merlons along a parapet from ``x0`` to ``x1``: evenly spaced, with
    one at each end so corners are closed."""
    n = max(1, int(round((x1 - x0 - width) / step)))
    gap = (x1 - x0 - width) / n
    return [(round(x0 + k * gap, 6), round(x0 + k * gap + width, 6)) for k in range(n + 1)]
