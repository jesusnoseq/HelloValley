"""Arabic-only props and plants (art.md §2.3): an arcade section of horseshoe arches, a
courtyard fountain with an octagonal (or star) zellige basin, a standing brass lantern and the
date palm.

These have no European counterpart, so building recipes never use them; the town places them
through the per-style dressing (M34, ``packages/shared/src/world/dressing.ts``): the courtyard
fountain replaces the square's fountain (same 2 x 2 footprint, sockets and walking blocker),
date palms and palms replace broadleaf trees, brass lanterns stand at the lantern spots and an
arcade section on the square's south-east edge.

Canopy conventions follow the common kit (M06): the fronds are a separate ``canopy`` mesh with
the ``canopy`` material whose origin is the sway pivot. Fountain water is a separate ``water``
mesh (``hv_part: water``) like the common fountain's.
"""

from __future__ import annotations

import math

from hvkit.budgets import budget_for
from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .common import HORSESHOE_DEG, ArabModule, lines, merlon_positions, opening_cells, pick
from .props import lantern
from .roofs import merlon


class ArabExtra(ArabModule):
    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        if cls.id and "tri_budget" not in cls.__dict__:
            cls.tri_budget = budget_for(cls.id)


def canopy_paint(ctx, group: str, index: int):
    return ctx.paint(group, index, tile="leaves", material="canopy")


ARCADE_BAYS = ((0.16, 0.94), (1.06, 1.84))
"""x spans (widest) of the arcade's two horseshoe arches."""
ARCADE_APEX = 2.3
ARCADE_TOP = 2.8
ARCADE_D = (0.1, 0.4)
"""y range of the arcade wall."""


@register
class Arcade(ArabExtra):
    """A 2 x 1 arcade section: two horseshoe arches on slender columns under a frieze, a
    coping and merlons (stand several side by side for a portico or courtyard gallery)."""

    id = "arcade"
    footprint = Footprint(w=2, d=1, h=3.0)
    max_overhang_m = 0.05
    tags = ("prop", "arcade", "arabic")
    sockets = (
        Socket("base", "prop", (1.0, 0.5, 0.0), (0.0, 0.0, 1.0)),
        Socket("left", "edge", (0.0, 0.25, 0.0), (-1.0, 0.0, 0.0)),
        Socket("right", "edge", (2.0, 0.25, 0.0), (1.0, 0.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "swatch": variant % 3,
            "frieze": pick(rng, ("zellige", "teeth", "plain"), variant),
            "merlon": pick(rng, ("stepped", "round", "saw"), variant),
            "column": pick(rng, (0, 2, 0), variant),
            "tiles": rng.randint(1, 5),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        y0, y1 = ARCADE_D
        wall = ctx.paint("walls", params["swatch"], tile="stucco")
        holes_rects = [(x0, x1, 0.0, ARCADE_APEX) for x0, x1 in ARCADE_BAYS]
        xs = lines(0.0, 2.0, [c for r in holes_rects for c in r[:2]], 0.4)
        zs = lines(0.0, ARCADE_TOP, [ARCADE_APEX], 0.6)
        holes = [c for r in holes_rects for c in opening_cells(xs, zs, r)]
        b.solid(solids.grid_panel(xs, zs, holes, y0, y1), wall, bevel=0.02, segments=1, seams=("x", "z-"))
        for x0, x1, z0, top in holes_rects:
            for prof in solids.horseshoe_fillers(x0, x1, z0, top, HORSESHOE_DEG):
                b.solid(solids.prism(prof, "y", y0, y1), wall, bevel=0.0)
            outer = solids.horseshoe_arc(x0 - 0.05, x1 + 0.05, top + 0.05, HORSESHOE_DEG)
            inner = solids.horseshoe_arc(x0, x1, top, HORSESHOE_DEG)
            b.solid(solids.prism(outer + list(reversed(inner)), "y", y0 - 0.025, y0), ctx.paint("trims", 0, tile="stucco"), bevel=0.0)
        marble = ctx.paint("trims", params["column"], tile="stone")
        cap = ctx.paint("zellige", params["tiles"], tile="zellige")
        _, _, _, _, z_imp = solids.horseshoe_dims(*ARCADE_BAYS[0], ARCADE_APEX, HORSESHOE_DEG)
        for cx in (0.1, 1.0, 1.9):
            b.cylinder((cx, y0 - 0.02, 0.0), 0.09, 0.08, marble, sides=8, bevel=0.0)
            b.cylinder((cx, y0 - 0.02, 0.08), 0.055, z_imp - 0.2, marble, sides=8, bevel=0.0)
            b.box((cx - 0.08, y0 - 0.1, z_imp - 0.12), (cx + 0.08, y0 + 0.06, z_imp), cap, bevel=0.0)
        frieze = params["frieze"]
        fz0, fz1 = 2.45, 2.62
        if frieze == "zellige":
            for i in range(8):
                xa = i * 0.25
                b.box((xa + 0.01, y0 - 0.012, fz0), (xa + 0.24, y0, fz1), ctx.paint("zellige", 1 + i % 3, tile="zellige"), bevel=0.0, noise=0.0)
        elif frieze == "teeth":
            wood = ctx.paint("trims", 1, tile="timber")
            b.box((0.0, y0 - 0.05, fz0 + 0.08), (2.0, y0, fz1), wood, bevel=0.0, seams=("x",))
            for i in range(10):
                xa = 0.04 + i * 0.2
                b.box((xa, y0 - 0.07, fz0), (xa + 0.08, y0, fz0 + 0.1), wood, bevel=0.0)
        else:
            b.box((0.0, y0 - 0.03, fz0), (2.0, y0, fz1), ctx.paint("trims", 0, tile="stucco"), bevel=0.0, seams=("x",))
        white = ctx.paint("trims", 0, tile="stucco")
        b.box((0.0, y0 - 0.04, ARCADE_TOP), (2.0, y1 + 0.04, ARCADE_TOP + 0.04), white, bevel=0.0, seams=("x",))
        for u0, u1 in merlon_positions(0.0, 2.0, 0.28, 0.14):
            merlon(b, wall if params["merlon"] != "round" else white, params["merlon"], "y", u0, u1, y0, y1, ARCADE_TOP + 0.04, 0.14)
        return [b.to_object(ctx.collection)]


FOUNTAIN_R = 0.92
"""Vertex radius of the courtyard basin (inside the common fountain's walking blocker)."""


@register
class FountainCourtyard(ArabExtra):
    """A courtyard fountain: an octagonal zellige basin with a central bowl and jet, a low
    eight-pointed star basin with a lotus jet, or a twelve-sided basin on a tiled apron. Same
    2 x 2 footprint and sockets as the common kit's ``fountain``."""

    id = "fountain.courtyard"
    footprint = Footprint(w=2, d=2, h=1.4)
    tags = ("prop", "water", "square", "arabic", "courtyard")
    sockets = (
        Socket("center", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        Socket("rim_front", "prop", (1.0, 0.12, 0.45), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "basin": pick(rng, ("octagon", "star", "round"), variant),
            "tiles": pick(rng, (1, 3, 4), variant),
            "trim": rng.randint(0, 2),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        w = ctx.builder(self, variant, rng, "water")
        water = ctx.paint("water", 0, tile="plain", material="water")
        tiles = ctx.paint("zellige", params["tiles"], tile="zellige")
        white = ctx.paint("trims", 0, tile="stone")
        accent = ctx.paint("zellige", 2, tile="zellige")
        c = 1.0
        basin = params["basin"]
        if basin == "star":
            outline = solids.star_polygon(c, c, FOUNTAIN_R, 0.74, 8, math.pi / 8)
            inner = solids.star_polygon(c, c, FOUNTAIN_R - 0.1, 0.64, 8, math.pi / 8)
            h = 0.3
        elif basin == "round":
            outline = solids.regular_polygon(c, c, FOUNTAIN_R - 0.06, 12)
            inner = solids.regular_polygon(c, c, FOUNTAIN_R - 0.16, 12)
            h = 0.42
            b.box((0.08, 0.08, 0.0), (1.92, 1.92, 0.03), ctx.paint("zellige", 0, tile="zellige"), bevel=0.0, seams=("z-",))
            for x, y in ((0.12, 0.12), (1.8, 0.12), (0.12, 1.8), (1.8, 1.8)):
                b.box((x, y, 0.03), (x + 0.08, y + 0.08, 0.04), accent, bevel=0.0, noise=0.0)
        else:
            outline = solids.regular_polygon(c, c, FOUNTAIN_R, 8, math.pi / 8)
            inner = solids.regular_polygon(c, c, FOUNTAIN_R - 0.1, 8, math.pi / 8)
            h = 0.4
        b.solid(solids.prism(outline, "z", 0.0, h, slices=2), tiles, bevel=0.0)
        # A rim of marble segments along the outline.
        n = len(outline)
        for k in range(n):
            (ax, ay), (bx, by) = outline[k], outline[(k + 1) % n]
            length = math.hypot(bx - ax, by - ay)
            ang = math.atan2(by - ay, bx - ax)
            seg = solids.box((0.0, -0.01, h), (length, 0.08, h + 0.06))
            seg = solids.rotate_z(seg, ang)
            b.solid(solids.translate(seg, (ax, ay, 0.0)), white, bevel=0.0)
        w.solid(solids.prism(inner, "z", h, h + 0.03), water, bevel=0.0, noise=0.0)
        if basin == "star":
            # A lotus of petals around a low jet.
            for k in range(8):
                a = 2 * math.pi * k / 8
                b.blob((c + 0.13 * math.cos(a), c + 0.13 * math.sin(a), h + 0.02), 0.08, ctx.paint("flowers", 0, tile="plain"), scale=(1.3, 0.6, 0.5), subdivisions=1, wobble=0.0)
            b.cylinder((c, c, h - 0.05), 0.08, 0.14, white, sides=8, bevel=0.0)
            w.blob((c, c, h + 0.24), 0.07, water, scale=(1.0, 1.0, 1.8), wobble=0.0)
        else:
            ped = solids.regular_polygon(c, c, 0.2, 8, math.pi / 8)
            b.solid(solids.prism(ped, "z", h - 0.05, 0.62), accent, bevel=0.0)
            b.cylinder((c, c, 0.62), 0.08, 0.1, white, sides=10, radius_top=0.34, bevel=0.0)
            b.cylinder((c, c, 0.72), 0.34, 0.04, white, sides=10, bevel=0.0)
            w.cylinder((c, c, 0.74), 0.29, 0.03, water, sides=10, bevel=0.0, noise=0.0)
            b.cylinder((c, c, 0.76), 0.05, 0.16, white, sides=8, radius_top=0.035, bevel=0.0)
            w.blob((c, c, 1.0), 0.06, water, scale=(1.0, 1.0, 1.6), wobble=0.0)
            if basin == "round":
                brass = ctx.paint("brass", 0, tile="plain")
                for k in range(4):
                    a = math.pi / 4 + math.pi / 2 * k
                    px, py = c + 0.62 * math.cos(a), c + 0.62 * math.sin(a)
                    b.cylinder((px, py, h + 0.04), 0.03, 0.06, brass, sides=6, bevel=0.0)
        return [b.to_object(ctx.collection), w.to_object(ctx.collection, part="water")]


@register
class LanternBrass(ArabExtra):
    """A big standing brass lantern (hexagonal, round or star-shaped) on a zellige plinth, for
    courtyards and doorsteps. ``light`` is where a point light would go at night."""

    id = "lantern.brass"
    footprint = Footprint(w=1, d=1, h=1.3)
    tags = ("prop", "light", "lantern", "arabic")
    sockets = (
        Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),
        Socket("light", "prop", (0.5, 0.5, 0.55), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("hex", "round", "star"), variant), "plinth": rng.randint(1, 5)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        b.box((0.28, 0.28, 0.0), (0.72, 0.72, 0.12), ctx.paint("zellige", params["plinth"], tile="zellige"), bevel=0.015, segments=1, seams=("z-",))
        b.box((0.26, 0.26, 0.12), (0.74, 0.74, 0.15), ctx.paint("trims", 0, tile="stone"), bevel=0.0)
        lantern(ctx, b, 0.5, 0.5, 0.15, params["kind"], scale=2.1)
        return [b.to_object(ctx.collection)]


@register
class TreeDatePalm(ArabExtra):
    """A date palm: a straight trunk of stacked leaf-base scales, a crown of stiff arching
    fronds and hanging orange date clusters (in the canopy mesh, so they sway with it)."""

    id = "tree.date_palm"
    footprint = Footprint(w=2, d=2, h=4.8)
    max_overhang_m = 0.5
    canopy = True
    trunk = True
    tags = ("vegetation", "tree", "arabic", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)
    SEGMENTS = 9

    def variant_params(self, style, variant, rng):
        height = pick(rng, (3.6, 3.1, 4.0), variant)
        lean = pick(rng, (0.12, 0.04, 0.18), variant)
        heading = rng.uniform(0.0, 2 * math.pi)
        n = pick(rng, (11, 10, 12), variant)
        fronds = []
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.15, 0.15)) / n
            upper = i % 2 == 0
            fronds.append([round(a, 4), round(rng.uniform(0.95, 1.1), 3), round(rng.uniform(0.35, 0.55) if upper else rng.uniform(0.05, 0.2), 3)])
        return {"height": height, "lean": lean, "heading": round(heading, 4), "fronds": fronds, "dates": pick(rng, (4, 3, 5), variant), "green": variant % 2}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = [ctx.paint("bark", i, tile="bark") for i in range(3)]
        h, lean, heading = params["height"], params["lean"], params["heading"]
        n = self.SEGMENTS
        ox, oy = math.cos(heading) * lean, math.sin(heading) * lean

        def at(k: float):
            f = k / n
            return (1.0 + ox * f * f, 1.0 + oy * f * f, h * f)

        for k in range(n):
            x, y, z = at(k)
            seg = h / n
            r = 0.14 - 0.035 * k / n
            t.cylinder((x, y, z), r * 0.85, seg * 1.02, bark[k % 3], sides=7, radius_top=r * 1.12, bevel=0.0)
        t.cylinder((1.0, 1.0, 0.0), 0.2, 0.1, bark[1], sides=7, radius_top=0.14, bevel=0.0)
        top = at(n)
        c.blob(top, 0.16, canopy_paint(ctx, "foliage", 3), scale=(1.0, 1.0, 0.8), subdivisions=1, wobble=0.05)
        for a, length, rise in params["fronds"]:
            spine = []
            for i in range(4):
                s = i / 3
                d = length * s
                z = top[2] + rise * 4 * s * (1 - s) * 0.9 + 0.1 - 0.5 * length * s * s * (1.0 if rise < 0.3 else 0.6)
                spine.append((top[0] + d * math.cos(a), top[1] + d * math.sin(a), z))
            c.solid(solids.leaf(spine, [0.08, 0.26, 0.2, 0.02], thickness=0.02), canopy_paint(ctx, "foliage", params["green"] + (0 if rise < 0.3 else 2)), bevel=0.0, recalc_normals=True)
        for k in range(params["dates"]):
            a = 2 * math.pi * (k + 0.5) / params["dates"]
            c.blob((top[0] + 0.2 * math.cos(a), top[1] + 0.2 * math.sin(a), top[2] - 0.22), 0.09, canopy_paint(ctx, "dates", k % 2), scale=(0.9, 0.9, 1.5), subdivisions=1, wobble=0.15)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=top),
        ]


ARAB_EXTRA_IDS = ("arcade", "fountain.courtyard", "lantern.brass", "tree.date_palm")
"""Arabic-only modules (``KIT_STYLE_EXTRA_MODULE_IDS.arabic`` in
packages/shared/src/assets/budgets.ts)."""

__all__ = ["ARAB_EXTRA_IDS", "VariantRng"]
