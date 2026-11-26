"""Arabic street props: stair, fence, lamp (brass lanterns), bench, tile.cobble (zellige,
bejmat and flagstones). They stand on the ground (z = 0) with the front at y = 0, with the
European footprints and sockets, and stay inside the European walking blockers
(``packages/shared/src/world/props.ts``; a test checks it)."""

from __future__ import annotations

import math
from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng

from .common import ArabModule, lattice, merlon_positions, mirror, pick
from .roofs import dome, merlon


def lantern(ctx, b, cx: float, cy: float, z: float, kind: str = "hex", scale: float = 1.0) -> float:
    """A pierced brass lantern standing on ``z`` with a glowing core (``glow`` material) and an
    onion top; returns its top height. ``kind``: ``hex`` (six panels), ``round`` (a drum) or
    ``star`` (an eight-point star body)."""
    from hvkit import solids

    s = scale
    brass = ctx.paint("brass", 0, tile="plain")
    dark = ctx.paint("brass", 1, tile="plain")
    glow = ctx.paint("light", 0, tile="plain", material="glow")
    r, h = 0.1 * s, 0.26 * s
    b.cylinder((cx, cy, z), r * 0.7, 0.04 * s, dark, sides=6, radius_top=r, bevel=0.0)
    z += 0.04 * s
    b.cylinder((cx, cy, z + 0.01 * s), r * 0.78, h - 0.02 * s, glow, sides=6, bevel=0.0, noise=0.0)
    if kind == "star":
        star = solids.star_polygon(cx, cy, r * 1.05, r * 0.8, 8)
        for za, zb in ((z, z + 0.03 * s), (z + h - 0.03 * s, z + h)):
            b.solid(solids.prism(star, "z", za, zb), brass, bevel=0.0)
    else:
        sides = 6 if kind == "hex" else 10
        b.cylinder((cx, cy, z), r, 0.03 * s, brass, sides=sides, bevel=0.0)
        b.cylinder((cx, cy, z + h - 0.03 * s), r, 0.03 * s, brass, sides=sides, bevel=0.0)
    for k in range(6):
        a = 2 * math.pi * k / 6
        px, py = cx + r * 0.95 * math.cos(a), cy + r * 0.95 * math.sin(a)
        b.box((px - 0.012 * s, py - 0.012 * s, z), (px + 0.012 * s, py + 0.012 * s, z + h), brass, bevel=0.0)
    top = dome(b, brass, cx, cy, z + h, r * 1.05, 0.16 * s, onion=0.4, sides=6, rings=3)
    b.blob((cx, cy, top + 0.02 * s), 0.025 * s, brass, subdivisions=1, wobble=0.0)
    return top + 0.045 * s


@register
@mirror
class Stair(ArabModule):
    """Three steps: lime-white with zellige risers, sandstone between low plaster cheeks
    topped by a brass lantern, or terracotta treads with white risers."""

    id = "stair"
    RISE = 0.15
    STEPS = 3

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("zellige", "cheeks", "terracotta"), variant), "tiles": rng.randint(1, 5)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        n, rise = self.STEPS, self.RISE
        tread = 1.0 / n
        kind = params["kind"]
        x0, x1 = (0.12, 0.88) if kind == "cheeks" else (0.0, 1.0)
        body = ctx.paint("trims", 2, tile="stone") if kind == "cheeks" else ctx.paint("trims", 0, tile="stucco")
        inset = 0.008 if kind == "zellige" else 0.0
        for k in range(n):
            b.box((x0, k * tread + inset, 0.0), (x1, 1.0, (k + 1) * rise), body, bevel=0.02, segments=1, seams=("x", "y+", "z-"))
            if kind == "zellige":
                for i in range(4):
                    xa = 0.04 + i * 0.24
                    tile = ctx.paint("zellige", params["tiles"] if i % 2 else 2, tile="zellige")
                    b.box((xa, k * tread, k * rise + 0.03), (xa + 0.2, k * tread + inset, (k + 1) * rise - 0.03), tile, bevel=0.0, noise=0.0)
            elif kind == "terracotta":
                clay = ctx.paint("roofs", 2, tile="paving")
                b.box((x0 + 0.01, k * tread, (k + 1) * rise), (x1 - 0.01, k * tread + tread * 0.98, (k + 1) * rise + 0.025), clay, bevel=0.0)
        if kind == "cheeks":
            wall = ctx.paint("walls", 0, tile="stucco")
            prof = [(0.0, 0.0), (1.0, 0.0), (1.0, n * rise + 0.25), (0.0, rise + 0.15)]
            for xa in (0.0, 0.88):
                b.solid(solids.prism(prof, "x", xa, xa + 0.12, slices=1), wall, bevel=0.02, segments=1, seams=("x", "z-"))
            lantern(ctx, b, 0.06, 0.85, n * rise + 0.25, "hex", scale=0.5)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Fence(ArabModule):
    """One metre of boundary along the front edge: a low plaster wall with stepped merlons,
    a cedar lattice on a plaster base, or a fence of palm-frond ribs (jarid)."""

    id = "fence"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("wall", "lattice", "jarid"), variant), "ribs": [round(rng.uniform(0.82, 0.95), 3) for _ in range(9)]}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        style = params["style"]
        if style == "wall":
            wall = ctx.paint("walls", 0, tile="stucco")
            b.box((0.0, 0.0, 0.0), (1.0, 0.13, 0.62), wall, bevel=0.03, segments=1, seams=("x", "z-"))
            white = ctx.paint("trims", 0, tile="stucco")
            b.box((0.0, 0.0, 0.62), (1.0, 0.14, 0.66), white, bevel=0.0, seams=("x", "y-"))
            for u0, u1 in merlon_positions(0.06, 0.94, 0.3, 0.14):
                merlon(b, white, "stepped", "y", u0, u1, 0.01, 0.13, 0.66, 0.2)
        elif style == "lattice":
            base = ctx.paint("walls", 1, tile="stucco")
            b.box((0.0, 0.0, 0.0), (1.0, 0.13, 0.35), base, bevel=0.025, segments=1, seams=("x", "z-"))
            wood = ctx.paint("trims", 1, tile="timber")
            b.box((0.0, 0.05, 0.35), (1.0, 0.08, 0.39), wood, bevel=0.0, seams=("x",))
            b.box((0.0, 0.05, 0.86), (1.0, 0.08, 0.9), wood, bevel=0.0, seams=("x",))
            for xa in (0.0, 0.96):
                b.box((xa, 0.05, 0.39), (xa + 0.04, 0.08, 0.86), wood, bevel=0.0)
            lattice(b, 0.04, 0.96, 0.39, 0.86, 0.055, 0.075, wood, 6, 4)
        else:
            rib = ctx.paint("bark", 2, tile="bark")
            tie = ctx.paint("bark", 1, tile="bark")
            b.box((0.0, 0.02, 0.0), (0.06, 0.1, 0.95), tie, bevel=0.012, segments=1, seams=("x-", "z-"))
            for i, h in enumerate(params["ribs"]):
                x = 0.1 + i * 0.1
                b.cylinder((x, 0.06, 0.0), 0.03, h, rib, sides=5, radius_top=0.018, bevel=0.0)
            for z in (0.25, 0.7):
                b.box((0.06, 0.01, z), (1.0, 0.025, z + 0.04), tie, bevel=0.0, seams=("x+",))
        return [b.to_object(ctx.collection)]


@register
@mirror
class Lamp(ArabModule):
    """Street lantern: a brass hexagonal lantern on a slim post, a star lantern hanging from a
    curled arm, or two round lanterns from a crossbar. ``light`` is where the client puts the
    point light."""

    id = "lamp"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("post", "hook", "double"), variant), "base": pick(rng, (0, 1, 2), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        iron = ctx.paint("iron", 0, tile="plain")
        brass = ctx.paint("brass", 1, tile="plain")
        cx = cy = 0.5
        b.box((cx - 0.14, cy - 0.14, 0.0), (cx + 0.14, cy + 0.14, 0.3), ctx.paint("walls", params["base"], tile="stucco"), bevel=0.02, segments=1, seams=("z-",))
        b.box((cx - 0.15, cy - 0.15, 0.3), (cx + 0.15, cy + 0.15, 0.34), ctx.paint("trims", 0, tile="stucco"), bevel=0.0)
        style = params["style"]
        pole_top = 2.05 if style == "post" else 2.62
        b.cylinder((cx, cy, 0.34), 0.035, pole_top - 0.34, iron, sides=8, bevel=0.0)
        for z in (0.9, 1.6):
            b.cylinder((cx, cy, z), 0.05, 0.05, brass, sides=8, bevel=0.0)
        if style == "post":
            b.cylinder((cx, cy, pole_top - 0.04), 0.06, 0.06, brass, sides=8, radius_top=0.1, bevel=0.0)
            lantern(ctx, b, cx, cy, pole_top + 0.02, "hex")
            return [b.to_object(ctx.collection)]
        arms = (1,) if style == "hook" else (-1, 1)
        for s in arms:
            end = cx + s * 0.3
            lo, hi = (cx, end) if s > 0 else (end, cx)
            b.box((lo, cy - 0.018, pole_top - 0.035), (hi, cy + 0.018, pole_top), iron, bevel=0.0)
            brace = solids.beam_profile((cx, pole_top - 0.3), (cx + s * 0.22, pole_top - 0.035), 0.022)
            b.solid(solids.prism(brace, "y", cy - 0.01, cy + 0.01), iron, bevel=0.0)
            b.box((end - 0.008, cy - 0.008, pole_top - 0.22), (end + 0.008, cy + 0.008, pole_top - 0.035), iron, bevel=0.0)
            lantern(ctx, b, end, cy, pole_top - 0.62, "star" if style == "hook" else "round")
        b.blob((cx, cy, pole_top + 0.04), 0.045, brass, subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Bench(ArabModule):
    """Two-seat bench (2 cells): a plaster bench with a zellige front and cushions, a cedar
    bench with a lattice back, or a sandstone slab bench with a rug."""

    id = "bench"
    SEAT_Z = 0.45

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("zellige", "cedar", "stone"), variant), "cushions": pick(rng, ((0, 2), (1, 4), (2, 0)), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        x0, x1 = 0.16, 1.84
        z = self.SEAT_Z
        kind = params["kind"]
        fabric = [ctx.paint("fabric", c, tile="plain") for c in params["cushions"]]
        if kind == "zellige":
            wall = ctx.paint("walls", 0, tile="stucco")
            b.box((x0, 0.3, 0.0), (x1, 0.72, z - 0.08), wall, bevel=0.03, segments=1, seams=("z-",))
            b.box((x0 - 0.01, 0.28, z - 0.08), (x1 + 0.01, 0.74, z - 0.04), ctx.paint("trims", 0, tile="stucco"), bevel=0.012, segments=1)
            b.box((x0, 0.72, 0.0), (x1, 0.8, 0.85), wall, bevel=0.03, segments=1, seams=("z-",))
            for i in range(6):
                xa = x0 + 0.06 + i * 0.26
                b.box((xa, 0.294, 0.08), (xa + 0.22, 0.3, 0.3), ctx.paint("zellige", 1 + i % 3, tile="zellige"), bevel=0.0, noise=0.0)
            for i, xa in enumerate((x0 + 0.05, (x0 + x1) / 2 + 0.02)):
                b.box((xa, 0.32, z - 0.04), (xa + 0.78, 0.7, z + 0.04), fabric[i % 2], bevel=0.03, segments=1)
        elif kind == "cedar":
            wood = ctx.paint("trims", 1, tile="timber")
            for xa in (x0, x1 - 0.08):
                b.box((xa, 0.3, 0.0), (xa + 0.08, 0.36, z), wood, bevel=0.0)
                b.box((xa, 0.74, 0.0), (xa + 0.08, 0.8, z + 0.42), wood, bevel=0.0)
            b.box((x0, 0.3, z - 0.06), (x1, 0.78, z), wood, bevel=0.01, segments=1)
            b.box((x0, 0.74, z + 0.36), (x1, 0.8, z + 0.42), wood, bevel=0.0)
            lattice(b, x0 + 0.08, x1 - 0.08, z + 0.05, z + 0.36, 0.755, 0.785, wood, 10, 2)
            b.box((x0 + 0.1, 0.32, z), (x1 - 0.1, 0.72, z + 0.06), fabric[0], bevel=0.025, segments=1)
        else:
            stone = ctx.paint("trims", 2, tile="stone")
            for xa in (x0 + 0.1, x1 - 0.28):
                b.box((xa, 0.34, 0.0), (xa + 0.18, 0.66, z - 0.08), stone, bevel=0.02, segments=1, seams=("z-",))
            b.box((x0, 0.3, z - 0.08), (x1, 0.7, z), stone, bevel=0.025, segments=2)
            b.box((x0 + 0.3, 0.29, z - 0.2), (x0 + 1.1, 0.71, z + 0.012), fabric[0], bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class TileCobble(ArabModule):
    """1 x 1 m paving: a zellige star mosaic, herringbone bejmat bricks or sand flagstones.
    Edges stay sharp so tiles pave seamlessly."""

    id = "tile.cobble"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("star", "bejmat", "flags"), variant),
            "colour": rng.randint(1, 5),
            "cuts": [round(rng.uniform(0.38, 0.62), 3) for _ in range(2)],
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        kind = params["kind"]
        grid = [0.0, 1 / 3, 2 / 3, 1.0]
        base = ctx.paint("ground", 0 if kind != "bejmat" else 1, tile="paving")
        b.solid(solids.swap_yz(solids.grid_panel(grid, grid, [], 0.0, 0.05)), base, bevel=0.0)
        if kind == "star":
            white = ctx.paint("zellige", 0, tile="zellige")
            b.box((0.03, 0.03, 0.04), (0.97, 0.97, 0.055), white, bevel=0.0, noise=0.0)
            star = solids.star_polygon(0.5, 0.5, 0.42, 0.3, 8, math.pi / 8)
            b.solid(solids.prism(star, "z", 0.055, 0.065), ctx.paint("zellige", params["colour"], tile="zellige"), bevel=0.0, noise=0.0)
            b.solid(solids.prism(solids.regular_polygon(0.5, 0.5, 0.16, 8, math.pi / 8), "z", 0.065, 0.07), ctx.paint("zellige", 2, tile="zellige"), bevel=0.0, noise=0.0)
            for x, y in ((0.03, 0.03), (0.85, 0.03), (0.03, 0.85), (0.85, 0.85)):
                b.box((x + 0.02, y + 0.02, 0.055), (x + 0.1, y + 0.1, 0.065), ctx.paint("zellige", 3, tile="zellige"), bevel=0.0, noise=0.0)
        elif kind == "bejmat":
            clay = [ctx.paint("roofs", 2, tile="paving"), ctx.paint("walls", 3, tile="paving")]
            g = 0.012
            w, l = 0.25, 0.5
            k = 0
            for row in range(2):
                for col in range(2):
                    x, y = col * 0.5, row * 0.5
                    if (row + col) % 2 == 0:
                        lo, hi = (x + g, y + g), (x + l - g, y + w - g)
                        lo2, hi2 = (x + g, y + w + g), (x + l - g, y + 2 * w - g)
                    else:
                        lo, hi = (x + g, y + g), (x + w - g, y + l - g)
                        lo2, hi2 = (x + w + g, y + g), (x + 2 * w - g, y + l - g)
                    for a, c in ((lo, hi), (lo2, hi2)):
                        b.box((a[0], a[1], 0.04), (c[0], c[1], 0.062), clay[k % 2], bevel=0.0)
                        k += 1
        else:
            stone = ctx.paint("ground", 2, tile="paving")
            cx, cy = params["cuts"]
            g = 0.015
            for lo, hi in (((g, g), (cx - g, cy - g)), ((cx + g, g), (1 - g, cy - g)), ((g, cy + g), (1 - g, 1 - g))):
                b.box((lo[0], lo[1], 0.04), (hi[0], hi[1], 0.07), stone, bevel=0.01, segments=1)
        return [b.to_object(ctx.collection)]
