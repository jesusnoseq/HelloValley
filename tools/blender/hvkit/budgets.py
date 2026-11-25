"""Triangle budgets per kit module (GDD §7.2), mirrored by ``KIT_TRI_BUDGETS`` and
``kitBudgetClass`` in packages/shared/src/assets/budgets.ts (a Python test keeps them equal).

- ``wall``: wall and corner modules, and interior wall panels (``iwall.*``), 150-600 triangles
  (GDD).
- ``tile``: ground and floor tiles (``tile.*``, ``terrain.*``, ``floor.*``). They repeat hundreds
  of times, so they get a tighter cap than the GDD's hero-prop limit.
- ``plant``: trees, bushes and flowers. They are instanced many times across the town.
- ``prop``: everything else (roofs, attachments, props, river pieces, furniture), up to 2k (GDD).
"""

from __future__ import annotations

from typing import Dict, Tuple

WALL_BUDGET = (150, 600)
TILE_BUDGET = (12, 400)
PLANT_BUDGET = (12, 1000)
PROP_BUDGET = (12, 2000)

BUDGETS: Dict[str, Tuple[int, int]] = {
    "wall": WALL_BUDGET,
    "tile": TILE_BUDGET,
    "plant": PLANT_BUDGET,
    "prop": PROP_BUDGET,
}

_FAMILY_CLASS = {
    "wall": "wall",
    "corner": "wall",
    "tile": "tile",
    "terrain": "tile",
    "floor": "tile",
    "iwall": "wall",
    "tree": "plant",
    "bush": "plant",
    "flowers": "plant",
}


def budget_class(module_id: str) -> str:
    return _FAMILY_CLASS.get(module_id.split(".", 1)[0], "prop")


def budget_for(module_id: str) -> Tuple[int, int]:
    """(min, max) triangles per variant for a module id."""
    return BUDGETS[budget_class(module_id)]
