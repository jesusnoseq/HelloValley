"""Shared dimensions and helpers for the Central & Northern European kit (M05).

Placement conventions (also in tools/blender/README.md):

- **Walls and corners** are one storey (1 cell wide, 3 m high). The facade is the footprint
  front plane (y = 0, facing -Y); the wall is ``WALL_T`` thick behind it. Trims (plinth,
  cornice, sills) stick out up to ``WALL_OVERHANG_M`` in front. Edges on the footprint's
  x and z planes stay sharp, so walls tile side by side and stack without seams.
- **Attachments** (balcony, awning, flowerbox, shutters, sign.hanging) occupy the cell *in
  front of* a wall, in the wall's storey frame: the wall face is the attachment's back plane
  (y = 1) and z = 0 is the storey floor. Place one at the wall's position moved one cell
  forward. Its ``mount`` socket coincides with the matching wall socket.
- **Roofs** cover a 2 x 2 cell building and sit on the top storey (z = 0 = wall top). Wider or
  deeper buildings scale the roof (TODO(M10): the assembler scales x/z to the footprint and y
  with the depth so the pitch stays the same).
- **Dormers and chimneys** sit on a roof; their base is buried in the roof surface.
- **Props** (stair, fence, lamp, bench, tile.cobble) stand on the ground.

Opening sizes are fixed per module (every variant and every style use the same ones), so
shutters, flowerboxes and awnings fit any window, door or shopfront variant.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from hvkit import budgets
from hvkit.budgets import PROP_BUDGET, TILE_BUDGET, WALL_BUDGET  # noqa: F401  (re-exported)
from hvkit.grid import STOREY_M

STYLES = ("european",)

WALL_T = 0.2
"""Wall thickness in metres (``EUROPEAN.wall_thickness_m``; a test keeps them equal)."""
WALL_OVERHANG_M = 0.1
"""How far wall trims (sills, plinths, cornices, door steps) may stand proud of the facade."""

PLINTH_Z = 0.35
CORNICE_Z = 2.82

WINDOW = (0.22, 0.78, 1.0, 2.1)
"""x0, x1, z0, z1 of the wall.window opening (and the dormer-free shutters/flowerbox fit)."""
DOOR = (0.2, 0.8, 0.0, 2.2)
SHOPFRONT = (0.1, 0.9, 0.5, 2.25)
"""Display window of wall.shopfront; the fascia board sits above it."""
FASCIA_Z = (2.32, 2.72)

ROOF_W = 2
ROOF_D = 2
ROOF_PITCH_DEG = 50.0
"""``EUROPEAN.roof_pitch_deg``; sockets need it at import time (a test keeps them equal)."""
ROOF_RISE = (ROOF_D / 2) * math.tan(math.radians(ROOF_PITCH_DEG))
ROOF_T = 0.12
EAVE_M = 0.25
GABLE_OVERHANG_M = 0.15

Rect = Tuple[float, float, float, float]


def budget_for(module_id: str) -> Tuple[int, int]:
    """Triangle budget per module id (``hvkit.budgets``; mirrored by ``kitTriBudget`` in
    packages/shared/src/assets/budgets.ts, and the client kit test checks the built manifest)."""
    return budgets.budget_for(module_id)


def lines(lo: float, hi: float, cuts: Sequence[float] = (), step: float = 0.5) -> List[float]:
    """Grid lines from ``lo`` to ``hi`` through every cut, adding lines about ``step`` apart
    so large flat faces get enough vertices for the painted colour jitter."""
    stops = sorted({round(c, 6) for c in (lo, hi, *cuts) if lo - 1e-9 <= c <= hi + 1e-9})
    out: List[float] = []
    for a, b in zip(stops, stops[1:]):
        n = max(1, int(round((b - a) / step)))
        for k in range(n):
            out.append(round(a + (b - a) * k / n, 6))
    out.append(stops[-1])
    return out


def opening_cells(xs: Sequence[float], zs: Sequence[float], rect: Rect) -> List[Tuple[int, int]]:
    """Grid cells of ``xs`` x ``zs`` that fall inside an opening ``(x0, x1, z0, z1)``."""
    x0, x1, z0, z1 = rect
    cells = []
    for i in range(len(xs) - 1):
        cx = (xs[i] + xs[i + 1]) / 2
        if not x0 < cx < x1:
            continue
        for j in range(len(zs) - 1):
            cz = (zs[j] + zs[j + 1]) / 2
            if z0 < cz < z1:
                cells.append((i, j))
    return cells


def pick(rng, items: Sequence, variant: int, offset: int = 0):
    """Variant-indexed choice so the three variants differ, with a seeded fallback for extra
    variants."""
    if variant < len(items):
        return items[(variant + offset) % len(items)]
    return rng.choice(items)


def wall_params(style, variant: int, rng) -> Dict[str, object]:
    """Choices every wall-like module shares: plaster swatch, plinth and cornice style."""
    walls = style.palette["walls"]
    return {
        "swatch": (variant + rng.randint(0, 1) * 2) % len(walls),
        "plinth": ("stone", "brick", "stone")[variant % 3],
        "cornice": ("trim", "timber", "double")[variant % 3],
    }


class WallKit:
    """Builder helpers for walls (Blender only: needs a MeshBuilder)."""

    def __init__(self, ctx, builder, params: Dict[str, object]) -> None:
        self.ctx = ctx
        self.b = builder
        self.p = params
        self.t = ctx.style.wall_thickness_m

    def plaster(self, swatch: Optional[int] = None):
        return self.ctx.paint("walls", self.p["swatch"] if swatch is None else swatch, tile="plaster")

    def panel(self, openings: Sequence[Rect] = (), x0: float = 0.0, x1: float = 1.0, y0: float = 0.0, seams=("x", "z")) -> None:
        """The plaster slab with openings, subdivided for the painted look."""
        from hvkit import solids

        xcuts = [c for r in openings for c in (r[0], r[1])]
        zcuts = [c for r in openings for c in (r[2], r[3])] + [PLINTH_Z, CORNICE_Z]
        xs = lines(x0, x1, xcuts, 0.34)
        zs = lines(0.0, STOREY_M, zcuts, 0.6)
        holes = [c for r in openings for c in opening_cells(xs, zs, r)]
        self.b.solid(solids.grid_panel(xs, zs, holes, y0, y0 + self.t), self.plaster(), bevel=0.02, segments=1, seams=seams)

    def plinth(self, x0: float = 0.0, x1: float = 1.0, skip: Optional[Tuple[float, float]] = None) -> None:
        tile = "brick" if self.p["plinth"] == "brick" else "stone"
        group, idx = ("roofs", 0) if tile == "brick" else ("ground", 1)
        paint = self.ctx.paint(group, idx, tile=tile)
        spans = [(x0, x1)] if skip is None else [(x0, skip[0]), (skip[1], x1)]
        for a, b in spans:
            if b - a > 1e-3:
                self.b.box((a, -0.03, 0.0), (b, self.t, PLINTH_Z), paint, bevel=0.02, segments=1, seams=("x", "z-"))

    def cornice(self, x0: float = 0.0, x1: float = 1.0) -> None:
        kind = self.p["cornice"]
        if kind == "timber":
            paint = self.ctx.paint("trims", 0, tile="timber")
            self.b.box((x0, -0.05, CORNICE_Z), (x1, self.t, STOREY_M), paint, bevel=0.015, segments=1, seams=("x", "z+"))
            return
        paint = self.ctx.paint("trims", 1, tile="plaster")
        self.b.box((x0, -0.03, CORNICE_Z), (x1, self.t, STOREY_M), paint, bevel=0.02, segments=1, seams=("x", "z+"))
        if kind == "double":
            self.b.box((x0, -0.05, CORNICE_Z + 0.08), (x1, 0.0, CORNICE_Z + 0.14), paint, bevel=0.015, segments=1, seams=("x",))

    def frame(self, rect: Rect, paint, width: float = 0.06, depth: float = 0.03, sill: bool = True, head: float = 0.1) -> None:
        """Trim around an opening on the facade: jambs, a head (lintel) and a sill."""
        x0, x1, z0, z1 = rect
        b = self.b
        b.box((x0 - width, -depth, z0), (x0, 0.04, z1), paint, bevel=0.0)
        b.box((x1, -depth, z0), (x1 + width, 0.04, z1), paint, bevel=0.0)
        b.box((x0 - width - 0.02, -depth - 0.01, z1), (x1 + width + 0.02, 0.04, z1 + head), paint, bevel=0.015, segments=1)
        if sill:
            b.box((x0 - width - 0.03, -0.07, z0 - 0.06), (x1 + width + 0.03, 0.06, z0), paint, bevel=0.015, segments=1)

    def glazing(self, rect: Rect, pattern: str, paint_frame, depth: float = 0.09) -> None:
        """Glass pane set back in the reveal, plus mullions/transoms in ``pattern``:
        ``single``, ``cross``, ``t`` (a transom with two lower casements), ``grid`` (6 panes)."""
        x0, x1, z0, z1 = rect
        b = self.b
        glass = self.ctx.paint("glass", 0, tile="plain", material="glass")
        b.box((x0, depth, z0), (x1, depth + 0.02, z1), glass, bevel=0.0, noise=0.0)
        bar = 0.035
        y0, y1 = depth - 0.03, depth
        cx = (x0 + x1) / 2
        verticals: List[float] = []
        horizontals: List[float] = []
        if pattern in ("cross", "t", "grid"):
            verticals.append(cx)
        if pattern == "grid":
            verticals = [x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3]
            horizontals = [z0 + (z1 - z0) / 2]
        elif pattern == "cross":
            horizontals = [z0 + (z1 - z0) * 0.6]
        elif pattern == "t":
            horizontals = [z0 + (z1 - z0) * 0.72]
        for x in verticals:
            top = horizontals[0] if pattern == "t" else z1
            b.box((x - bar / 2, y0, z0), (x + bar / 2, y1, top), paint_frame, bevel=0.0)
        for z in horizontals:
            b.box((x0, y0, z - bar / 2), (x1, y1, z + bar / 2), paint_frame, bevel=0.0)
