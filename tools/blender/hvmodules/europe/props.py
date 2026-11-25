"""Europe street props: stair, fence, lamp, bench, tile.cobble. They stand on the ground
(z = 0) with the front at y = 0."""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.grid import Footprint
from hvkit.module import Module, Socket, register
from hvkit.variants import VariantRng

from .common import PROP_BUDGET, STYLES, TILE_BUDGET, pick


class EuropeProp(Module):
    variants = 3
    styles = STYLES
    tri_budget = PROP_BUDGET


@register
class Stair(EuropeProp):
    """Three stone steps up to a door or a raised square (0.45 m)."""

    id = "stair"
    RISE = 0.15
    STEPS = 3
    footprint = Footprint(w=1, d=1, h=RISE * STEPS + 0.95)
    tags = ("prop", "stair", "europe")
    sockets = (
        Socket("bottom", "prop", (0.5, 0.0, 0.0), (0.0, -1.0, 0.0)),
        Socket("top", "stack", (0.5, 1.0, RISE * STEPS), (0.0, 0.0, 1.0)),
        Socket("left", "edge", (0.0, 0.5, 0.0), (-1.0, 0.0, 0.0)),
        Socket("right", "edge", (1.0, 0.5, 0.0), (1.0, 0.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"sides": pick(rng, ("none", "cheeks", "rail"), variant), "stone": pick(rng, (1, 0, 1), variant)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        stone = ctx.paint("ground", params["stone"], tile="stone")
        n, rise = self.STEPS, self.RISE
        tread = 1.0 / n
        sides = params["sides"]
        x0, x1 = (0.1, 0.9) if sides == "cheeks" else (0.0, 1.0)
        for k in range(n):
            b.box((x0, k * tread, 0.0), (x1, 1.0, (k + 1) * rise), stone, bevel=0.025, segments=1, seams=("x", "y+", "z-"))
        if sides == "cheeks":
            plaster = ctx.paint("walls", rng.randint(0, 3), tile="plaster")
            prof = [(0.0, 0.0), (1.0, 0.0), (1.0, n * rise + 0.2), (0.0, rise + 0.1)]
            for xa in (0.0, 0.9):
                b.solid(solids.prism(prof, "x", xa, xa + 0.1, slices=1), plaster, bevel=0.02, segments=1, seams=("x", "z-"))
            cap = ctx.paint("trims", 1, tile="stone")
            top = [(0.0, rise + 0.1), (1.0, n * rise + 0.2), (1.0, n * rise + 0.26), (0.0, rise + 0.16)]
            for xa in (0.0, 0.9):
                b.solid(solids.prism(top, "x", xa, xa + 0.1), cap, bevel=0.0, noise=0.0)
        elif sides == "rail":
            iron = ctx.paint("iron", 0, tile="plain")
            for x in (0.08, 0.92):
                for k in (0, n - 1):
                    y = (k + 0.5) * tread
                    b.box((x - 0.02, y - 0.02, (k + 1) * rise), (x + 0.02, y + 0.02, (k + 1) * rise + 0.85), iron, bevel=0.0)
                y_a, y_b = 0.5 * tread, (n - 0.5) * tread
                prof = solids.beam_profile((y_a - 0.05, rise + 0.85), (y_b + 0.05, n * rise + 0.85), 0.04)
                b.solid(solids.prism(prof, "x", x - 0.025, x + 0.025), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Fence(EuropeProp):
    """One metre of garden fence along the front edge of the cell. The post is at the left end;
    the next fence module closes the right end."""

    id = "fence"
    footprint = Footprint(w=1, d=1, h=1.0)
    tags = ("prop", "fence", "europe")
    sockets = (
        Socket("left", "edge", (0.0, 0.05, 0.5), (-1.0, 0.0, 0.0)),
        Socket("right", "edge", (1.0, 0.05, 0.5), (1.0, 0.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("picket", "rail", "iron"), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        style = params["style"]
        if style == "picket":
            paint = ctx.paint("trims", 1, tile="wood")
            b.box((0.0, 0.0, 0.0), (0.08, 0.08, 0.86), paint, bevel=0.012, segments=1, seams=("z-",))
            b.solid(solids.hip_roof(0.0, 0.08, 0.0, 0.08, 0.86, 0.94), paint, bevel=0.0)
            for z in (0.22, 0.58):
                b.box((0.08, 0.035, z), (1.0, 0.065, z + 0.06), paint, bevel=0.0, seams=("x+",))
            n = 5
            for i in range(n):
                xa = 0.12 + i * 0.18
                xb = xa + 0.1
                prof = [(xa, 0.04), (xb, 0.04), (xb, 0.72), ((xa + xb) / 2, 0.8), (xa, 0.72)]
                b.solid(solids.prism(prof, "y", 0.005, 0.035), paint, bevel=0.008, segments=1)
        elif style == "rail":
            wood = ctx.paint("trims", 2, tile="wood")
            b.box((0.0, 0.0, 0.0), (0.1, 0.1, 0.9), wood, bevel=0.02, segments=1, noise=0.012, seams=("z-",))
            for z in (0.3, 0.65):
                prof = solids.clip_beam_profile((0.05, z + rng.jitter(0.03)), (1.05, z + rng.jitter(0.03)), 0.07, (0.1, 0.0), (1.0, 1.0))
                b.solid(solids.prism(prof, "y", 0.02, 0.08), wood, bevel=0.015, segments=1, noise=0.01)
            brace = solids.beam_profile((0.12, 0.33), (0.95, 0.66), 0.05)
            b.solid(solids.prism(brace, "y", 0.03, 0.07), wood, bevel=0.01, segments=1)
        else:
            iron = ctx.paint("iron", 0, tile="plain")
            stone = ctx.paint("ground", 1, tile="stone")
            b.box((0.0, 0.0, 0.0), (1.0, 0.12, 0.25), stone, bevel=0.02, segments=1, seams=("x", "z-"))
            b.box((0.0, 0.0, 0.0), (0.12, 0.13, 0.85), stone, bevel=0.02, segments=1, seams=("x-", "y-", "z-"))
            b.box((0.0, 0.0, 0.85), (0.13, 0.14, 0.9), ctx.paint("trims", 1, tile="stone"), bevel=0.01, segments=1, seams=("x-", "y-"))
            b.box((0.12, 0.05, 0.62), (1.0, 0.07, 0.65), iron, bevel=0.0, seams=("x+",))
            for i in range(7):
                x = 0.18 + i * 0.12
                b.box((x - 0.01, 0.05, 0.25), (x + 0.01, 0.07, 0.72), iron, bevel=0.0)
                b.solid(solids.hip_roof(x - 0.02, x + 0.02, 0.04, 0.08, 0.72, 0.8), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Lamp(EuropeProp):
    """Cast-iron street lamp with a glowing lantern (``glow`` material). ``light`` is where the
    client puts the point light at night (TODO(M09))."""

    id = "lamp"
    footprint = Footprint(w=1, d=1, h=2.8)
    tags = ("prop", "light", "europe")
    sockets = (
        Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),
        Socket("light", "prop", (0.5, 0.5, 2.3), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("post", "hook", "double"), variant), "iron": pick(rng, (0, 1, 0), variant)}

    def lantern(self, ctx, b, cx: float, cy: float, z: float, hanging: bool = False) -> None:
        iron = ctx.paint("iron", 0, tile="plain")
        glow = ctx.paint("light", 0, tile="plain", material="glow")
        r, h = 0.11, 0.3
        b.box((cx - r - 0.02, cy - r - 0.02, z), (cx + r + 0.02, cy + r + 0.02, z + 0.04), iron, bevel=0.01, segments=1)
        b.box((cx - r + 0.01, cy - r + 0.01, z + 0.04), (cx + r - 0.01, cy + r - 0.01, z + 0.04 + h), glow, bevel=0.0, noise=0.0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = cx + sx * r, cy + sy * r
                b.box((px - 0.015, py - 0.015, z + 0.04), (px + 0.015, py + 0.015, z + 0.04 + h), iron, bevel=0.0)
        from hvkit import solids

        top = z + 0.04 + h
        rr = r + 0.05
        b.solid(solids.hip_roof(cx - rr, cx + rr, cy - rr, cy + rr, top, top + 0.16, top_scale=0.2), iron, bevel=0.0)
        b.blob((cx, cy, top + 0.2), 0.035, iron, wobble=0.0)
        if hanging:
            b.box((cx - 0.012, cy - 0.012, top + 0.16), (cx + 0.012, cy + 0.012, top + 0.32), iron, bevel=0.0)

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        iron = ctx.paint("iron", params["iron"], tile="plain")
        cx = cy = 0.5
        b.cylinder((cx, cy, 0.0), 0.14, 0.12, iron, sides=8, radius_top=0.12, bevel=0.0)
        b.cylinder((cx, cy, 0.12), 0.09, 0.3, iron, sides=8, radius_top=0.05, bevel=0.0)
        style = params["style"]
        pole_top = 2.05 if style == "post" else 2.6
        b.cylinder((cx, cy, 0.42), 0.04, pole_top - 0.42, iron, sides=8, bevel=0.0)
        for z in (0.9, 1.6):
            b.cylinder((cx, cy, z), 0.055, 0.05, iron, sides=8, bevel=0.0)
        if style == "post":
            b.cylinder((cx, cy, pole_top - 0.05), 0.07, 0.08, iron, sides=8, radius_top=0.1, bevel=0.0)
            self.lantern(ctx, b, cx, cy, pole_top + 0.03)
        else:
            arms = (1,) if style == "hook" else (-1, 1)
            for s in arms:
                end = cx + s * 0.3
                lo, hi = (cx, end) if s > 0 else (end, cx)
                b.box((lo, cy - 0.02, pole_top - 0.04), (hi, cy + 0.02, pole_top), iron, bevel=0.0)
                brace = solids.beam_profile((cx, pole_top - 0.3), (cx + s * 0.22, pole_top - 0.04), 0.025)
                b.solid(solids.prism(brace, "y", cy - 0.012, cy + 0.012), iron, bevel=0.0)
                self.lantern(ctx, b, end, cy, pole_top - 0.68, hanging=True)
            b.blob((cx, cy, pole_top + 0.04), 0.05, iron, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
class Bench(EuropeProp):
    """Two-seat park bench (2 cells wide). ``seat_left``/``seat_right`` are where characters sit
    (the sit animation faces -Y)."""

    id = "bench"
    footprint = Footprint(w=2, d=1, h=1.0)
    tags = ("prop", "seat", "europe")
    SEAT_Z = 0.45
    sockets = (
        Socket("seat_left", "prop", (0.6, 0.5, SEAT_Z), (0.0, -1.0, 0.0)),
        Socket("seat_right", "prop", (1.4, 0.5, SEAT_Z), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "wood": pick(rng, (("trims", 2), ("accents", 1), ("trims", 1)), variant),
            "legs": pick(rng, ("iron", "wood", "iron"), variant),
            "arms": variant != 1,
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        wood = ctx.paint(*params["wood"], tile="wood")
        iron_legs = params["legs"] == "iron"
        legs = ctx.paint("iron", 0, tile="plain") if iron_legs else wood
        x0, x1 = 0.15, 1.85
        z = self.SEAT_Z
        for k, (ya, yb) in enumerate(((0.3, 0.42), (0.44, 0.56), (0.58, 0.7))):
            b.box((x0, ya + rng.jitter(0.004), z - 0.05), (x1, yb, z), wood, bevel=0.012, segments=1)
        for za, zb in ((0.58, 0.7), (0.74, 0.86)):
            prof = [(0.7, za), (0.76, za), (0.8, zb), (0.74, zb)]
            b.solid(solids.prism(prof, "x", x0, x1), wood, bevel=0.012, segments=1)
        for xa in (0.22, 1.72) if not iron_legs else (0.22, 1.0 - 0.03, 1.72):
            xb = xa + 0.06
            kw = dict(bevel=0.0) if iron_legs else dict(bevel=0.01, segments=1)
            b.box((xa, 0.32, 0.0), (xb, 0.38, z - 0.05), legs, **kw)
            back_leg = solids.clip_beam_profile((0.66, -0.05), (0.78, 0.9), 0.06, (0.0, 0.0), (1.0, 0.9))
            b.solid(solids.prism(back_leg, "x", xa, xb), legs, **kw)
            b.box((xa, 0.32, z - 0.12), (xb, 0.72, z - 0.06), legs, **kw)
            if params["arms"] and xa in (0.22, 1.72):
                b.box((xa - 0.02, 0.28, 0.66), (xb + 0.02, 0.74, 0.7), legs, **kw)
                b.box((xa, 0.3, z), (xb, 0.36, 0.66), legs, **kw)
        return [b.to_object(ctx.collection)]


@register
class TileCobble(EuropeProp):
    """A 1 x 1 m cobblestone paving tile with a few raised stones. Edges stay sharp so tiles pave
    seamlessly."""

    id = "tile.cobble"
    footprint = Footprint(w=1, d=1, h=0.1)
    tags = ("tile", "ground", "europe")
    tri_budget = TILE_BUDGET
    sockets = (Socket("top", "stack", (0.5, 0.5, 0.06), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {"ground": pick(rng, (1, 0, 0), variant), "moss": variant == 2, "stones": rng.randint(4, 6)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        base = ctx.paint("ground", params["ground"], tile="cobble")
        grid = [0.0, 1 / 3, 2 / 3, 1.0]
        slab = solids.swap_yz(solids.grid_panel(grid, grid, [], 0.0, 0.06))
        b.solid(slab, base, bevel=0.0)
        stone = ctx.paint("ground", 1 - params["ground"], tile="stone")
        n = params["stones"]
        for i in range(n):
            cx = 0.12 + rng.uniform(0.0, 0.76)
            cy = 0.12 + rng.uniform(0.0, 0.76)
            sx, sy = rng.uniform(0.09, 0.14), rng.uniform(0.07, 0.11)
            b.box((cx - sx / 2, cy - sy / 2, 0.04), (cx + sx / 2, cy + sy / 2, 0.075), stone, bevel=0.012, segments=1)
        if params["moss"]:
            moss = ctx.paint("foliage", 1, tile="plain")
            b.blob((0.15 + rng.uniform(0.0, 0.2), 0.75 + rng.uniform(0.0, 0.1), 0.06), 0.06, moss, scale=(1.4, 1.0, 0.45), wobble=0.15)
        return [b.to_object(ctx.collection)]
