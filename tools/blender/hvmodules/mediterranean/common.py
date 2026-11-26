"""Shared dimensions and helpers for the Mediterranean kit (M32).

The kit mirrors the European kit (M05) module for module: every module copies its id,
footprint, sockets, triangle budget and ``fits:`` tags from the European one (:func:`mirror`),
so the M10 assembler places every building recipe exactly where it does with the European kit
and recipes need no changes. Only the look differs (GDD §7.3, art.md §2.2): whitewash, ochre and
apricot stucco, low terracotta roofs with canal tiles, arched doors and windows, blue and sage
shutters, wrought iron, painted tiles, terracotta pots.

Roofs are lower than the European ones (25 degrees instead of 50), but they keep the European
``chimney`` and ``dormer`` sockets. The chimney and the dormer therefore reach further down than
their pivot (``Module.sink_m``): their lower part is buried in the attic under the low roof, and
on any recipe the visible part starts on the roof surface.

Opening sizes are the European ones (``WINDOW``, ``DOOR``, ``SHOPFRONT``), so shutters, pots
and awnings fit any wall variant; arched openings put the arch inside the same rectangle.
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

STYLE_ID = "mediterranean"
STYLES = (STYLE_ID,)
MIRRORED_STYLE = "european"
"""The kit whose footprints, sockets and budgets this one copies."""

ROOF_PITCH_DEG = 25.0
"""``MEDITERRANEAN.roof_pitch_deg`` (a test keeps them equal): low terracotta roofs."""
EAVE_M = 0.2
ROOF_T = 0.1
TAN = math.tan(math.radians(ROOF_PITCH_DEG))
SLAB_UP = ROOF_T / math.cos(math.radians(ROOF_PITCH_DEG))
"""Vertical thickness of a roof slab."""
ROOF_RISE = (ROOF_D / 2) * TAN
RIDGE_Z = ROOF_RISE + SLAB_UP
HALF = ROOF_D / 2
GABLE_OVERHANG_M = 0.12

ZOCALO_Z = 0.5
"""Top of the painted base band (zocalo) of every wall."""
TILE_R = 0.045
"""Radius of a canal (barrel) roof tile."""
TILE_STEP = 0.2
"""Distance between canal tile rows."""

WALL_SWATCH_BY_VARIANT = (0, 1, 2)
"""Stucco swatch per wall variant: whitewash, ochre, apricot. Every wall-like module uses the
same swatch for the same variant (the M10 assembler builds one facade from one variant)."""
ZOCALO_BY_VARIANT = ("blue", "stone", "terracotta")
CORNICE_BY_VARIANT = ("band", "tiles", "moulding")

CHIMNEY_SINK_M = 1.3
"""How far the chimney stack reaches below its pivot to meet the low roof (worst case: the
European chimney socket over a library-sized hip roof)."""
DORMER_SINK_M = 0.4

Rect = Tuple[float, float, float, float]
Arch = Tuple[float, float, float, float]
"""x0, x1, z_spring, rise."""


def roof_surface_z(y: float) -> float:
    """Height of the gable roof surface at depth ``y`` (wall top = 0)."""
    y = min(y, ROOF_D - y)
    return y * TAN + SLAB_UP


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


class MedModule(Module):
    variants = 3
    styles = STYLES
    extra_tags: Tuple[str, ...] = ()


def wall_params(style, variant: int, rng) -> Dict[str, object]:
    """Choices every wall-like module shares: stucco swatch, zocalo (base band) and cornice."""
    walls = style.palette["walls"]
    i = variant % 3
    return {
        "swatch": WALL_SWATCH_BY_VARIANT[i] % len(walls),
        "zocalo": ZOCALO_BY_VARIANT[i],
        "cornice": CORNICE_BY_VARIANT[i],
        "weather": round(rng.uniform(0.0, 1.0), 3),
    }


class MedWallKit(WallKit):
    """Stucco walls: the European wall helpers (frames, glazing) with a stucco panel that can
    have arched openings, a painted zocalo and Mediterranean cornices."""

    def plaster(self, swatch: Optional[int] = None):
        return self.ctx.paint("walls", self.p["swatch"] if swatch is None else swatch, tile="stucco")

    def panel(self, openings: Sequence[Rect] = (), arches: Sequence[Arch] = (), x0: float = 0.0, x1: float = 1.0, y0: float = 0.0, seams=("x", "z")) -> None:
        """The stucco slab with rectangular openings; each arch fills the top corners of its
        opening (which must reach ``z_spring + rise``) with spandrels."""
        from hvkit import solids

        xcuts = [c for r in openings for c in (r[0], r[1])]
        zcuts = [c for r in openings for c in (r[2], r[3])] + [ZOCALO_Z, CORNICE_Z]
        xs = lines(x0, x1, xcuts, 0.34)
        zs = lines(0.0, STOREY_M, zcuts, 0.6)
        holes = [c for r in openings for c in opening_cells(xs, zs, r)]
        paint = self.plaster()
        self.b.solid(solids.grid_panel(xs, zs, holes, y0, y0 + self.t), paint, bevel=0.02, segments=1, seams=seams)
        for ax0, ax1, spring, rise in arches:
            for prof in solids.arch_spandrels(ax0, ax1, spring, rise, 8):
                self.b.solid(solids.prism(prof, "y", y0, y0 + self.t), paint, bevel=0.0)

    def zocalo(self, x0: float = 0.0, x1: float = 1.0, skip: Optional[Tuple[float, float]] = None) -> None:
        kind = self.p["zocalo"]
        if kind == "blue":
            paint = self.ctx.paint("accents", 0, tile="stucco")
        elif kind == "stone":
            paint = self.ctx.paint("ground", 1, tile="paving")
        else:
            paint = self.ctx.paint("roofs", 2, tile="stucco")
        spans = [(x0, x1)] if skip is None else [(x0, skip[0]), (skip[1], x1)]
        proud = 0.03 if kind == "stone" else 0.012
        for a, b in spans:
            if b - a > 1e-3:
                self.b.box((a, -proud, 0.0), (b, self.t, ZOCALO_Z), paint, bevel=0.012, segments=1, seams=("x", "z-"))

    def cornice(self, x0: float = 0.0, x1: float = 1.0) -> None:
        kind = self.p["cornice"]
        white = self.ctx.paint("trims", 0, tile="stucco")
        if kind == "tiles":
            # A tejaroz: a short course of canal tiles over a white band at the wall top.
            self.b.box((x0, -0.03, CORNICE_Z), (x1, self.t, STOREY_M - 0.08), white, bevel=0.015, segments=1, seams=("x",))
            clay = self.ctx.paint("roofs", 0, tile="roof_clay")
            self.b.box((x0, -0.08, STOREY_M - 0.08), (x1, self.t, STOREY_M), clay, bevel=0.0, seams=("x", "z+"))
            n = 3
            for i in range(n):
                cx = x0 + (x1 - x0) * (i + 0.5) / n
                self.b.cylinder((cx, -0.055, STOREY_M - 0.075), 0.03, 0.06, clay, sides=5, bevel=0.0)
            return
        if kind == "moulding":
            stone = self.ctx.paint("trims", 2, tile="stone")
            self.b.box((x0, -0.03, CORNICE_Z), (x1, self.t, STOREY_M), stone, bevel=0.015, segments=1, seams=("x", "z+"))
            self.b.box((x0, -0.06, CORNICE_Z + 0.05), (x1, 0.0, CORNICE_Z + 0.11), stone, bevel=0.012, segments=1, seams=("x",))
            return
        self.b.box((x0, -0.025, CORNICE_Z), (x1, self.t, STOREY_M), white, bevel=0.02, segments=1, seams=("x", "z+"))

    def arch_surround(self, arch: Arch, z0: float, paint, width: float = 0.07, depth: float = 0.03, sill: bool = True) -> None:
        """A raised band around an arched opening: jambs up to the springing line and an arch
        ring over it, plus an optional sill."""
        from hvkit import solids

        x0, x1, spring, rise = arch
        b = self.b
        b.box((x0 - width, -depth, z0), (x0, 0.04, spring), paint, bevel=0.0)
        b.box((x1, -depth, z0), (x1 + width, 0.04, spring), paint, bevel=0.0)
        b.solid(solids.prism(solids.arch_ring(x0, x1, spring, rise, width, 8), "y", -depth, 0.04), paint, bevel=0.0)
        if sill:
            b.box((x0 - width - 0.03, -0.07, z0 - 0.06), (x1 + width + 0.03, 0.06, z0), paint, bevel=0.015, segments=1)

    def arched_glass(self, arch: Arch, z0: float, bar_paint, depth: float = 0.09, mullion: bool = True) -> None:
        """An arch-topped pane set back in the reveal with a transom at the springing line and
        an optional mullion."""
        from hvkit import solids

        x0, x1, spring, rise = arch
        glass = self.ctx.paint("glass", 0, tile="plain", material="glass")
        self.b.solid(solids.prism(solids.arched_profile(x0, x1, z0, spring, rise, 8), "y", depth, depth + 0.02), glass, bevel=0.0, noise=0.0)
        bar = 0.035
        y0, y1 = depth - 0.03, depth
        self.b.box((x0, y0, spring - bar / 2), (x1, y1, spring + bar / 2), bar_paint, bevel=0.0)
        if mullion:
            cx = (x0 + x1) / 2
            self.b.box((cx - bar / 2, y0, z0), (cx + bar / 2, y1, spring + rise - 0.01), bar_paint, bevel=0.0)


def gable_clearance(profile: Sequence[Tuple[float, float]], margin: float = 0.05) -> List[Tuple[float, float, float]]:
    """``(y, z, roof_z)`` for every top point of a gable-wall profile that does not stand at
    least ``margin`` above the roof surface beside it (empty = the wall clears the roof)."""
    bad = []
    for y, z in profile:
        if z <= 1e-9 or not 0.0 <= y <= ROOF_D:
            continue
        roof = roof_surface_z(y)
        if z < roof + margin:
            bad.append((y, z, roof))
    return bad
