"""Mediterranean-only props and plants (art.md §2.2): a wooden pergola with a vine or
bougainvillea, a bougainvillea climber, big terracotta pots and the lemon tree.

These have no European counterpart, so building recipes never use them; the town places only
modules every style kit has. TODO(no milestone yet): style-specific dressing of the town would
need a per-style prop table in ``packages/shared/src/world`` (see pending.md, M32). Olive and cypress trees are already in
the style-neutral common kit (M06) and are not repeated here.

Canopy conventions follow the common kit (M06): the foliage is a separate ``canopy`` mesh with
the ``canopy`` material whose origin is the sway pivot.
"""

from __future__ import annotations

import math

from hvkit.budgets import budget_for
from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .common import MedModule, pick


class MedExtra(MedModule):
    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        if cls.id and "tri_budget" not in cls.__dict__:
            cls.tri_budget = budget_for(cls.id)


def canopy_paint(ctx, group: str, index: int):
    return ctx.paint(group, index, tile="leaves", material="canopy")


@register
class Pergola(MedExtra):
    """A 2 x 2 timber pergola: four posts, two beams and rafters, covered by a grapevine, a
    bougainvillea or a wisteria-like jasmine. The wood is the ``trunk`` mesh and the leaves are
    the swaying ``canopy``."""

    id = "pergola"
    footprint = Footprint(w=2, d=2, h=2.8)
    max_overhang_m = 0.15
    canopy = True
    trunk = True
    tags = ("prop", "pergola", "mediterranean", "canopy")
    TOP = 2.35
    sockets = (
        Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        Socket("under", "prop", (1.0, 1.0, 0.0), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        kind = pick(rng, ("vine", "bougainvillea", "jasmine"), variant)
        blobs = []
        for i in range(7):
            x = 0.3 + (i % 4) * 0.47 + rng.uniform(-0.08, 0.08)
            y = 0.45 if i < 4 else 1.4
            blobs.append([round(x if i < 4 else x + 0.235, 3), round(y + rng.uniform(-0.15, 0.15), 3), round(rng.uniform(0.0, 0.12), 3)])
        return {"kind": kind, "wood": pick(rng, (1, 1, 2), variant), "blobs": blobs}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        wood = ctx.paint("trims", params["wood"], tile="timber")
        top = self.TOP
        for x, y in ((0.1, 0.1), (1.8, 0.1), (0.1, 1.8), (1.8, 1.8)):
            t.box((x, y, 0.0), (x + 0.1, y + 0.1, top), wood, bevel=0.015, segments=1, seams=("z-",))
        for y in (0.1, 1.8):
            t.box((-0.05, y, top), (2.05, y + 0.1, top + 0.12), wood, bevel=0.012, segments=1)
        for k in range(6):
            x = 0.05 + k * 0.37
            t.box((x, -0.1, top + 0.12), (x + 0.06, 2.1, top + 0.2), wood, bevel=0.0)
        stem = ctx.paint("bark", 0, tile="bark")
        t.solid(solids.tube([(0.2, 0.25, 0.0), (0.24, 0.22, 1.2), (0.16, 0.2, top - 0.1)], [0.04, 0.035, 0.03], sides=5), stem, bevel=0.0, smooth=True)
        kind = params["kind"]
        for x, y, dz in params["blobs"]:
            c.blob((x, y, top + 0.28 + dz), 0.28, canopy_paint(ctx, "foliage", 1 if kind == "vine" else 0), scale=(1.0, 1.0, 0.45), subdivisions=1, wobble=0.12)
        deco = VariantRng(len(params["blobs"]) * 17 + variant)
        for k in range(10):
            x, y, _ = params["blobs"][k % len(params["blobs"])]
            p = (x + deco.uniform(-0.25, 0.25), y + deco.uniform(-0.25, 0.25), top + 0.06 - deco.uniform(0.0, 0.25))
            if kind == "vine":
                c.blob(p, 0.06, canopy_paint(ctx, "grapes", k % 2), scale=(0.8, 0.8, 1.3), subdivisions=1, wobble=0.05)
            elif kind == "bougainvillea":
                c.blob(p, 0.13, canopy_paint(ctx, "blossom", k % 3), scale=(1.0, 1.0, 0.8), subdivisions=1, wobble=0.12)
            else:
                c.blob(p, 0.1, canopy_paint(ctx, "flowers", 2 if k % 2 else 3), scale=(0.7, 0.7, 1.4), subdivisions=1, wobble=0.1)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=(1.0, 1.0, top)),
        ]


@register
class Bougainvillea(MedExtra):
    """A bougainvillea climber trained up the back of its cell (stand it against a wall): a
    woody stem fanning into magenta, pink or white bracts."""

    id = "bougainvillea"
    footprint = Footprint(w=1, d=1, h=3.0)
    max_overhang_m = 0.1
    canopy = True
    trunk = True
    tags = ("vegetation", "climber", "mediterranean", "canopy")
    sockets = (Socket("base", "prop", (0.5, 0.85, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        colour = pick(rng, (0, 1, 3), variant)
        n = pick(rng, (9, 8, 10), variant)
        blobs = []
        for i in range(n):
            a = math.pi * (0.1 + 0.8 * i / max(1, n - 1))
            r = rng.uniform(0.22, 0.34)
            blobs.append([round(0.5 + r * math.cos(a) * 1.0, 3), round(0.8 + rng.uniform(-0.05, 0.05), 3), round(1.3 + r * math.sin(a) * 2.4 + rng.uniform(-0.1, 0.1), 3)])
        return {"colour": colour, "blobs": blobs, "height": pick(rng, (1.6, 1.4, 1.8), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 2, tile="bark")
        h = params["height"]
        t.solid(solids.tube([(0.5, 0.85, 0.0), (0.46, 0.85, h * 0.5), (0.52, 0.84, h)], [0.05, 0.04, 0.03], sides=6), bark, bevel=0.0, smooth=True)
        for dx in (-0.25, 0.25):
            t.solid(solids.tube([(0.52, 0.84, h), (0.5 + dx, 0.82, h + 0.5)], [0.025, 0.018], sides=5), bark, bevel=0.0, smooth=True)
        t.cylinder((0.5, 0.85, 0.0), 0.1, 0.08, ctx.paint("pot", 2, tile="terracotta"), sides=7, radius_top=0.08, bevel=0.0)
        for i, (x, y, z) in enumerate(params["blobs"]):
            group, idx = ("blossom", params["colour"]) if i % 3 else ("foliage", 1)
            if group == "blossom" and i % 2:
                idx = (idx + 1) % 4 if params["colour"] != 3 else 3
            c.blob((x, y, z), 0.17, canopy_paint(ctx, group, idx), scale=(1.1, 0.55, 1.0), subdivisions=1, wobble=0.12)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=(0.5, 0.85, h)),
        ]


@register
class PotTerracotta(MedExtra):
    """A big terracotta pot (1 x 1 cell) with geraniums, an agave or a clipped bay ball."""

    id = "pot.terracotta"
    footprint = Footprint(w=1, d=1, h=1.4)
    tags = ("prop", "plant", "mediterranean")
    sockets = (Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {"plant": pick(rng, ("geraniums", "agave", "topiary"), variant), "pot": variant % 3, "leaves": rng.randint(7, 9)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        pot = ctx.paint("pot", params["pot"], tile="terracotta")
        b.cylinder((0.5, 0.5, 0.0), 0.2, 0.08, pot, sides=10, radius_top=0.24, bevel=0.0)
        b.cylinder((0.5, 0.5, 0.08), 0.24, 0.36, pot, sides=10, radius_top=0.3, bevel=0.0)
        b.cylinder((0.5, 0.5, 0.44), 0.33, 0.07, pot, sides=10, bevel=0.0)
        soil = ctx.paint("bark", 2, tile="plain")
        b.cylinder((0.5, 0.5, 0.5), 0.28, 0.02, soil, sides=10, bevel=0.0)
        plant = params["plant"]
        if plant == "geraniums":
            leaf = ctx.paint("foliage", 0, tile="plain")
            b.blob((0.5, 0.5, 0.68), 0.27, leaf, scale=(1.0, 1.0, 0.7), subdivisions=2, wobble=0.12)
            for k in range(7):
                a = 2 * math.pi * k / 7
                b.blob((0.5 + 0.2 * math.cos(a), 0.5 + 0.2 * math.sin(a), 0.8 + 0.04 * (k % 2)), 0.06, ctx.paint("flowers", k % 2, tile="plain"), subdivisions=1, wobble=0.08)
        elif plant == "agave":
            leaf = ctx.paint("foliage", 2, tile="plain")
            n = params["leaves"]
            for k in range(n):
                a = 2 * math.pi * k / n
                out = 0.32 if k % 2 else 0.24
                spine = [(0.5, 0.5, 0.52), (0.5 + out * 0.5 * math.cos(a), 0.5 + out * 0.5 * math.sin(a), 0.8), (0.5 + out * math.cos(a), 0.5 + out * math.sin(a), 1.0 if k % 2 else 1.1)]
                b.solid(solids.leaf(spine, [0.12, 0.08, 0.01], thickness=0.03), leaf, bevel=0.0, recalc_normals=True)
        else:
            bark = ctx.paint("bark", 0, tile="bark")
            b.cylinder((0.5, 0.5, 0.5), 0.025, 0.45, bark, sides=6, bevel=0.0)
            b.blob((0.5, 0.5, 1.12), 0.24, ctx.paint("foliage", 3, tile="leaves"), subdivisions=2, wobble=0.04)
        return [b.to_object(ctx.collection)]


@register
class TreeLemon(MedExtra):
    """A lemon tree: a short trunk and a dense round dark-green canopy dotted with lemons (in the
    canopy mesh, so they sway with it)."""

    id = "tree.lemon"
    footprint = Footprint(w=2, d=2, h=3.2)
    max_overhang_m = 0.3
    canopy = True
    trunk = True
    tags = ("vegetation", "tree", "mediterranean", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        trunk_h = pick(rng, (0.95, 1.1, 0.85), variant)
        main = pick(rng, (0.62, 0.55, 0.68), variant)
        n = pick(rng, (4, 5, 4), variant)
        blobs = [[1.0, 1.0, round(trunk_h + main * 0.85, 3), main]]
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.2, 0.2)) / n
            d = main * 0.6
            blobs.append([round(1.0 + d * math.cos(a), 3), round(1.0 + d * math.sin(a), 3), round(trunk_h + main * rng.uniform(0.6, 1.0), 3), round(main * 0.62, 3)])
        fruit = []
        for k in range(12):
            a = 2 * math.pi * k / 12 + rng.uniform(-0.2, 0.2)
            el = rng.uniform(-0.3, 0.7)
            r = main + 0.12
            fruit.append([round(1.0 + r * math.cos(a) * math.cos(el), 3), round(1.0 + r * math.sin(a) * math.cos(el), 3), round(trunk_h + main * 0.85 + r * 0.85 * math.sin(el), 3)])
        return {"trunk_h": trunk_h, "blobs": blobs, "fruit": fruit, "lean": round(rng.uniform(-0.08, 0.08), 3)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 1, tile="bark")
        h = params["trunk_h"]
        lean = params["lean"]
        t.solid(solids.tube([(1.0, 1.0, 0.0), (1.0 + lean, 1.0, h * 0.6), (1.0 + lean * 0.5, 1.0 + lean, h + 0.1)], [0.1, 0.075, 0.06], sides=7), bark, bevel=0.0, smooth=True)
        t.cylinder((1.0, 1.0, 0.0), 0.18, 0.08, bark, sides=7, radius_top=0.12, bevel=0.0)
        for i, (x, y, z, r) in enumerate(params["blobs"]):
            c.blob((x, y, z), r, canopy_paint(ctx, "foliage", 3 if i % 2 == 0 else 1), scale=(1.0, 1.0, 0.92), subdivisions=2, wobble=0.06)
        for k, p in enumerate(params["fruit"]):
            c.blob(tuple(p), 0.055, canopy_paint(ctx, "citrus", k % 2), scale=(1.0, 1.0, 1.25), subdivisions=1, wobble=0.03)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=(1.0 + lean * 0.5, 1.0 + lean, h)),
        ]


MED_EXTRA_IDS = ("pergola", "bougainvillea", "pot.terracotta", "tree.lemon")
"""Mediterranean-only modules (``KIT_STYLE_EXTRA_MODULE_IDS.mediterranean`` in
packages/shared/src/assets/budgets.ts)."""

