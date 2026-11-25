"""Contact-sheet layout (pure Python): where every module variant goes on the sheet.

Each module gets a group of its variants side by side, groups are packed into rows of
``columns`` groups, and every slot is wide enough for the module's footprint plus overhangs.
Positions are Blender space (x right, y back, z up) for the module pivot.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple

from .module import Module

GAP_M = 0.9
"""Free space between variants and around groups (fits roof eaves and labels)."""
LABEL_DEPTH_M = 0.9
"""Room in front of each group for its label."""


@dataclass(frozen=True)
class Slot:
    module_id: str
    variant: int
    pivot: Tuple[float, float, float]


@dataclass(frozen=True)
class Group:
    module_id: str
    origin: Tuple[float, float]
    """Front-left corner of the group (where the label goes)."""
    width: float
    depth: float


def slot_size(module: Module) -> Tuple[float, float]:
    fp = module.footprint
    return fp.width_m + 2 * module.max_overhang_m + GAP_M, fp.depth_m + 2 * module.max_overhang_m + GAP_M


def layout(
    modules: Sequence[Module], columns: int = 4, height_gap: float = 0.0
) -> Tuple[List[Slot], List[Group], Tuple[float, float]]:
    """Slots for every variant, one group per module and the sheet size (width, depth).
    Rows are listed front to back, so the first module is nearest the camera. ``height_gap``
    adds that many metres of space behind a row per metre of its tallest module, so a tilted
    camera still sees the next row's labels."""
    if columns < 1:
        raise ValueError("columns must be >= 1")
    slots: List[Slot] = []
    groups: List[Group] = []
    y = 0.0
    sheet_w = 0.0
    row_h = 0.0
    for start in range(0, len(modules), columns):
        row = modules[start : start + columns]
        x = 0.0
        row_depth = 0.0
        row_h = 0.0
        for m in row:
            row_h = max(row_h, m.footprint.height_m)
            sw, sd = slot_size(m)
            group_w = sw * m.variants
            for v in range(m.variants):
                px = x + v * sw + m.max_overhang_m + GAP_M / 2
                py = y + LABEL_DEPTH_M + m.max_overhang_m + GAP_M / 2
                slots.append(Slot(m.id, v, (px, py, 0.0)))
            groups.append(Group(m.id, (x, y), group_w, sd + LABEL_DEPTH_M))
            x += group_w + GAP_M
            row_depth = max(row_depth, sd + LABEL_DEPTH_M)
        sheet_w = max(sheet_w, x - GAP_M)
        y += row_depth + GAP_M + row_h * height_gap
    last_gap = GAP_M + row_h * height_gap
    return slots, groups, (sheet_w, max(0.0, y - last_gap))
