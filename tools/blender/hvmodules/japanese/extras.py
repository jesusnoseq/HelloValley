"""Japanese-only props and plants (art.md §2.4): stone lanterns, the arched wooden bridge, and
the black pine and maple trees. The cherry (``tree.sakura``) is a common-kit tree (M06) and is
not repeated here; the bamboo fences are this kit's ``fence`` module.

Building recipes never use these; the town places them through the per-style town dressing
(``STYLE_TOWN_DRESSING`` in packages/shared/src/world/dressing.ts). ``bridge.wooden`` keeps the
common stone bridge's 2 x 4 footprint, sockets, sink and deck heights (``deck_z``), so it can
replace ``bridge.stone`` over the river without changing where anyone walks.

Canopy conventions follow the common kit (M06): the foliage is a separate ``canopy`` mesh with
the ``canopy`` material whose origin is the sway pivot.
"""

from __future__ import annotations

import math

from hvkit.budgets import budget_for
from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvmodules.common.base import BED_Z, GROUND_Z, SINK_M
from hvmodules.common.water import ARCH_Y, BRIDGE_D, BRIDGE_W, DECK_CROWN, deck_z

from .common import JapModule, pick


class JapExtra(JapModule):
    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        if cls.id and "tri_budget" not in cls.__dict__:
            cls.tri_budget = budget_for(cls.id)


def canopy_paint(ctx, group: str, index: int):
    return ctx.paint(group, index, tile="leaves", material="canopy")


LANTERN_LIGHT_Z = 1.0


@register
class LanternStone(JapExtra):
    """A granite garden lantern (ishidoro) with a glowing fire box: a tall kasuga-doro on a
    hexagonal pole, a wide-roofed yukimi-doro on three legs, or a low oki-doro on a rock.
    ``light`` is where a point light would go at night."""

    id = "lantern.stone"
    footprint = Footprint(w=1, d=1, h=1.9)
    tags = ("prop", "light", "lantern", "japanese")
    sockets = (
        Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),
        Socket("light", "prop", (0.5, 0.5, LANTERN_LIGHT_Z), (0.0, 0.0, 1.0)),
    )
    REACH = 0.34
    """Half-width of the widest part (the yukimi roof), inside the walking blocker."""

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("kasuga", "yukimi", "oki"), variant), "stone": variant % 3, "moss": rng.randint(0, 2)}

    def firebox(self, ctx, b, z: float, r: float, h: float, stone) -> float:
        glow = ctx.paint("light", 0, tile="plain", material="glow")
        b.cylinder((0.5, 0.5, z), r * 0.75, h, glow, sides=6, bevel=0.0, noise=0.0)
        for k in range(6):
            a = 2 * math.pi * (k + 0.5) / 6
            px, py = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a)
            b.box((px - 0.025, py - 0.025, z), (px + 0.025, py + 0.025, z + h), stone, bevel=0.0)
        return z + h

    def roof(self, ctx, b, z: float, r: float, stone) -> float:
        b.cylinder((0.5, 0.5, z), r, 0.05, stone, sides=6, bevel=0.0)
        b.cylinder((0.5, 0.5, z + 0.05), r * 0.92, 0.16, stone, sides=6, radius_top=0.06, bevel=0.0)
        b.cylinder((0.5, 0.5, z + 0.21), 0.05, 0.04, stone, sides=6, bevel=0.0)
        b.blob((0.5, 0.5, z + 0.3), 0.06, stone, scale=(1.0, 1.0, 1.2), subdivisions=1, wobble=0.0)
        return z + 0.37

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        stone = ctx.paint("stone", params["stone"], tile="paving")
        moss = ctx.paint("ground", 2, tile="leaves")
        kind = params["kind"]
        if kind == "kasuga":
            b.cylinder((0.5, 0.5, 0.0), 0.24, 0.1, stone, sides=6, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.1), 0.17, 0.08, stone, sides=6, radius_top=0.1, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.18), 0.075, 0.62, stone, sides=6, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.8), 0.1, 0.06, stone, sides=6, radius_top=0.2, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.86), 0.2, 0.05, stone, sides=6, bevel=0.0)
            top = self.firebox(ctx, b, 0.91, 0.15, 0.26, stone)
            self.roof(ctx, b, top, 0.3, stone)
            b.blob((0.62, 0.42, top + 0.06), 0.06, moss, scale=(1.3, 1.0, 0.5), subdivisions=1, wobble=0.1)
        elif kind == "yukimi":
            for k in range(3):
                a = 2 * math.pi * k / 3 + 0.3
                foot = (0.5 + 0.24 * math.cos(a), 0.5 + 0.24 * math.sin(a), 0.04)
                b.cylinder((foot[0], foot[1], 0.0), 0.06, 0.05, stone, sides=5, bevel=0.0)
                knee = (0.5 + 0.2 * math.cos(a), 0.5 + 0.2 * math.sin(a), 0.35)
                top = (0.5 + 0.1 * math.cos(a), 0.5 + 0.1 * math.sin(a), 0.52)
                b.solid(solids.tube([foot, knee, top], [0.04, 0.035, 0.03], sides=5), stone, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.5), 0.18, 0.06, stone, sides=6, bevel=0.0)
            top = self.firebox(ctx, b, 0.56, 0.13, 0.2, stone)
            b.cylinder((0.5, 0.5, top), self.REACH, 0.05, stone, sides=6, bevel=0.0)
            b.cylinder((0.5, 0.5, top + 0.05), self.REACH * 0.9, 0.12, stone, sides=6, radius_top=0.08, bevel=0.0)
            b.blob((0.5, 0.5, top + 0.22), 0.07, stone, scale=(1.0, 1.0, 0.9), subdivisions=1, wobble=0.0)
            b.blob((0.36, 0.56, top + 0.12), 0.08, moss, scale=(1.4, 1.0, 0.4), subdivisions=1, wobble=0.1)
        else:
            b.blob((0.5, 0.5, 0.1), 0.24, ctx.paint("stone", (params["stone"] + 1) % 3, tile="paving"), scale=(1.1, 0.9, 0.55), subdivisions=1, wobble=0.12, smooth=False, flatten_below=0.0)
            b.cylinder((0.5, 0.5, 0.2), 0.14, 0.05, stone, sides=6, bevel=0.0)
            top = self.firebox(ctx, b, 0.25, 0.12, 0.2, stone)
            self.roof(ctx, b, top, 0.24, stone)
            for k in range(params["moss"] + 1):
                b.blob((0.32 + 0.3 * k, 0.66, 0.12), 0.07, moss, scale=(1.3, 1.0, 0.5), subdivisions=1, wobble=0.1)
        return [b.to_object(ctx.collection)]


RAIL_H = 0.55
"""Height of the bridge's hand rail above the deck."""


@register
class BridgeWooden(JapExtra):
    """An arched wooden bridge (taikobashi), 2 cells wide and 4 long like ``bridge.stone``:
    plank deck on curved girders and posts standing in the river bed, with vermilion lacquered
    rails and bronze post caps (giboshi), plain cedar rails, or a rustic deck with a rope rail.
    The deck follows the stone bridge's height curve (``deck_z``)."""

    id = "bridge.wooden"
    footprint = Footprint(w=BRIDGE_W, d=BRIDGE_D, h=1.5)
    sink_m = SINK_M
    tags = ("water", "bridge", "walkable", "japanese")
    sockets = (
        Socket("front", "edge", (1.0, 0.0, GROUND_Z), (0.0, -1.0, 0.0)),
        Socket("back", "edge", (1.0, float(BRIDGE_D), GROUND_Z), (0.0, 1.0, 0.0)),
        Socket("crown", "prop", (1.0, BRIDGE_D / 2, GROUND_Z + DECK_CROWN), (0.0, 0.0, 1.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"rail": pick(rng, ("vermilion", "cedar", "rope"), variant), "posts": pick(rng, (6, 5, 4), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        rail = params["rail"]
        deck = ctx.paint("trims", 2 if rail != "rope" else 1, tile="timber")
        dark = ctx.paint("trims", 0, tile="timber")
        steps = 10
        band = [(BRIDGE_D * i / steps, deck_z(BRIDGE_D * i / steps)) for i in range(steps + 1)]
        b.solid(solids.prism([(y, z + 0.03) for y, z in band] + [(y, z - 0.04) for y, z in reversed(band)], "x", 0.1, BRIDGE_W - 0.1, slices=2), deck, bevel=0.0, noise=0.0)
        # Plank joints across the deck.
        for i in range(1, 16):
            y = BRIDGE_D * i / 16
            z = deck_z(y)
            b.box((0.12, y - 0.006, z + 0.03), (BRIDGE_W - 0.12, y + 0.006, z + 0.036), dark, bevel=0.0, noise=0.0)
        # Curved girders under both edges.
        girder = [(y, z - 0.04) for y, z in band] + [(y, z - 0.22) for y, z in reversed(band)]
        for xa in (0.14, BRIDGE_W - 0.26):
            b.solid(solids.prism(girder, "x", xa, xa + 0.12), dark, bevel=0.0)
        # Posts from the bed (in the river) and footings on the banks.
        a0, a1 = ARCH_Y
        for y in (a0 + 0.1, (a0 + a1) / 2, a1 - 0.1):
            for x in (0.3, BRIDGE_W - 0.3):
                b.cylinder((x, y, BED_Z), 0.07, deck_z(y) - 0.2 - BED_Z, dark, sides=6, bevel=0.0)
            b.box((0.22, y - 0.05, deck_z(y) - 0.32), (BRIDGE_W - 0.22, y + 0.05, deck_z(y) - 0.22), dark, bevel=0.0)
        stone = ctx.paint("stone", 1, tile="paving")
        for y0, y1 in ((0.0, 0.5), (BRIDGE_D - 0.5, BRIDGE_D)):
            b.box((0.1, y0, 0.0), (BRIDGE_W - 0.1, y1, GROUND_Z - 0.02), stone, bevel=0.0, seams=("z-",))
        # Rails.
        n = params["posts"]
        ys = [0.08 + (BRIDGE_D - 0.16) * i / (n - 1) for i in range(n)]
        if rail == "rope":
            rope = ctx.paint("rope", 1, tile="plain")
            for x in (0.12, BRIDGE_W - 0.12):
                for y in ys:
                    b.cylinder((x, y, deck_z(y) - 0.05), 0.04, RAIL_H, dark, sides=5, bevel=0.0)
                spine = [(x, y, deck_z(y) + RAIL_H - 0.12) for y in ys]
                b.solid(solids.tube(spine, [0.018] * len(spine), sides=4), rope, bevel=0.0)
            return [b.to_object(ctx.collection)]
        wood = ctx.paint("lacquer", 0, tile="plain") if rail == "vermilion" else ctx.paint("trims", 1, tile="timber")
        bronze = ctx.paint("roofs", 3, tile="plain")
        for x in (0.12, BRIDGE_W - 0.12):
            for y in ys:
                z = deck_z(y)
                b.box((x - 0.04, y - 0.04, z - 0.05), (x + 0.04, y + 0.04, z + RAIL_H + 0.06), wood, bevel=0.0)
                if rail == "vermilion":
                    b.cylinder((x, y, z + RAIL_H + 0.06), 0.05, 0.04, bronze, sides=6, bevel=0.0)
                    b.blob((x, y, z + RAIL_H + 0.14), 0.045, bronze, scale=(1.0, 1.0, 1.4), subdivisions=1, wobble=0.0)
            for h, r in ((RAIL_H, 0.03), (RAIL_H * 0.45, 0.022)):
                spine = [(x, BRIDGE_D * i / steps, deck_z(BRIDGE_D * i / steps) + h) for i in range(1, steps)]
                b.solid(solids.tube(spine, [r] * len(spine), sides=5), wood, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class TreePine(JapExtra):
    """A black pine (kuromatsu): a leaning, twisting trunk with two or three branches ending in
    flat cloud-pruned needle pads."""

    id = "tree.pine"
    footprint = Footprint(w=2, d=2, h=4.0)
    max_overhang_m = 0.4
    canopy = True
    trunk = True
    tags = ("vegetation", "tree", "japanese", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        height = pick(rng, (2.6, 2.2, 2.9), variant)
        heading = round(rng.uniform(0.0, 2 * math.pi), 4)
        lean = pick(rng, (0.35, 0.5, 0.25), variant)
        n = pick(rng, (3, 4, 3), variant)
        branches = []
        for i in range(n):
            a = heading + math.pi * (0.7 + 1.4 * i / max(1, n - 1)) + rng.uniform(-0.2, 0.2)
            f = 0.45 + 0.4 * i / max(1, n - 1)
            branches.append([round(a, 4), round(f, 3), round(rng.uniform(0.45, 0.65), 3), round(rng.uniform(0.32, 0.42), 3)])
        return {"height": height, "heading": heading, "lean": lean, "branches": branches, "green": variant % 3}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 1, tile="bark")
        h, heading, lean = params["height"], params["heading"], params["lean"]
        ox, oy = math.cos(heading) * lean, math.sin(heading) * lean

        def at(f: float):
            wiggle = 0.08 * math.sin(f * 5.0)
            return (1.0 + ox * f * f - oy * wiggle, 1.0 + oy * f * f + ox * wiggle, h * f)

        spine = [at(f) for f in (0.0, 0.3, 0.6, 0.85, 1.0)]
        t.solid(solids.tube(spine, [0.13, 0.11, 0.09, 0.07, 0.05], sides=6), bark, bevel=0.0, smooth=True)
        t.cylinder((1.0, 1.0, 0.0), 0.2, 0.08, bark, sides=6, radius_top=0.13, bevel=0.0)
        top = spine[-1]
        c.blob((top[0], top[1], top[2] + 0.12), 0.42, canopy_paint(ctx, "pine", params["green"]), scale=(1.3, 1.2, 0.45), subdivisions=2, wobble=0.1)
        for a, f, reach, r in params["branches"]:
            base = at(f)
            end = (min(max(base[0] + reach * math.cos(a), 0.0), 2.0), min(max(base[1] + reach * math.sin(a), 0.0), 2.0), base[2] + 0.12)
            t.solid(solids.tube([base, ((base[0] + end[0]) / 2, (base[1] + end[1]) / 2, base[2] + 0.02), end], [0.06, 0.045, 0.03], sides=5), bark, bevel=0.0, smooth=True)
            c.blob((end[0], end[1], end[2] + 0.08), r, canopy_paint(ctx, "pine", (params["green"] + 1) % 3), scale=(1.4, 1.2, 0.42), subdivisions=2, wobble=0.1)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=top),
        ]


@register
class TreeMaple(JapExtra):
    """A Japanese maple (momiji): a slim trunk forking into two or three limbs under a light,
    layered crown in autumn reds, oranges and golds."""

    id = "tree.maple"
    footprint = Footprint(w=2, d=2, h=3.6)
    max_overhang_m = 0.35
    canopy = True
    trunk = True
    tags = ("vegetation", "tree", "japanese", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        trunk_h = pick(rng, (1.2, 1.05, 1.35), variant)
        n = pick(rng, (7, 6, 8), variant)
        blobs = []
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.2, 0.2)) / n
            d = rng.uniform(0.35, 0.62)
            blobs.append([round(1.0 + d * math.cos(a), 3), round(1.0 + d * math.sin(a), 3), round(trunk_h + 0.55 + rng.uniform(-0.15, 0.45), 3), round(rng.uniform(0.32, 0.42), 3)])
        return {"trunk_h": trunk_h, "blobs": blobs, "colours": pick(rng, ((0, 3), (1, 2), (0, 2)), variant), "forks": pick(rng, (2, 3, 2), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 2, tile="bark")
        h = params["trunk_h"]
        t.solid(solids.tube([(1.0, 1.0, 0.0), (1.02, 0.98, h * 0.6), (1.0, 1.0, h)], [0.09, 0.07, 0.06], sides=6), bark, bevel=0.0, smooth=True)
        t.cylinder((1.0, 1.0, 0.0), 0.15, 0.06, bark, sides=6, radius_top=0.1, bevel=0.0)
        blobs = params["blobs"]
        for k in range(params["forks"]):
            x, y, z, _ = blobs[(k * len(blobs)) // params["forks"]]
            t.solid(solids.tube([(1.0, 1.0, h), ((1.0 + x) / 2, (1.0 + y) / 2, (h + z) / 2), (x, y, z - 0.2)], [0.05, 0.035, 0.02], sides=5), bark, bevel=0.0, smooth=True)
        c.blob((1.0, 1.0, h + 0.9), 0.5, canopy_paint(ctx, "maple", params["colours"][0]), scale=(1.15, 1.15, 0.7), subdivisions=2, wobble=0.1)
        for i, (x, y, z, r) in enumerate(blobs):
            c.blob((x, y, z), r, canopy_paint(ctx, "maple", params["colours"][i % 2]), scale=(1.1, 1.1, 0.75), subdivisions=1 if i % 2 else 2, wobble=0.12)
        return [
            t.to_object(ctx.collection, part="trunk"),
            c.to_object(ctx.collection, part="canopy", origin=(1.0, 1.0, h)),
        ]


JAP_EXTRA_IDS = ("lantern.stone", "bridge.wooden", "tree.pine", "tree.maple")
"""Japanese-only modules (``KIT_STYLE_EXTRA_MODULE_IDS.japanese`` in
packages/shared/src/assets/budgets.ts)."""
