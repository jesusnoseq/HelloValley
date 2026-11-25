"""River pieces, the stone bridge, the wooden fishing dock and the fountain.

River banks follow the marching-squares convention in ``base`` with water as the feature:
``bank.straight`` (water on the front half), ``bank.outer`` (water only in a quarter disc
around the front-left corner), ``bank.inner`` (land only in a quarter disc around the
back-right corner), the 2 x 2 bends ``bank.curve_outer`` (water inside a 1.5 m arc around the
front-left corner) and ``bank.curve_inner`` (land inside a 1.5 m arc around the back-right
corner), and ``bank.water`` (open river). The land is a height field that slopes from the
grass top (``GROUND_Z``) down to the bed (``BED_Z``); the water surface (``WATER_Z``) is a
separate mesh with the ``water`` material and ``hv_part: water`` (river shader TODO(M12)).
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Tuple

from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import BED_Z, GROUND_Z, SINK_M, WATER_Z, CommonModule, pick, scatter, smoothstep

GRID_PER_M = 8
"""Height-field resolution of the bank pieces (lines per metre); every piece uses the same
one so neighbouring pieces share their seam vertices."""
LAND_BAND = 0.25
"""Distance from the shoreline (inland) where the bank starts to fall."""
BED_BAND = 0.3
"""Distance from the shoreline (out into the water) where the bed is reached."""

BANK_KINDS: Dict[str, Tuple[int, Callable[[float, float], float]]] = {
    # kind: (cells per side, signed distance to the shoreline, positive on land)
    "straight": (1, lambda x, y: y - 0.5),
    "outer": (1, lambda x, y: math.hypot(x, y) - 0.5),
    "inner": (1, lambda x, y: 0.5 - math.hypot(1.0 - x, 1.0 - y)),
    "curve_outer": (2, lambda x, y: math.hypot(x, y) - 1.5),
    "curve_inner": (2, lambda x, y: 1.5 - math.hypot(2.0 - x, 2.0 - y)),
    "water": (1, lambda x, y: -1.0),
}


def bank_height(d: float) -> float:
    """Ground height at signed shoreline distance ``d``: flat grass inland, a soft S-curve down
    to the bed in the water."""
    t = (d + BED_BAND) / (LAND_BAND + BED_BAND)
    return BED_Z + (GROUND_Z - BED_Z) * smoothstep(t)


def bank_lines(cells: int) -> List[float]:
    n = GRID_PER_M * cells
    return [round(cells * i / n, 6) for i in range(n + 1)]


def bank_band(z: float) -> str:
    """Palette band of a bank vertex by height: grass on top, earth on the slope, bed below."""
    if z >= GROUND_Z - 0.02:
        return "grass"
    if z > WATER_Z + 0.04:
        return "earth"
    return "bed"


class Bank(CommonModule):
    kind = "straight"
    sink_m = SINK_M

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return {
            "grass": pick(rng, (0, 1, 2), variant) % len(style.palette["grass"]),
            "deco": pick(rng, ("pebbles", "reeds", "rocks"), variant),
            "seed": rng.randint(0, 9999),
        }

    def distance(self, x: float, y: float) -> float:
        return BANK_KINDS[self.kind][1](x, y)

    def height(self, x: float, y: float) -> float:
        return bank_height(self.distance(x, y))

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        cells = BANK_KINDS[self.kind][0]
        xs = bank_lines(cells)
        verts, faces, _ = solids.heightfield(xs, xs, self.height)
        colours = {
            "grass": ctx.style.linear("grass", params["grass"]),
            "earth": ctx.style.linear("earth", 0),
            "bed": ctx.style.linear("bed", 0),
        }
        land = ctx.builder(self, variant, rng, "land")
        paint = ctx.paint("grass", params["grass"], tile="grass")
        land.solid((verts, faces), paint, bevel=0.0, noise=0.0, smooth=True, colors=[colours[bank_band(v[2])] for v in verts])
        deco = VariantRng(params["seed"])
        self._decorate(ctx, land, params["deco"], deco, cells)
        objects = [land.to_object(ctx.collection, part="land")]

        heights = {(i, j): self.height(xs[i], xs[j]) for i in range(len(xs)) for j in range(len(xs))}

        def wet(i: int, j: int) -> bool:
            return min(heights[(i + a, j + c)] for a in (0, 1) for c in (0, 1)) < WATER_Z + 0.01

        wverts, wfaces, _ = solids.heightfield(xs, xs, lambda x, y: WATER_Z, keep=wet)
        if wfaces:
            water = ctx.builder(self, variant, rng, "water")
            water.solid((wverts, wfaces), ctx.paint("water", 0, tile="plain", material="water"), bevel=0.0, noise=0.0)
            objects.append(water.to_object(ctx.collection, part="water"))
        return objects

    def _decorate(self, ctx, b, deco: str, rng: VariantRng, cells: int) -> None:
        size = float(cells)
        hi = (size - 0.08, size - 0.08)
        if self.kind == "water":
            self._decorate_open(ctx, b, deco, rng)
            return
        if deco == "reeds":
            reed = ctx.paint("foliage", 3, tile="leaves")
            spots = scatter(rng, 5 * cells, lambda x, y: -0.12 < self.distance(x, y) < 0.06, (0.08, 0.08), hi, 0.12)
            for x, y in spots:
                z = self.height(x, y) - 0.03
                for dx, dy, h in ((0.0, 0.0, 0.42), (0.03, 0.02, 0.32), (-0.025, 0.025, 0.36)):
                    b.cylinder((x + dx, y + dy, z), 0.012, h + rng.uniform(-0.05, 0.05), reed, sides=3, radius_top=0.0, bevel=0.0, noise=0.0)
                b.cylinder((x, y, z + 0.3), 0.02, 0.09, ctx.paint("bark", 0, tile="bark"), sides=5, bevel=0.0, noise=0.0)
        elif deco == "rocks":
            stone = ctx.paint("stone", 1, tile="stone")
            spots = scatter(rng, 3 * cells, lambda x, y: -0.2 < self.distance(x, y) < 0.15, (0.12, 0.12), (size - 0.12, size - 0.12), 0.25)
            for x, y in spots:
                r = rng.uniform(0.07, 0.12)
                b.blob((x, y, self.height(x, y)), r, stone, scale=(1.2, 1.0, 0.7), wobble=0.15, smooth=False, flatten_below=BED_Z)
        else:
            pebble = ctx.paint("stone", 2, tile="stone")
            spots = scatter(rng, 6 * cells, lambda x, y: -0.25 < self.distance(x, y) < 0.0, (0.06, 0.06), (size - 0.06, size - 0.06), 0.1)
            for x, y in spots:
                b.blob((x, y, self.height(x, y)), rng.uniform(0.025, 0.045), pebble, scale=(1.3, 1.0, 0.5), wobble=0.12, smooth=False, flatten_below=BED_Z)


    def _decorate_open(self, ctx, b, deco: str, rng: VariantRng) -> None:
        """Open water: bed stones, lily pads or a boulder breaking the surface."""
        anywhere = lambda x, y: True  # noqa: E731
        if deco == "reeds":
            pad = ctx.paint("foliage", 1, tile="leaves")
            for x, y in scatter(rng, 4, anywhere, (0.15, 0.15), (0.85, 0.85), 0.22):
                b.cylinder((x, y, WATER_Z + 0.005), rng.uniform(0.07, 0.11), 0.015, pad, sides=8, bevel=0.0, noise=0.0)
                if rng.chance(0.5):
                    b.blob((x + 0.03, y, WATER_Z + 0.04), 0.025, ctx.paint("blossom", 0, tile="plain"), wobble=0.0)
        elif deco == "rocks":
            stone = ctx.paint("stone", 1, tile="stone")
            for x, y in scatter(rng, 2, anywhere, (0.3, 0.3), (0.7, 0.7), 0.25):
                b.blob((x, y, BED_Z + 0.1), rng.uniform(0.16, 0.2), stone, scale=(1.2, 1.0, 1.9), wobble=0.15, smooth=False, flatten_below=BED_Z)
        else:
            pebble = ctx.paint("stone", 2, tile="stone")
            for x, y in scatter(rng, 6, anywhere, (0.1, 0.1), (0.9, 0.9), 0.15):
                b.blob((x, y, BED_Z), rng.uniform(0.04, 0.07), pebble, scale=(1.3, 1.0, 0.6), wobble=0.12, smooth=False, flatten_below=BED_Z)


def _make_bank(kind: str) -> type:
    cells = BANK_KINDS[kind][0]
    attrs = {
        "id": f"bank.{kind}",
        "kind": kind,
        "footprint": Footprint(w=cells, d=cells, h=1.0),
        "tags": ("water", "river", "bank", kind),
        "sockets": (),
        "__module__": __name__,
        "__doc__": f"River bank piece: {kind}.",
    }
    return register(type("Bank" + kind.title().replace("_", ""), (Bank,), attrs))


BANK_CLASSES = [_make_bank(k) for k in BANK_KINDS]
BANK_IDS = tuple(c.id for c in BANK_CLASSES)


# --- stone bridge ----------------------------------------------------------------------------

BRIDGE_W = 2
BRIDGE_D = 4
ARCH_Y = (0.95, 3.05)
"""The arch opening spans the river between the abutments."""
ARCH_SPRING_Z = -0.2
ARCH_RISE = 0.6
DECK_CROWN = 0.55
"""How far the deck rises above the ground at mid-span."""


def deck_z(y: float) -> float:
    """Top of the bridge deck along the span: ground level at both ends, a gentle hump."""
    t = (y - BRIDGE_D / 2) / (BRIDGE_D / 2)
    return GROUND_Z + DECK_CROWN * (1.0 - t * t)


def arch_z(y: float) -> float:
    """Underside of the arch (half ellipse) inside ``ARCH_Y``."""
    half = (ARCH_Y[1] - ARCH_Y[0]) / 2
    t = (y - (ARCH_Y[0] + half)) / half
    return ARCH_SPRING_Z + ARCH_RISE * math.sqrt(max(0.0, 1.0 - t * t))


def bridge_profile(segments: int = 10) -> List[Tuple[float, float]]:
    """Side elevation (y, z) of the bridge body: deck on top, arch below, footings in the bed."""
    top = [(BRIDGE_D * i / segments, deck_z(BRIDGE_D * i / segments)) for i in range(segments + 1)]
    a0, a1 = ARCH_Y
    arch = [(a0 + (a1 - a0) * i / segments, arch_z(a0 + (a1 - a0) * i / segments)) for i in range(segments + 1)]
    bottom = [(0.0, 0.0), (0.55, 0.0), (0.75, BED_Z), (a0, BED_Z), (a0, ARCH_SPRING_Z)] + arch[1:-1]
    bottom += [(a1, ARCH_SPRING_Z), (a1, BED_Z), (BRIDGE_D - 0.75, BED_Z), (BRIDGE_D - 0.55, 0.0), (BRIDGE_D, 0.0)]
    return bottom + list(reversed(top))


@register
class BridgeStone(CommonModule):
    """A humped stone bridge, 2 cells wide, spanning 4 cells front to back (y). The river runs
    along x under the arch (``ARCH_Y``); the deck meets the ground at both ends."""

    id = "bridge.stone"
    footprint = Footprint(w=BRIDGE_W, d=BRIDGE_D, h=1.2)
    sink_m = SINK_M
    tags = ("water", "bridge", "walkable")
    sockets = (
        Socket("front", "edge", (1.0, 0.0, GROUND_Z), (0.0, -1.0, 0.0)),
        Socket("back", "edge", (1.0, float(BRIDGE_D), GROUND_Z), (0.0, 1.0, 0.0)),
        Socket("crown", "prop", (1.0, BRIDGE_D / 2, GROUND_Z + DECK_CROWN), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "stone": pick(rng, (0, 1, 2), variant),
            "parapet": pick(rng, ("wall", "posts", "wall"), variant),
            "moss": variant == 2,
            "deck": pick(rng, ("cobble", "cobble", "path"), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        stone = ctx.paint("stone", params["stone"], tile="stone")
        trim = ctx.paint("stone", (params["stone"] + 1) % 3, tile="stone")
        prof = bridge_profile()
        b.solid(solids.prism(prof, "x", 0.12, BRIDGE_W - 0.12, slices=2), stone, bevel=0.0)
        # Voussoir rings, a little proud of each face.
        a0, a1 = ARCH_Y
        n = 9
        for xa, xb in ((0.08, 0.12), (BRIDGE_W - 0.12, BRIDGE_W - 0.08)):
            for i in range(n):
                ya = a0 + (a1 - a0) * i / n
                yb = a0 + (a1 - a0) * (i + 1) / n
                ring = [(ya, arch_z(ya)), (yb, arch_z(yb)), (yb, arch_z(yb) + 0.16), (ya, arch_z(ya) + 0.16)]
                b.solid(solids.prism(ring, "x", xa, xb), trim if i % 2 else stone, bevel=0.0)
        # Deck surface between the parapets.
        group, tile = ("cobble", "cobble") if params["deck"] == "cobble" else ("path", "dirt")
        deck = ctx.paint(group, 0, tile=tile)
        steps = 10
        band = [(BRIDGE_D * i / steps, deck_z(BRIDGE_D * i / steps)) for i in range(steps + 1)]
        surface = band + [(y, z + 0.03) for y, z in reversed(band)]
        b.solid(solids.prism(surface, "x", 0.22, BRIDGE_W - 0.22, slices=1), deck, bevel=0.0, noise=0.0)
        # Parapets along both sides.
        for xa, xb in ((0.0, 0.22), (BRIDGE_W - 0.22, BRIDGE_W)):
            if params["parapet"] == "wall":
                lo = [(y, z - 0.25) for y, z in band]
                hi = [(y, z + 0.42) for y, z in reversed(band)]
                b.solid(solids.prism(lo + hi, "x", xa, xb), stone, bevel=0.02, segments=1)
                cap = [(y, z + 0.42) for y, z in band] + [(y, z + 0.48) for y, z in reversed(band)]
                b.solid(solids.prism(cap, "x", xa - 0.02 if xa > 0 else xa, xb + 0.02 if xb < BRIDGE_W else xb), trim, bevel=0.0)
            else:
                lo = [(y, z - 0.25) for y, z in band]
                hi = [(y, z + 0.1) for y, z in reversed(band)]
                b.solid(solids.prism(lo + hi, "x", xa, xb), stone, bevel=0.02, segments=1)
                for i in range(0, steps + 1, 2):
                    y = min(max(BRIDGE_D * i / steps, 0.08), BRIDGE_D - 0.08)
                    z = deck_z(y)
                    b.box((xa + 0.03, y - 0.07, z + 0.1), (xb - 0.03, y + 0.07, z + 0.5), trim, bevel=0.02, segments=1)
                rail = [(y, z + 0.42) for y, z in band] + [(y, z + 0.5) for y, z in reversed(band)]
                b.solid(solids.prism(rail, "x", xa + 0.02, xb - 0.02), trim, bevel=0.0)
        if params["moss"]:
            moss = ctx.paint("foliage", 3, tile="leaves")
            for y in (a0 + 0.1, a1 - 0.1):
                for x in (0.1, BRIDGE_W - 0.1):
                    b.blob((x, y, ARCH_SPRING_Z + 0.1), 0.1, moss, scale=(0.6, 1.4, 0.8), wobble=0.15)
        return [b.to_object(ctx.collection)]


# --- fishing dock ------------------------------------------------------------------------------

DOCK_W = 2
DOCK_D = 3
DECK_Z = 0.2


@register
class DockFishing(CommonModule):
    """A wooden fishing dock, 2 x 3 cells. The back (y = 3) rests on the bank; the deck runs out
    over the water to the front, where ``fish`` is the casting spot (the Elder's place)."""

    id = "dock.fishing"
    footprint = Footprint(w=DOCK_W, d=DOCK_D, h=1.3)
    sink_m = SINK_M
    max_overhang_m = 0.05
    tags = ("water", "dock", "walkable", "fishing")
    sockets = (
        Socket("land", "edge", (1.0, float(DOCK_D), GROUND_Z), (0.0, 1.0, 0.0)),
        Socket("fish", "prop", (1.0, 0.25, DECK_Z), (0.0, -1.0, 0.0)),
        Socket("seat", "prop", (0.35, 0.3, DECK_Z), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "wood": pick(rng, (0, 1, 2), variant),
            "extra": pick(rng, ("bollards", "lantern", "crates"), variant),
            "planks": rng.randint(10, 12),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        dark = ctx.paint("darkwood", 0, tile="wood")
        n = params["planks"]
        step = DOCK_D / n
        for i in range(n):
            ya, yb = i * step + 0.01, (i + 1) * step - 0.01
            dx = rng.jitter(0.03)
            b.box((0.05 + dx, ya, DECK_Z - 0.05), (DOCK_W - 0.05 + dx, yb, DECK_Z), wood, bevel=0.012, segments=1, noise=0.008)
        for x in (0.15, DOCK_W - 0.15):
            b.box((x - 0.06, 0.0, DECK_Z - 0.14), (x + 0.06, DOCK_D, DECK_Z - 0.05), dark, bevel=0.01, segments=1, seams=("y",))
            for y in (0.12, DOCK_D / 2, DOCK_D - 0.3):
                top = DECK_Z + (0.18 if params["extra"] == "bollards" and y < 1 else -0.02)
                b.cylinder((x, y, BED_Z), 0.08, top - BED_Z, dark, sides=8, bevel=0.0)
        if params["extra"] == "bollards":
            rope = ctx.paint("fabric", 3, tile="plain")
            for x in (0.15, DOCK_W - 0.15):
                b.cylinder((x, 0.12, DECK_Z + 0.08), 0.095, 0.04, rope, sides=8, bevel=0.0)
        elif params["extra"] == "lantern":
            b.box((DOCK_W - 0.2, 0.25, DECK_Z), (DOCK_W - 0.12, 0.33, DECK_Z + 1.0), dark, bevel=0.01, segments=1)
            b.box((DOCK_W - 0.4, 0.27, DECK_Z + 0.95), (DOCK_W - 0.12, 0.31, DECK_Z + 1.0), dark, bevel=0.0)
            glow = ctx.paint("light", 0, tile="plain", material="glow")
            iron = ctx.paint("iron", 0, tile="plain")
            b.box((DOCK_W - 0.37, 0.24, DECK_Z + 0.68), (DOCK_W - 0.23, 0.34, DECK_Z + 0.86), glow, bevel=0.0, noise=0.0)
            b.box((DOCK_W - 0.39, 0.22, DECK_Z + 0.86), (DOCK_W - 0.21, 0.36, DECK_Z + 0.9), iron, bevel=0.0)
        else:
            crate = ctx.paint("wood", (params["wood"] + 1) % 3, tile="wood")
            b.box((DOCK_W - 0.6, DOCK_D - 0.9, DECK_Z), (DOCK_W - 0.15, DOCK_D - 0.45, DECK_Z + 0.4), crate, bevel=0.02, segments=1)
            b.cylinder((0.45, DOCK_D - 0.7, DECK_Z), 0.2, 0.08, ctx.paint("fabric", 3, tile="plain"), sides=10, bevel=0.0)
        # A short ladder down to the water at the front.
        for x in (DOCK_W / 2 - 0.22, DOCK_W / 2 + 0.22):
            b.box((x - 0.025, 0.0, WATER_Z - 0.1), (x + 0.025, 0.05, DECK_Z + 0.1), dark, bevel=0.0)
        for z in (WATER_Z + 0.05, 0.0, DECK_Z - 0.08):
            b.box((DOCK_W / 2 - 0.22, 0.0, z), (DOCK_W / 2 + 0.22, 0.04, z + 0.03), dark, bevel=0.0)
        return [b.to_object(ctx.collection)]


# --- fountain ----------------------------------------------------------------------------------


@register
class Fountain(CommonModule):
    """A 2 x 2 town-square fountain: a stone basin with a central column and one or two bowls.
    The water surfaces are a separate ``water`` mesh."""

    id = "fountain"
    footprint = Footprint(w=2, d=2, h=2.0)
    tags = ("prop", "water", "square")
    sockets = (
        Socket("center", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        Socket("rim_front", "prop", (1.0, 0.12, 0.45), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "basin": pick(rng, ("round", "octagon", "round"), variant),
            "tiers": pick(rng, (2, 1, 1), variant),
            "stone": pick(rng, (0, 1, 2), variant),
            "top": pick(rng, ("spout", "ball", "flowers"), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        w = ctx.builder(self, variant, rng, "water")
        stone = ctx.paint("stone", params["stone"], tile="stone")
        trim = ctx.paint("stone", (params["stone"] + 1) % 3, tile="stone")
        water = ctx.paint("water", 0, tile="plain", material="water")
        c = (1.0, 1.0)
        sides = 16 if params["basin"] == "round" else 8
        r = 0.95
        b.cylinder((c[0], c[1], 0.0), r, 0.42, stone, sides=sides, bevel=0.03)
        b.cylinder((c[0], c[1], 0.42), r - 0.02, 0.05, trim, sides=sides, radius_top=r - 0.06, bevel=0.0)
        w.cylinder((c[0], c[1], 0.3), r - 0.12, 0.12, water, sides=sides, bevel=0.0, noise=0.0)
        b.cylinder((c[0], c[1], 0.3), 0.16, 0.12, trim, sides=8, radius_top=0.13, bevel=0.0)
        z = 0.42
        col_h = 0.6 if params["tiers"] == 2 else 0.75
        b.cylinder((c[0], c[1], z), 0.11, col_h, stone, sides=8, radius_top=0.08, bevel=0.0)
        z += col_h
        bowl_r = 0.48
        b.cylinder((c[0], c[1], z - 0.12), 0.1, 0.12, trim, sides=10, radius_top=bowl_r, bevel=0.0)
        b.cylinder((c[0], c[1], z), bowl_r, 0.06, trim, sides=12, bevel=0.0)
        w.cylinder((c[0], c[1], z + 0.02), bowl_r - 0.06, 0.05, water, sides=12, bevel=0.0, noise=0.0)
        z += 0.06
        if params["tiers"] == 2:
            b.cylinder((c[0], c[1], z), 0.07, 0.35, stone, sides=8, radius_top=0.05, bevel=0.0)
            z += 0.35
            b.cylinder((c[0], c[1], z - 0.08), 0.06, 0.08, trim, sides=10, radius_top=0.26, bevel=0.0)
            b.cylinder((c[0], c[1], z), 0.26, 0.05, trim, sides=10, bevel=0.0)
            w.cylinder((c[0], c[1], z + 0.02), 0.21, 0.04, water, sides=10, bevel=0.0, noise=0.0)
            z += 0.05
        if params["top"] == "spout":
            b.cylinder((c[0], c[1], z), 0.05, 0.16, trim, sides=8, radius_top=0.03, bevel=0.0)
            w.blob((c[0], c[1], z + 0.2), 0.06, water, scale=(1.0, 1.0, 1.4), wobble=0.0)
        elif params["top"] == "ball":
            b.blob((c[0], c[1], z + 0.13), 0.13, trim, subdivisions=2, wobble=0.0)
        else:
            flowers = [ctx.paint("flowers", i, tile="plain") for i in range(3)]
            for k in range(6):
                a = 2 * math.pi * k / 6
                b.blob((c[0] + 0.3 * math.cos(a), c[1] + 0.3 * math.sin(a), z + 0.05), 0.06, flowers[k % 3], wobble=0.1)
        return [b.to_object(ctx.collection), w.to_object(ctx.collection, part="water")]


WATER_IDS = BANK_IDS + ("bridge.stone", "dock.fishing", "fountain")
