"""Terrain tiles: grass, path, cobble and sand, plus marching-squares edge pieces where path,
cobble or sand meet grass (``terrain.<ground>.edge|outer|inner``). See ``base`` for the
edge convention. Tiles are 1 x 1 slabs standing on the pivot plane; their top is at
``GROUND_Z`` (grass) or a little lower (path, sand)."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import COBBLE_Z, GROUND_Z, PATH_Z, SAND_Z, CommonModule, Point, arc, pick, point_in_polygon, scatter

TILE_H = 0.25
"""Nominal tile height: room for grass tufts and pebbles above the slab."""
EDGE_KINDS = ("edge", "outer", "inner")
ARC_SEGMENTS = 9
"""Quarter arcs get 9 segments (10 degrees each), so their side walls stay unbevelled."""

# ground id -> (palette group, atlas tile, top height)
GROUNDS: Dict[str, Tuple[str, str, float]] = {
    "grass": ("grass", "grass", GROUND_Z),
    "path": ("path", "dirt", PATH_Z),
    "cobble": ("cobble", "cobble", COBBLE_Z),
    "sand": ("sand", "sand", SAND_Z),
}
FEATURES = ("path", "cobble", "sand")
"""Grounds that get edge pieces against grass."""


def regions(kind: str, wobble: float = 0.0, k: int = 1) -> Tuple[Optional[List[Point]], Optional[List[Point]]]:
    """(feature polygon, grass polygon) of a 1 x 1 cell for ``full`` (feature only), ``edge``,
    ``outer`` or ``inner`` (see ``base``). Both are counter-clockwise; the shared boundary
    meets the cell sides at their midpoints whatever the ``wobble``."""
    if kind == "full":
        return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], None
    if kind == "edge":
        # From x = 0 to x = 1 at y = 0.5, plus a wobble that is zero at both ends.
        n = ARC_SEGMENTS + 1
        line = [(round(i / n, 6), round(0.5 + wobble * math.sin(k * math.pi * i / n), 6)) for i in range(n + 1)]
        feature = [(0.0, 0.0), (1.0, 0.0)] + list(reversed(line))
        grass = list(line) + [(1.0, 1.0), (0.0, 1.0)]
        return feature, grass
    if kind == "outer":
        curve = arc(0.0, 0.0, 0.5, 0.0, math.pi / 2, ARC_SEGMENTS, wobble, k)  # (0.5, 0) .. (0, 0.5)
        feature = [(0.0, 0.0)] + curve
        grass = [curve[0], (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] + list(reversed(curve))[:-1]
        return feature, grass
    if kind == "inner":
        curve = arc(1.0, 1.0, 0.5, math.pi, 1.5 * math.pi, ARC_SEGMENTS, wobble, k)  # (0.5, 1) .. (1, 0.5)
        grass = [(1.0, 1.0)] + curve
        feature = [(0.0, 0.0), (1.0, 0.0)] + list(reversed(curve)) + [(0.0, 1.0)]
        return feature, grass
    raise ValueError(f"unknown terrain kind {kind!r}")


class TerrainTile(CommonModule):
    """Base for every terrain tile; subclasses set ``ground`` and ``kind``."""

    ground = "grass"
    kind = "full"
    footprint = Footprint(w=1, d=1, h=TILE_H)

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        group = GROUNDS[self.ground][0]
        params: Dict[str, Any] = {
            "swatch": pick(rng, (0, 1, 0), variant) % len(style.palette[group]),
            "deco": pick(rng, (2, 4, 6), variant),
            "seed": rng.randint(0, 9999),
        }
        if self.kind != "full":
            params["grass"] = pick(rng, (0, 1, 2), variant) % len(style.palette["grass"])
            params["wobble"] = pick(rng, (0.0, 0.035, 0.06), variant)
            params["k"] = pick(rng, (1, 2, 1), variant)
        return params

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        group, tile, top = GROUNDS[self.ground]
        paint = ctx.paint(group, params["swatch"], tile=tile)
        if self.kind == "full":
            grid = [0.0, 1 / 3, 2 / 3, 1.0]
            b.solid(solids.swap_yz(solids.grid_panel(grid, grid, [], 0.0, top)), paint, bevel=0.0, noise=0.0)
            square = regions("full")[0]
            feature, grass = (None, square) if self.ground == "grass" else (square, None)
        else:
            feature, grass = regions(self.kind, params["wobble"], params["k"])
            b.solid(solids.prism(feature, "z", 0.0, top), paint, bevel=0.0, noise=0.0)
            grass_paint = ctx.paint("grass", params["grass"], tile="grass")
            b.solid(solids.prism(grass, "z", 0.0, GROUND_Z), grass_paint, bevel=0.018, segments=1, noise=0.0, seams=("x", "y", "z-"))
        deco_rng = VariantRng(params["seed"])
        # Edge pieces split the decoration between both grounds to stay inside the tile budget.
        n = params["deco"] if self.kind == "full" else max(1, params["deco"] // 2)
        if grass is not None:
            self._tufts(ctx, b, grass, deco_rng, n)
        if feature is not None and self.ground != "grass":
            self._feature_deco(ctx, b, feature, top, deco_rng, n)
        return [b.to_object(ctx.collection)]

    def _inside(self, poly: Sequence[Point], margin: float = 0.07):
        def accept(x: float, y: float) -> bool:
            if not (margin <= x <= 1 - margin and margin <= y <= 1 - margin):
                return False
            # Keep clear of the boundary: all four nudged points must be inside too.
            return all(point_in_polygon((x + dx, y + dy), poly) for dx, dy in ((margin, 0), (-margin, 0), (0, margin), (0, -margin)))

        return accept

    def _tufts(self, ctx, b, poly: Sequence[Point], rng: VariantRng, n: int) -> None:
        dark = ctx.paint("grass", 1, tile="grass")
        for x, y in scatter(rng, n, self._inside(poly), min_gap=0.14):
            for dx, dy, h in ((0.0, 0.0, 0.11), (0.025, 0.012, 0.08), (-0.02, 0.02, 0.07)):
                b.cylinder((x + dx, y + dy, GROUND_Z - 0.01), 0.018, h + rng.uniform(-0.02, 0.02), dark, sides=3, radius_top=0.0, bevel=0.0, noise=0.0)
            if rng.chance(0.35):
                bloom = ctx.paint("flowers", rng.randint(0, 5), tile="plain")
                b.blob((x + 0.03, y - 0.03, GROUND_Z + 0.07), 0.022, bloom, wobble=0.0)

    def _feature_deco(self, ctx, b, poly: Sequence[Point], top: float, rng: VariantRng, n: int) -> None:
        accept = self._inside(poly)
        if self.ground == "cobble":
            stone = ctx.paint("cobble", 2, tile="stone")
            # Edge pieces line the whole square and road (about 160 in the town), so they get one
            # loose stone per decoration point instead of at least three (M12 triangle budget).
            count = min(max(3, n), 5) if self.kind == "full" else min(n, 3)
            for x, y in scatter(rng, count, accept, min_gap=0.16):
                sx, sy = rng.uniform(0.09, 0.14), rng.uniform(0.07, 0.11)
                b.box((x - sx / 2, y - sy / 2, top - 0.02), (x + sx / 2, y + sy / 2, top + 0.018), stone, bevel=0.012, segments=1)
            return
        group = "cobble" if self.ground == "path" else "sand"
        for x, y in scatter(rng, n, accept, min_gap=0.12):
            paint = ctx.paint(group, rng.randint(0, 2) if group == "cobble" else 1, tile="stone")
            r = rng.uniform(0.022, 0.04)
            b.blob((x, y, top), r, paint, scale=(1.3, 1.0, 0.55), wobble=0.12, smooth=False, flatten_below=top - 0.005)


def _make(ground: str, kind: str) -> type:
    mid = f"terrain.{ground}" if kind == "full" else f"terrain.{ground}.{kind}"
    top = GROUNDS[ground][2]
    attrs: Dict[str, Any] = {
        "id": mid,
        "ground": ground,
        "kind": kind,
        "tags": ("tile", "terrain", ground) + (() if kind == "full" else (kind, "grass")),
        "sockets": (Socket("top", "stack", (0.5, 0.5, top), (0.0, 0.0, 1.0)),) if kind == "full" else (),
        "__doc__": f"{ground} terrain tile" if kind == "full" else f"{ground} into grass: {kind} piece",
        "__module__": __name__,
    }
    name = "Terrain" + "".join(p.title() for p in mid.split(".")[1:])
    return register(type(name, (TerrainTile,), attrs))


TERRAIN_CLASSES = [_make(g, "full") for g in GROUNDS] + [_make(g, k) for g in FEATURES for k in EDGE_KINDS]
TERRAIN_IDS = tuple(c.id for c in TERRAIN_CLASSES)
