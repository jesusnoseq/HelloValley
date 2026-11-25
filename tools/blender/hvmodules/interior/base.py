"""Shared dimensions and helpers for the interior and furniture kit (M08), built into
``kits/interior/``.

Placement conventions (also in tools/blender/README.md):

- **Floor level** is the pivot plane (z = 0): walls and furniture stand on it. Floor panels
  (``floor.*``) are 1 x 1 cell slabs whose top is at z = 0 and which reach ``FLOOR_SINK_M``
  below it.
- **Room walls** (``iwall.*``) are one storey (1 cell wide, 3 m high) standing at the *back* of
  their cell: the panel fills ``y in [1 - IWALL_T, 1]`` and its room face, at
  ``y = ROOM_FACE_Y``, looks towards -Y (the camera side). A room is lined by placing panels
  along its back and side edges (rotated in 90-degree steps); the cut-away hides the walls
  facing the camera (TODO(M13)). Skirting, wainscot and trims stand up to ``TRIM_M`` proud of
  the room face. Edges on the x and z footprint planes stay sharp so panels tile seamlessly.
- **Furniture** declares a :class:`hvkit.grid.Placement` on the 0.5 m grid (GDD §4.2) and stays
  inside that box. Its front is y = 0 (the side the player uses) and its back edge is
  y = ``placement.depth_m``; ``against_wall`` pieces put that edge on a room face. Wall-mounted
  pieces (``mount = "wall"``) hang from it: their back plane is the wall. Every piece has a
  ``use`` socket on its front edge at floor level, where a character stands to interact;
  seats add ``sit`` sockets (seat height, facing the way the sitter looks), tables and
  shelves a ``top`` socket where ``surface`` pieces (table lamps) go, and shop counters a
  ``vendor`` socket behind the counter (the NPC) and a ``counter`` socket at its front edge.
"""

from __future__ import annotations

import math
from typing import List, Sequence, Tuple

from hvkit.budgets import budget_for
from hvkit.grid import Placement
from hvkit.module import Module, Socket

STYLES = ("interior",)

FLOOR_SINK_M = 0.06
"""Floor panels are slabs from z = -FLOOR_SINK_M to z = 0."""
IWALL_T = 0.1
"""Room wall panel thickness (``INTERIOR.wall_thickness_m``; a test keeps them equal)."""
ROOM_FACE_Y = 1.0 - IWALL_T
"""The room face of a wall panel (it looks towards -Y)."""
TRIM_M = 0.04
"""How far skirting boards, wainscot, sills and casings stand proud of the room face."""
WALL_H = 3.0

WINDOW = (0.2, 0.8, 1.0, 2.2)
"""x0, x1, z0, z1 of the iwall.window opening (same in every variant)."""
DOOR = (0.2, 0.8, 0.0, 2.2)
"""x0, x1, z0, z1 of the iwall.door opening."""

SEAT_Z = 0.45
"""Seat height of chairs and sofas (the ``sit`` sockets)."""
FRONT = (0.0, -1.0, 0.0)
UP = (0.0, 0.0, 1.0)


class InteriorModule(Module):
    variants = 3
    styles = STYLES

    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        if cls.id and "tri_budget" not in cls.__dict__:
            cls.tri_budget = budget_for(cls.id)


class Furniture(InteriorModule):
    """A furniture piece. Subclasses set ``placement`` and ``height``; the 1 m footprint is
    derived from them."""

    height: float = 1.0

    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        placement = cls.__dict__.get("placement")
        if placement is not None and "footprint" not in cls.__dict__:
            cls.footprint = placement.footprint(cls.height)


def use_socket(placement: Placement) -> Socket:
    """Where a character stands to use a piece: the middle of its front edge, on the floor."""
    return Socket("use", "prop", (placement.width_m / 2, 0.0, 0.0), FRONT)


def pick(rng, items: Sequence, variant: int, offset: int = 0):
    """Variant-indexed choice so the three variants differ, with a seeded fallback for extra
    variants."""
    if variant < len(items):
        return items[(variant + offset) % len(items)]
    return rng.choice(items)


def ellipse(cx: float, cz: float, rx: float, rz: float, segments: int = 16, a0: float = 0.0, a1: float = 2 * math.pi) -> List[Tuple[float, float]]:
    """Points of an ellipse (or an arc of one, ``a0``..``a1``) in a vertical (x, z) plane: the
    profile of oval mirrors, round frames and arches for ``solids.prism(..., "y", ...)``."""
    full = abs((a1 - a0) - 2 * math.pi) < 1e-9
    n = segments if full else segments + 1
    pts = []
    for k in range(n):
        a = a0 + (a1 - a0) * k / segments
        pts.append((round(cx + rx * math.cos(a), 6), round(cz + rz * math.sin(a), 6)))
    return pts


def arch_profile(x0: float, x1: float, z0: float, z_spring: float, segments: int = 8) -> List[Tuple[float, float]]:
    """A round-topped (x, z) outline: straight sides from ``z0`` to ``z_spring`` and a half
    ellipse on top reaching ``z_spring + (x1 - x0) / 2``."""
    r = (x1 - x0) / 2
    top = ellipse((x0 + x1) / 2, z_spring, r, r, segments, 0.0, math.pi)
    return [(x0, z0), (x1, z0)] + top


def split_lines(rng, lo: float, hi: float, n: int, jitter: float) -> List[float]:
    """``n`` cells between ``lo`` and ``hi`` with seeded, jittered inner lines (flagstones)."""
    step = (hi - lo) / n
    inner = [round(lo + step * k + rng.uniform(-jitter, jitter) * step, 4) for k in range(1, n)]
    return [lo] + inner + [hi]
