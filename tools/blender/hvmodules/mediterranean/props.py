"""Mediterranean street props: stair, fence, lamp, bench, tile.cobble. They stand on the ground
(z = 0) with the front at y = 0, with the European footprints and sockets, and stay inside the
European walking blockers (``packages/shared/src/world/props.ts``; a client test checks it)."""

from __future__ import annotations

import math
from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.props import Lamp as EuropeLamp

from .common import MedModule, mirror, pick


@register
@mirror
class Stair(MedModule):
    """Three whitewashed steps: terracotta treads between stucco cheeks with a pot, plain
    stone steps with an iron rail, or white steps with blue-painted risers."""

    id = "stair"
    RISE = 0.15
    STEPS = 3

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("cheeks", "rail", "painted"), variant), "pot": rng.randint(0, 2)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        n, rise = self.STEPS, self.RISE
        tread = 1.0 / n
        kind = params["kind"]
        x0, x1 = (0.12, 0.88) if kind == "cheeks" else (0.0, 1.0)
        body = ctx.paint("ground", 1, tile="paving") if kind == "rail" else ctx.paint("trims", 0, tile="stucco")
        band = 0.012 if kind == "painted" else 0.0
        for k in range(n):
            b.box((x0, k * tread + band, 0.0), (x1, 1.0, (k + 1) * rise), body, bevel=0.02, segments=1, seams=("x", "y+", "z-"))
            if kind == "cheeks":
                clay = ctx.paint("roofs", 1, tile="terracotta")
                b.box((x0 + 0.01, k * tread, (k + 1) * rise), (x1 - 0.01, k * tread + tread * 0.98, (k + 1) * rise + 0.025), clay, bevel=0.0)
            elif kind == "painted":
                blue = ctx.paint("accents", 0, tile="stucco")
                b.box((x0, k * tread, k * rise + 0.02), (x1, k * tread + band + 0.001, (k + 1) * rise - 0.02), blue, bevel=0.0, seams=("x", "y-"))
        if kind == "cheeks":
            wall = ctx.paint("walls", 0, tile="stucco")
            prof = [(0.0, 0.0), (1.0, 0.0), (1.0, n * rise + 0.2), (0.0, rise + 0.1)]
            for xa in (0.0, 0.88):
                b.solid(solids.prism(prof, "x", xa, xa + 0.12, slices=1), wall, bevel=0.02, segments=1, seams=("x", "z-"))
            pot = ctx.paint("pot", params["pot"], tile="terracotta")
            leaf = ctx.paint("foliage", 0, tile="plain")
            b.cylinder((0.07, 0.85, n * rise + 0.17), 0.04, 0.12, pot, sides=8, radius_top=0.05, bevel=0.0)
            b.blob((0.07, 0.85, n * rise + 0.34), 0.055, leaf, subdivisions=1, wobble=0.1)
            b.blob((0.08, 0.82, n * rise + 0.4), 0.03, ctx.paint("flowers", 0, tile="plain"), subdivisions=1, wobble=0.05)
        elif kind == "rail":
            iron = ctx.paint("iron", 0, tile="plain")
            for x in (0.06, 0.94):
                for k in (0, n - 1):
                    y = (k + 0.5) * tread
                    b.box((x - 0.015, y - 0.015, (k + 1) * rise), (x + 0.015, y + 0.015, (k + 1) * rise + 0.85), iron, bevel=0.0)
                y_a, y_b = 0.5 * tread, (n - 0.5) * tread
                prof = solids.beam_profile((y_a - 0.05, rise + 0.85), (y_b + 0.05, n * rise + 0.85), 0.035)
                b.solid(solids.prism(prof, "x", x - 0.02, x + 0.02), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Fence(MedModule):
    """One metre of boundary along the front edge: a low whitewashed wall with a terracotta
    coping, an iron railing on a stucco base, or a cane (reed) fence."""

    id = "fence"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("wall", "railing", "cane"), variant), "reeds": [round(rng.uniform(0.82, 0.95), 3) for _ in range(9)]}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        style = params["style"]
        if style == "wall":
            wall = ctx.paint("trims", 0, tile="stucco")
            b.box((0.0, 0.0, 0.0), (1.0, 0.13, 0.7), wall, bevel=0.03, segments=1, seams=("x", "z-"))
            clay = ctx.paint("roofs", 0, tile="terracotta")
            b.box((0.0, 0.0, 0.7), (1.0, 0.14, 0.76), clay, bevel=0.0, seams=("x", "y-"))
            b.box((0.0, 0.03, 0.76), (1.0, 0.11, 0.8), clay, bevel=0.0, seams=("x",))
        elif style == "railing":
            base = ctx.paint("walls", 1, tile="stucco")
            b.box((0.0, 0.0, 0.0), (1.0, 0.13, 0.35), base, bevel=0.025, segments=1, seams=("x", "z-"))
            cap = ctx.paint("trims", 0, tile="stucco")
            b.box((0.0, 0.0, 0.35), (1.0, 0.135, 0.39), cap, bevel=0.0, seams=("x", "y-"))
            iron = ctx.paint("iron", 0, tile="plain")
            b.box((0.0, 0.055, 0.86), (1.0, 0.075, 0.89), iron, bevel=0.0, seams=("x",))
            for i in range(8):
                x = 0.0625 + i * 0.125
                b.box((x - 0.009, 0.056, 0.39), (x + 0.009, 0.074, 0.86), iron, bevel=0.0)
            for i in range(4):
                x = 0.125 + i * 0.25
                ring = [(x + 0.04 * math.cos(a), 0.7 + 0.04 * math.sin(a)) for a in (k * math.pi / 3 for k in range(6))]
                from hvkit import solids

                b.solid(solids.prism(ring, "y", 0.058, 0.072), iron, bevel=0.0)
        else:
            reed = ctx.paint("trims", 2, tile="timber")
            tie = ctx.paint("trims", 1, tile="timber")
            b.box((0.0, 0.02, 0.0), (0.06, 0.1, 0.95), tie, bevel=0.012, segments=1, seams=("x-", "z-"))
            for i, h in enumerate(params["reeds"]):
                x = 0.1 + i * 0.1
                b.cylinder((x, 0.06, 0.0), 0.04, h, reed, sides=6, bevel=0.0)
            for z in (0.25, 0.7):
                b.box((0.06, 0.005, z), (1.0, 0.025, z + 0.04), tie, bevel=0.0, seams=("x+",))
        return [b.to_object(ctx.collection)]


@register
@mirror
class Lamp(EuropeLamp, MedModule):
    """Wrought-iron street lantern (farol): the European post, hook and double lamps, in this
    kit's iron colours. ``light`` is where the client puts the point light."""

    id = "lamp"
    styles = MedModule.styles

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("hook", "post", "double"), variant), "iron": pick(rng, (1, 0, 1), variant)}


@register
@mirror
class Bench(MedModule):
    """Two-seat bench (2 cells): a whitewashed masonry bench with a painted-tile back, wooden
    slats on stucco ends, or a sandstone slab bench."""

    id = "bench"
    SEAT_Z = 0.45

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("tiled", "slats", "stone"), variant), "tiles": pick(rng, (1, 2, 1), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        x0, x1 = 0.16, 1.84
        z = self.SEAT_Z
        kind = params["kind"]
        if kind == "tiled":
            wall = ctx.paint("trims", 0, tile="stucco")
            b.box((x0, 0.3, 0.0), (x1, 0.72, z - 0.04), wall, bevel=0.03, segments=1, seams=("z-",))
            seat = ctx.paint("roofs", 1, tile="terracotta")
            b.box((x0 - 0.01, 0.28, z - 0.04), (x1 + 0.01, 0.74, z), seat, bevel=0.012, segments=1)
            b.box((x0, 0.72, 0.0), (x1, 0.8, 0.88), wall, bevel=0.03, segments=1, seams=("z-",))
            for i in range(6):
                xa = x0 + 0.06 + i * 0.26
                tile = ctx.paint("ceramic", params["tiles"] if i % 2 == 0 else 0, tile="plain")
                b.box((xa, 0.714, z + 0.06), (xa + 0.24, 0.72, z + 0.36), tile, bevel=0.0, noise=0.0)
            for xa in (x0 + 0.04, x1 - 0.2):
                b.box((xa, 0.3, 0.06), (xa + 0.16, 0.302, 0.32), ctx.paint("ceramic", params["tiles"], tile="plain"), bevel=0.0, noise=0.0)
        elif kind == "slats":
            wall = ctx.paint("walls", 1, tile="stucco")
            for xa in (x0, x1 - 0.14):
                b.box((xa, 0.3, 0.0), (xa + 0.14, 0.78, z + 0.18), wall, bevel=0.03, segments=1, seams=("z-",))
            wood = ctx.paint("trims", 1, tile="wood")
            for ya, yb in ((0.32, 0.44), (0.46, 0.58), (0.6, 0.72)):
                b.box((x0 + 0.14, ya + rng.jitter(0.004), z - 0.05), (x1 - 0.14, yb, z), wood, bevel=0.01, segments=1)
            b.box((x0 + 0.14, 0.7, z + 0.1), (x1 - 0.14, 0.76, z + 0.36), wood, bevel=0.01, segments=1)
        else:
            stone = ctx.paint("trims", 2, tile="stone")
            for xa in (x0 + 0.1, x1 - 0.28):
                b.box((xa, 0.34, 0.0), (xa + 0.18, 0.66, z - 0.08), stone, bevel=0.02, segments=1, seams=("z-",))
            b.box((x0, 0.3, z - 0.08), (x1, 0.7, z), stone, bevel=0.025, segments=2)
        return [b.to_object(ctx.collection)]


@register
@mirror
class TileCobble(MedModule):
    """1 x 1 m paving: large terracotta floor tiles, a black-and-white pebble mosaic, or
    sun-bleached flagstones. Edges stay sharp so tiles pave seamlessly."""

    id = "tile.cobble"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("terracotta", "pebbles", "flags"), variant),
            "turn": round(rng.uniform(0.0, 1.0), 3),
            "cuts": [round(rng.uniform(0.38, 0.62), 3) for _ in range(2)],
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        kind = params["kind"]
        grid = [0.0, 1 / 3, 2 / 3, 1.0]
        base = ctx.paint("ground", 2 if kind == "pebbles" else 1, tile="paving")
        b.solid(solids.swap_yz(solids.grid_panel(grid, grid, [], 0.0, 0.05)), base, bevel=0.0)
        if kind == "terracotta":
            clay = [ctx.paint("roofs", i, tile="terracotta") for i in (1, 0)]
            g = 0.012
            for i in range(2):
                for j in range(2):
                    lo = (i * 0.5 + g, j * 0.5 + g, 0.04)
                    hi = ((i + 1) * 0.5 - g, (j + 1) * 0.5 - g, 0.065)
                    b.box(lo, hi, clay[(i + j) % 2], bevel=0.006, segments=1)
        elif kind == "pebbles":
            dark = ctx.paint("iron", 1, tile="paving")
            light = ctx.paint("ground", 0, tile="paving")
            # A compass-rose star of dark pebbles on light ones.
            for k in range(8):
                a = 2 * math.pi * k / 8 + params["turn"] * 0.2
                r = 0.18 if k % 2 == 0 else 0.3
                cx, cy = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a)
                b.box((cx - 0.045, cy - 0.045, 0.04), (cx + 0.045, cy + 0.045, 0.06), dark, bevel=0.0)
            for x, y in ((0.12, 0.12), (0.88, 0.12), (0.12, 0.88), (0.88, 0.88), (0.5, 0.5)):
                b.box((x - 0.06, y - 0.06, 0.04), (x + 0.06, y + 0.06, 0.058), light, bevel=0.0)
        else:
            stone = ctx.paint("ground", 0, tile="paving")
            cx, cy = params["cuts"]
            g = 0.015
            for lo, hi in (((g, g), (cx - g, cy - g)), ((cx + g, g), (1 - g, cy - g)), ((g, cy + g), (1 - g, 1 - g))):
                b.box((lo[0], lo[1], 0.04), (hi[0], hi[1], 0.07), stone, bevel=0.01, segments=1)
        return [b.to_object(ctx.collection)]
