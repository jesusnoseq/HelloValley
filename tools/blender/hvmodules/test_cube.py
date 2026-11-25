"""``test.cube``: a 1 m soft cube used to check the pipeline end to end (M04 acceptance).

Style-neutral and test-only: build it with ``--modules test.cube``.
"""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.grid import CELL_M, Footprint
from hvkit.module import Module, Socket, register
from hvkit.variants import VariantRng


@register
class TestCube(Module):
    id = "test.cube"
    footprint = Footprint(w=1, d=1, h=CELL_M)
    sockets = (
        Socket("top", "stack", (0.5, 0.5, 1.0), (0.0, 0.0, 1.0)),
        Socket("front", "attach", (0.5, 0.0, 0.5), (0.0, -1.0, 0.0)),
    )
    variants = 3
    styles = None
    tags = ("test",)
    test = True
    tri_budget = (12, 600)

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        walls = style.palette["walls"]
        return {
            "swatch": variant % len(walls),
            "radius": round(rng.uniform(0.03, 0.08), 3),
            "tile": ("plaster", "wood", "stone")[variant % 3],
        }

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        builder = ctx.builder(self, variant, rng)
        paint = ctx.paint("walls", params["swatch"], tile=params["tile"])
        builder.rounded_box((0.0, 0.0, 0.0), (1.0, 1.0, 1.0), paint, radius=params["radius"], segments=2)
        return [builder.to_object(ctx.collection)]
