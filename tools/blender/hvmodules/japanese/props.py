"""Japanese street props: stair, fence (bamboo), lamp, bench, tile.cobble. They stand on the
ground (z = 0) with the front at y = 0, with the European footprints and sockets, and stay inside
the European walking blockers (``packages/shared/src/world/props.ts``; a test checks it)."""

from __future__ import annotations

import math
from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng

from .common import JapModule, mirror, pick


@register
@mirror
class Stair(JapModule):
    """Three steps: granite blocks, wooden steps between dark stringers with a short rail, or
    rough natural stones."""

    id = "stair"
    RISE = 0.15
    STEPS = 3

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("granite", "wood", "natural"), variant), "offsets": [round(rng.uniform(-0.04, 0.04), 3) for _ in range(3)]}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        n, rise = self.STEPS, self.RISE
        tread = 1.0 / n
        kind = params["kind"]
        if kind == "granite":
            stone = [ctx.paint("stone", i, tile="paving") for i in (0, 2)]
            for k in range(n):
                b.box((0.0, k * tread, 0.0), (1.0, 1.0, (k + 1) * rise), stone[k % 2], bevel=0.015, segments=1, seams=("x", "y+", "z-"))
        elif kind == "wood":
            wood = ctx.paint("trims", 1, tile="timber")
            dark = ctx.paint("trims", 0, tile="timber")
            for k in range(n):
                b.box((0.08, k * tread, (k + 1) * rise - 0.05), (0.92, min(1.0, k * tread + tread + 0.02), (k + 1) * rise), wood, bevel=0.0)
                b.box((0.08, k * tread, 0.0), (0.92, k * tread + 0.03, (k + 1) * rise - 0.05), wood, bevel=0.0)
            prof = [(0.0, 0.0), (1.0, 0.0), (1.0, n * rise + 0.04), (tread, rise + 0.04), (0.0, 0.06)]
            for xa in (0.0, 0.92):
                b.solid(solids.prism(prof, "x", xa, xa + 0.08), dark, bevel=0.0, seams=("x", "z-"))
            for x in (0.04, 0.96):
                b.box((x - 0.03, 0.05, 0.0), (x + 0.03, 0.11, rise + 0.75), dark, bevel=0.0)
                rail = solids.beam_profile((0.05, rise + 0.75), (0.98, n * rise + 0.72), 0.04)
                b.solid(solids.prism(rail, "x", x - 0.025, x + 0.025), dark, bevel=0.0)
        else:
            stones = [ctx.paint("stone", i, tile="paving") for i in range(3)]
            b.box((0.0, 0.0, 0.0), (1.0, 1.0, 0.04), ctx.paint("ground", 0, tile="gravel"), bevel=0.0, seams=("x", "y", "z-"))
            for k in range(n):
                off = params["offsets"][k]
                b.box((0.08 + off, k * tread + 0.02, 0.0), (0.92 + off, 1.0, (k + 1) * rise), stones[k], bevel=0.03, segments=1, seams=("y+", "z-"))
        return [b.to_object(ctx.collection)]


@register
@mirror
class Fence(JapModule):
    """One metre of bamboo fence along the front edge: an open lattice (yotsume-gaki) tied with
    black rope, a close fence of vertical canes (misu-gaki) under a capping pole, or a split
    bamboo panel (kenninji-gaki) with paired battens."""

    id = "fence"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("yotsume", "misu", "kenninji"), variant), "tone": pick(rng, (0, 2, 1), variant), "canes": [round(rng.uniform(0.0, 1.0), 3) for _ in range(4)]}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        style = params["style"]
        cane = ctx.paint("bamboo", params["tone"], tile="bamboo")
        post = ctx.paint("bamboo", 1, tile="bamboo")
        rope = ctx.paint("rope", 0, tile="plain")
        y = 0.075
        if style == "yotsume":
            b.cylinder((0.06, y, 0.0), 0.045, 0.95, post, sides=6, bevel=0.0)
            for i in range(4):
                x = 0.25 + i * 0.22
                b.cylinder((x, y - 0.03, 0.0), 0.016, 0.82 + 0.04 * params["canes"][i], cane, sides=5, bevel=0.0)
            for z in (0.3, 0.55, 0.8):
                b.box((0.0, y + 0.0, z - 0.017), (1.0, y + 0.03, z + 0.017), cane, bevel=0.0, seams=("x",))
                for i in range(4):
                    x = 0.25 + i * 0.22
                    b.box((x - 0.022, y - 0.052, z - 0.02), (x + 0.022, y - 0.045, z + 0.02), rope, bevel=0.0, noise=0.0)
        elif style == "misu":
            b.cylinder((0.06, y, 0.0), 0.05, 0.97, post, sides=6, bevel=0.0)
            for i in range(10):
                x = 0.13 + i * 0.087
                b.cylinder((x, y + 0.02, 0.0), 0.02, 0.86, cane, sides=5, bevel=0.0)
            for z in (0.25, 0.6):
                b.box((0.0, y - 0.045, z), (1.0, y - 0.005, z + 0.035), post, bevel=0.0, seams=("x",))
            b.box((0.0, y - 0.03, 0.86), (1.0, y + 0.05, 0.92), post, bevel=0.0, seams=("x",))
            for i in range(5):
                x = 0.18 + i * 0.18
                b.box((x - 0.02, y - 0.055, 0.86), (x + 0.02, y + 0.06, 0.93), rope, bevel=0.0, noise=0.0)
        else:
            b.box((0.0, y - 0.03, 0.0), (0.07, y + 0.04, 0.98), post, bevel=0.0, seams=("x-", "z-"))
            n = 7
            for i in range(n):
                xa = 0.07 + (0.93 * i) / n
                xb = 0.07 + (0.93 * (i + 1)) / n - 0.008
                b.box((xa, y - 0.005, 0.02), (xb, y + 0.02, 0.88), cane, bevel=0.0, seams=("x+",) if i == n - 1 else ())
            for z in (0.18, 0.5, 0.78):
                for dz in (0.0, 0.045):
                    b.box((0.07, y - 0.03, z + dz), (1.0, y - 0.005, z + dz + 0.03), post, bevel=0.0, seams=("x+",))
            b.box((0.07, y - 0.035, 0.88), (1.0, y + 0.045, 0.94), post, bevel=0.0, seams=("x+",))
        return [b.to_object(ctx.collection)]


@register
@mirror
class Lamp(JapModule):
    """Street lights: a paper andon box on a wooden post under a little roof, a red-and-white
    paper lantern (chochin) hanging from an arm, or a bronze lantern on a pole. ``light`` is
    where the client puts the point light."""

    id = "lamp"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("andon", "chochin", "bronze"), variant), "wood": pick(rng, (0, 1, 0), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        cx = cy = 0.5
        style = params["style"]
        wood = ctx.paint("trims", params["wood"], tile="timber")
        glow = ctx.paint("light", 0, tile="plain", material="glow")
        stone = ctx.paint("stone", 1, tile="paving")
        b.box((cx - 0.14, cy - 0.14, 0.0), (cx + 0.14, cy + 0.14, 0.12), stone, bevel=0.015, segments=1, seams=("z-",))
        if style == "andon":
            b.box((cx - 0.05, cy - 0.05, 0.12), (cx + 0.05, cy + 0.05, 2.05), wood, bevel=0.0)
            b.box((cx - 0.16, cy - 0.16, 2.05), (cx + 0.16, cy + 0.16, 2.09), wood, bevel=0.0)
            b.box((cx - 0.13, cy - 0.13, 2.09), (cx + 0.13, cy + 0.13, 2.47), glow, bevel=0.0, noise=0.0)
            for sx in (-1, 1):
                for sy in (-1, 1):
                    b.box((cx + sx * 0.13 - 0.018, cy + sy * 0.13 - 0.018, 2.09), (cx + sx * 0.13 + 0.018, cy + sy * 0.13 + 0.018, 2.47), wood, bevel=0.0)
            for z in (2.22, 2.35):
                b.box((cx - 0.135, cy - 0.135, z - 0.008), (cx + 0.135, cy + 0.135, z + 0.008), wood, bevel=0.0, noise=0.0)
            kawara = ctx.paint("roofs", 1, tile="kawara")
            b.solid(solids.hip_roof(cx - 0.24, cx + 0.24, cy - 0.24, cy + 0.24, 2.47, 2.66), kawara, bevel=0.0)
            b.blob((cx, cy, 2.69), 0.04, ctx.paint("roofs", 1, tile="plain"), subdivisions=1, wobble=0.0)
        elif style == "chochin":
            b.box((cx - 0.05, cy - 0.05, 0.12), (cx + 0.05, cy + 0.05, 2.72), wood, bevel=0.0)
            b.box((cx - 0.04, cy - 0.02, 2.62), (cx + 0.36, cy + 0.02, 2.67), wood, bevel=0.0)
            brace = solids.beam_profile((cx, 2.35), (cx + 0.25, 2.63), 0.03)
            b.solid(solids.prism(brace, "y", cy - 0.015, cy + 0.015), wood, bevel=0.0)
            lx = cx + 0.3
            red = ctx.paint("lacquer", 0, tile="plain")
            dark = ctx.paint("trims", 0, tile="plain")
            b.box((lx - 0.006, cy - 0.006, 2.5), (lx + 0.006, cy + 0.006, 2.62), dark, bevel=0.0, noise=0.0)
            b.cylinder((lx, cy, 2.44), 0.08, 0.06, dark, sides=8, bevel=0.0)
            b.cylinder((lx, cy, 2.18), 0.15, 0.26, glow, sides=10, bevel=0.0, noise=0.0)
            for z in (2.22, 2.31, 2.4):
                b.cylinder((lx, cy, z - 0.012), 0.155, 0.024, red, sides=10, bevel=0.0, noise=0.0)
            b.cylinder((lx, cy, 2.12), 0.08, 0.06, dark, sides=8, bevel=0.0)
        else:
            bronze = ctx.paint("roofs", 3, tile="plain")
            b.cylinder((cx, cy, 0.12), 0.07, 1.85, bronze, sides=6, bevel=0.0)
            b.cylinder((cx, cy, 1.97), 0.17, 0.06, bronze, sides=6, bevel=0.0)
            b.cylinder((cx, cy, 2.03), 0.12, 0.4, glow, sides=6, bevel=0.0, noise=0.0)
            for k in range(6):
                a = 2 * math.pi * k / 6
                b.box((cx + 0.13 * math.cos(a) - 0.018, cy + 0.13 * math.sin(a) - 0.018, 2.03), (cx + 0.13 * math.cos(a) + 0.018, cy + 0.13 * math.sin(a) + 0.018, 2.43), bronze, bevel=0.0)
            b.cylinder((cx, cy, 2.43), 0.3, 0.14, bronze, sides=6, radius_top=0.05, bevel=0.0)
            b.blob((cx, cy, 2.62), 0.06, bronze, scale=(1.0, 1.0, 1.3), subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Bench(JapModule):
    """Two-seat bench (2 cells): a tea-house bench (shogi) under red felt with a tray of tea, a
    thick plank bench on stone feet, or a granite slab with two cushions."""

    id = "bench"
    SEAT_Z = 0.45

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("shogi", "plank", "stone"), variant), "cushion": pick(rng, (0, 1, 3), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        x0, x1 = 0.16, 1.84
        z = self.SEAT_Z
        kind = params["kind"]
        dark = ctx.paint("trims", 0, tile="timber")
        if kind == "shogi":
            wood = ctx.paint("trims", 2, tile="timber")
            for x in (x0 + 0.06, x1 - 0.12):
                for y in (0.34, 0.7):
                    b.box((x, y, 0.0), (x + 0.06, y + 0.06, z - 0.06), dark, bevel=0.0)
            b.box((x0, 0.32, z - 0.08), (x1, 0.78, z - 0.04), wood, bevel=0.0)
            felt = ctx.paint("fabric", 4, tile="plain")
            b.box((x0 + 0.04, 0.3, z - 0.04), (x1 - 0.04, 0.8, z), felt, bevel=0.0, noise=0.0)
            b.box((x0 + 0.04, 0.29, z - 0.2), (x1 - 0.04, 0.3, z), felt, bevel=0.0, noise=0.0)
            tray = ctx.paint("lacquer", 1, tile="plain")
            b.box((1.3, 0.45, z), (1.6, 0.68, z + 0.025), tray, bevel=0.0)
            for cx in (1.38, 1.52):
                b.cylinder((cx, 0.56, z + 0.025), 0.035, 0.06, ctx.paint("stone", 2, tile="plain"), sides=6, radius_top=0.04, bevel=0.0)
        elif kind == "plank":
            stone = ctx.paint("stone", 0, tile="paving")
            for x in (x0 + 0.08, x1 - 0.3):
                b.box((x, 0.34, 0.0), (x + 0.22, 0.76, z - 0.1), stone, bevel=0.02, segments=1, seams=("z-",))
            b.box((x0, 0.3, z - 0.1), (x1, 0.8, z), ctx.paint("trims", 1, tile="timber"), bevel=0.015, segments=1)
            for x in (0.6, 1.0, 1.4):
                b.box((x - 0.004, 0.298, z - 0.1), (x + 0.004, 0.302, z), dark, bevel=0.0, noise=0.0)
        else:
            stone = ctx.paint("stone", 1, tile="paving")
            for x in (x0 + 0.12, x1 - 0.32):
                b.box((x, 0.36, 0.0), (x + 0.2, 0.74, z - 0.1), stone, bevel=0.02, segments=1, seams=("z-",))
            b.box((x0, 0.32, z - 0.1), (x1, 0.78, z - 0.02), ctx.paint("stone", 2, tile="paving"), bevel=0.025, segments=1)
            cushion = ctx.paint("fabric", params["cushion"], tile="plain")
            for cx in (0.6, 1.4):
                b.rounded_box((cx - 0.2, 0.36, z - 0.02), (cx + 0.2, 0.74, z + 0.04), cushion, radius=0.025, segments=1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class TileCobble(JapModule):
    """1 x 1 m paving: raked gravel with ripple lines, stepping stones (tobi-ishi) set in
    gravel, or granite slabs (ishidatami). Edges stay sharp so tiles pave seamlessly."""

    id = "tile.cobble"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("raked", "stepping", "slabs"), variant),
            "stones": [[round(rng.uniform(0.25, 0.75), 3), round(rng.uniform(-0.05, 0.05), 3), round(rng.uniform(0.15, 0.2), 3)] for _ in range(3)],
            "cut": round(rng.uniform(0.4, 0.6), 3),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        kind = params["kind"]
        grid = [0.0, 1 / 3, 2 / 3, 1.0]
        gravel = ctx.paint("ground", 0, tile="gravel")
        b.solid(solids.swap_yz(solids.grid_panel(grid, grid, [], 0.0, 0.05)), gravel, bevel=0.0)
        if kind == "raked":
            for k in range(5):
                y = 0.1 + k * 0.2
                b.box((0.0, y - 0.025, 0.05), (1.0, y + 0.025, 0.065), gravel, bevel=0.0, noise=0.0, seams=("x",))
        elif kind == "stepping":
            stone = [ctx.paint("stone", i, tile="paving") for i in range(3)]
            for i, (x, dy, r) in enumerate(params["stones"]):
                y = 0.2 + i * 0.3 + dy
                b.cylinder((x, y, 0.03), r, 0.045, stone[i], sides=7, radius_top=r * 0.92, bevel=0.0)
        else:
            stone = [ctx.paint("stone", i, tile="paving") for i in (0, 2)]
            g = 0.015
            cut = params["cut"]
            for i, (lo, hi) in enumerate((((g, g), (1 - g, 0.5 - g)), ((g, 0.5 + g), (cut - g, 1 - g)), ((cut + g, 0.5 + g), (1 - g, 1 - g)))):
                b.box((lo[0], lo[1], 0.04), (hi[0], hi[1], 0.07), stone[i % 2], bevel=0.008, segments=1)
        return [b.to_object(ctx.collection)]
