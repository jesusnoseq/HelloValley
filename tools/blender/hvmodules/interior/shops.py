"""Shop and workplace interiors, one set per NPC building (GDD §4.1): the bakery counter and
oven, the general store shelves, the café bar, the clinic desk, the library shelves, the town
hall desk and the farm barn's stall and hay. Counters have a ``vendor`` socket behind them,
where the NPC stands, and a ``counter`` socket on their front edge at counter height, where the
player talks and trades."""

from __future__ import annotations

import math

from hvkit import solids
from hvkit.grid import Placement
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import FRONT, UP, Furniture, arch_profile, ellipse, pick, use_socket
from .parts import books, bread, case, jars, knob, legs


def counter_sockets(placement: Placement, counter_z: float):
    w = placement.width_m
    return (
        use_socket(placement),
        Socket("vendor", "prop", (w / 2, placement.depth_m - 0.2, 0.0), FRONT),
        Socket("counter", "prop", (w / 2, 0.0, counter_z), FRONT),
    )


def counter_body(b, body, panel, x0: float, x1: float, y0: float, y1: float, h: float, top, panels: int = 3) -> None:
    """A shop counter: plinth, a body with raised front panels and an overhanging top."""
    b.box((x0 + 0.03, y0 + 0.04, 0.0), (x1 - 0.03, y1, 0.08), panel, bevel=0.0)
    b.box((x0 + 0.02, y0 + 0.03, 0.08), (x1 - 0.02, y1, h - 0.05), body, bevel=0.01, segments=1)
    span = (x1 - x0 - 0.08) / panels
    for k in range(panels):
        a = x0 + 0.04 + span * k
        b.box((a + 0.04, y0 + 0.015, 0.16), (a + span - 0.04, y0 + 0.03, h - 0.14), panel, bevel=0.005, segments=1)
    b.box((x0, y0, h - 0.05), (x1, y1 + 0.02 if y1 + 0.02 <= 1.0 else y1, h), top, bevel=0.01, segments=1)


@register
class BakeryCounter(Furniture):
    """The Baker's counter: a stepped display of loaves, rolls, croissants and cakes behind a
    glass sneeze guard, with a till and a bell."""

    id = "bakery.counter"
    placement = Placement(w=4, d=2)
    height = 1.35
    tags = ("furniture", "shop", "bakery", "counter")
    sockets = counter_sockets(placement, 0.9)

    def variant_params(self, style, variant, rng):
        return {
            "body": pick(rng, (("paint", 1), ("wood", 0), ("paint", 3)), variant),
            "goods": pick(rng, (("loaf", "round"), ("croissant", "loaf"), ("cake", "croissant")), variant),
            "seed": rng.randint(0, 9999),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        wood = ctx.paint("wood", 1, tile="wood")
        counter_body(b, body, ctx.paint("trim", 0, tile="wood"), 0.0, 2.0, 0.0, 0.6, 0.9, wood, panels=4)
        # Two tiers of baskets/trays on top, the back one higher.
        r = VariantRng(params["seed"])
        lower, upper = params["goods"]
        for z, y, kind in ((0.9, 0.18, lower), (1.0, 0.42, upper)):
            if z > 0.9:
                b.box((0.1, 0.32, 0.9), (1.5, 0.56, 1.0), wood, bevel=0.008, segments=1)
            b.box((0.12, y - 0.1, z), (1.48, y + 0.1, z + 0.02), ctx.paint("ceramic", 0, tile="plain"), bevel=0.0)
            for k in range(6):
                bread(b, ctx, r, 0.24 + k * 0.22, y + r.uniform(-0.02, 0.02), z + 0.02, kind, r.randint(0, 2))
        glass = ctx.paint("glass", 1, tile="plain", material="glass")
        for x in (0.1, 1.48):
            b.box((x, 0.06, 0.9), (x + 0.02, 0.1, 1.32), ctx.paint("metal", 2, tile="plain"), bevel=0.0)
        b.box((0.1, 0.06, 1.3), (1.5, 0.3, 1.32), glass, bevel=0.0, noise=0.0)
        # Till and bell at the end.
        b.box((1.6, 0.2, 0.9), (1.92, 0.5, 1.05), ctx.paint("metal", 1, tile="plain"), bevel=0.012, segments=1)
        b.solid(solids.prism([(0.25, 1.05), (0.5, 1.05), (0.5, 1.15), (0.32, 1.12)], "x", 1.63, 1.89), ctx.paint("metal", 0, tile="plain"), bevel=0.0)
        b.cylinder((1.75, 0.1, 0.9), 0.05, 0.05, ctx.paint("metal", 2, tile="plain"), sides=8, radius_top=0.01, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class BakeryOven(Furniture):
    """The bread oven against the back wall, fire glowing in its mouth: a brick dome oven, a
    tiled double-deck oven, or a stone hearth with a bread peel."""

    id = "bakery.oven"
    placement = Placement(w=3, d=2, against_wall=True)
    height = 2.4
    tags = ("furniture", "shop", "bakery", "light")
    sockets = (use_socket(placement), Socket("fire", "prop", (0.75, 0.3, 0.75), FRONT))

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("dome", "deck", "hearth"), variant), "brick": pick(rng, (0, 1, 2), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        brick = ctx.paint("brick", params["brick"], tile="brick")
        fire = ctx.paint("fire", 0, tile="plain", material="glow")
        soot = ctx.paint("metal", 0, tile="plain")
        kind = params["kind"]
        if kind == "deck":
            tiles = ctx.paint("tiles", 0, tile="tiles")
            b.box((0.1, 0.15, 0.0), (1.4, 1.0, 1.9), tiles, bevel=0.015, segments=1)
            for z0 in (0.35, 1.05):
                b.box((0.25, 0.14, z0), (1.25, 0.15, z0 + 0.5), soot, bevel=0.0)
                b.box((0.35, 0.13, z0 + 0.08), (1.15, 0.14, z0 + 0.34), fire, bevel=0.0, noise=0.0)
                b.solid(solids.tube([(0.3, 0.09, z0 + 0.42), (1.2, 0.09, z0 + 0.42)], [0.015, 0.015], sides=6), ctx.paint("metal", 2, tile="plain"), bevel=0.0)
                for x in (0.3, 1.2):
                    b.box((x - 0.01, 0.09, z0 + 0.41), (x + 0.01, 0.15, z0 + 0.43), ctx.paint("metal", 2, tile="plain"), bevel=0.0)
            b.box((0.05, 0.12, 1.9), (1.45, 1.0, 2.0), ctx.paint("metal", 1, tile="plain"), bevel=0.01, segments=1)
            b.cylinder((1.1, 0.7, 2.0), 0.1, 0.4, ctx.paint("metal", 1, tile="plain"), sides=8, bevel=0.0)
            return [b.to_object(ctx.collection)]
        stone = ctx.paint("stone", 1, tile="stone")
        b.box((0.05, 0.12, 0.0), (1.45, 1.0, 0.7), brick if kind == "dome" else stone, bevel=0.015, segments=1)
        b.box((0.02, 0.08, 0.7), (1.48, 1.0, 0.78), stone, bevel=0.012, segments=1)
        if kind == "dome":
            b.blob((0.75, 0.58, 0.78), 0.58, brick, scale=(1.15, 0.72, 1.05), subdivisions=2, wobble=0.02, smooth=False, flatten_below=0.78)
            b.box((0.55, 0.85, 1.2), (0.95, 1.0, 2.4), brick, bevel=0.01, segments=1)
        else:
            b.box((0.12, 0.2, 0.78), (1.38, 1.0, 1.5), stone, bevel=0.015, segments=1)
            b.solid(solids.prism([(0.2, 1.5), (1.0, 1.5), (1.0, 2.4), (0.6, 2.4)], "x", 0.35, 1.15), stone, bevel=0.012, segments=1)
            peel = ctx.paint("wood", 0, tile="wood")
            b.solid(solids.tube([(1.38, 0.06, 0.05), (1.42, 0.1, 1.5)], [0.015, 0.015], sides=5), peel, bevel=0.0)
            b.box((1.3, 0.04, 0.0), (1.48, 0.07, 0.25), peel, bevel=0.0)
        # The arched mouth with the fire inside.
        b.solid(solids.prism(arch_profile(0.47, 1.03, 0.8, 0.98, 8), "y", 0.07 if kind == "dome" else 0.17, 0.2 if kind == "dome" else 0.22), stone, bevel=0.0)
        y_mouth = 0.065 if kind == "dome" else 0.165
        b.solid(solids.prism(arch_profile(0.53, 0.97, 0.8, 0.96, 8), "y", y_mouth, y_mouth + 0.006), soot, bevel=0.0, noise=0.0)
        for k, (x, rad) in enumerate(((0.65, 0.06), (0.78, 0.075), (0.88, 0.05))):
            b.blob((x, y_mouth - 0.004, 0.86), rad, fire, scale=(1.0, 0.2, 1.3), subdivisions=1, wobble=0.1)
        # Logs stacked beneath.
        for k in range(3):
            b.solid(solids.tube([(0.2 + k * 0.12, 0.1, 0.12), (0.2 + k * 0.12, 0.6, 0.12)], [0.05, 0.05], sides=6), ctx.paint("darkwood", k % 3, tile="wood"), bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class StoreShelf(Furniture):
    """The Shopkeeper's 2 m shelving: groceries (jars, tins, boxes), household goods (pots,
    rope, watering cans) or colourful fabric bolts and yarn, with price tags."""

    id = "store.shelf"
    placement = Placement(w=4, d=1, against_wall=True)
    height = 2.0
    tags = ("furniture", "shop", "store", "storage")
    sockets = (use_socket(placement),)

    def variant_params(self, style, variant, rng):
        return {"goods": pick(rng, ("groceries", "household", "fabric"), variant), "body": pick(rng, (("wood", 1), ("paint", 0), ("darkwood", 2)), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        shelves = (0.5, 0.95, 1.4)
        case(b, body, 0.0, 0.12, 2.0, 0.5, 1.95, shelves, t=0.035)
        b.box((0.97, 0.12, 0.06), (1.03, 0.5, 1.92), body, bevel=0.0)
        r = VariantRng(params["seed"])
        levels = (0.08,) + shelves
        goods = params["goods"]
        for k, z in enumerate(levels):
            for x0, x1 in ((0.05, 0.95), (1.05, 1.95)):
                hmax = (levels[k + 1] if k + 1 < len(levels) else 1.92) - z - 0.08
                if goods == "groceries":
                    if (k + int(x0)) % 2 == 0:
                        jars(b, ctx, r, x0, x1, 0.3, z, min(0.22, hmax), 0.06, groups=(("glass", 0), ("food", 0), ("food", 1), ("food", 2)), sides=6)
                    else:
                        x = x0
                        while x < x1 - 0.14:
                            w = r.uniform(0.12, 0.18)
                            b.box((x, 0.16, z), (x + w, 0.46, z + r.uniform(0.15, min(0.3, hmax))), ctx.paint("paint", r.randint(0, 4), tile="plain"), bevel=0.0)
                            x += w + 0.02
                elif goods == "household":
                    if k % 2 == 0:
                        for x in (x0 + 0.15, x0 + 0.45, x0 + 0.75):
                            b.cylinder((x, 0.3, z), 0.12, 0.14, ctx.paint("metal", r.randint(0, 1), tile="plain"), sides=10, bevel=0.0)
                            b.solid(solids.tube([(x - 0.1, 0.3, z + 0.13), (x - 0.16, 0.3, z + 0.13)], [0.012, 0.012], sides=4), ctx.paint("darkwood", 0, tile="plain"), bevel=0.0)
                    else:
                        for x in (x0 + 0.2, x0 + 0.62):
                            b.cylinder((x, 0.3, z), 0.12, 0.08, ctx.paint("hay", 0, tile="straw"), sides=10, bevel=0.0)
                            b.cylinder((x, 0.3, z + 0.08), 0.1, 0.07, ctx.paint("hay", 1, tile="straw"), sides=10, bevel=0.0)
                else:
                    x = x0
                    while x < x1 - 0.1:
                        w = r.uniform(0.1, 0.14)
                        if k % 2 == 0:
                            b.solid(solids.tube([(x + w / 2, 0.16, z + w / 2), (x + w / 2, 0.46, z + w / 2)], [w / 2, w / 2], sides=8), ctx.paint("fabric", r.randint(0, 5), tile="fabric"), bevel=0.0)
                        else:
                            b.blob((x + w / 2, 0.3, z + w * 0.45), w * 0.5, ctx.paint("fabric", r.randint(0, 5), tile="fabric"), subdivisions=1, wobble=0.05)
                        x += w + 0.015
                # A price tag on the shelf edge.
                b.box((x0 + 0.35, 0.115, z - 0.05), (x0 + 0.47, 0.12, z), ctx.paint("paper", 0, tile="plain"), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
class CafeBar(Furniture):
    """The Barista's bar: a counter with an espresso machine, a cake stand under a glass dome,
    cups, a tip jar and a chalk menu stand."""

    id = "cafe.bar"
    placement = Placement(w=4, d=2)
    height = 1.42
    tags = ("furniture", "shop", "cafe", "counter")
    sockets = counter_sockets(placement, 1.0)

    def variant_params(self, style, variant, rng):
        return {
            "body": pick(rng, (("darkwood", 0), ("paint", 0), ("wood", 2)), variant),
            "machine": pick(rng, (("fabric", 0), ("metal", 1), ("paint", 2)), variant),
            "seed": rng.randint(0, 9999),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        counter_body(b, body, ctx.paint("tiles", 0, tile="tiles"), 0.0, 2.0, 0.0, 0.65, 1.0, ctx.paint("stone", 0, tile="stone"), panels=3)
        machine = ctx.paint(params["machine"][0], params["machine"][1], tile="plain")
        metal = ctx.paint("metal", 1, tile="plain")
        dark = ctx.paint("metal", 0, tile="plain")
        # Espresso machine.
        b.box((0.15, 0.3, 1.0), (0.75, 0.62, 1.32), machine, bevel=0.03, segments=2)
        b.box((0.2, 0.26, 1.02), (0.7, 0.3, 1.04), metal, bevel=0.0)
        for x in (0.3, 0.6):
            b.cylinder((x, 0.27, 1.15), 0.035, 0.05, metal, sides=8, bevel=0.0)
            b.solid(solids.tube([(x, 0.25, 1.16), (x, 0.12, 1.15)], [0.01, 0.01], sides=4), dark, bevel=0.0)
            b.cylinder((x, 0.3, 1.04), 0.03, 0.05, ctx.paint("ceramic", 0, tile="plain"), sides=8, bevel=0.0)
        b.cylinder((0.45, 0.46, 1.32), 0.05, 0.08, metal, sides=8, radius_top=0.03, bevel=0.0)
        # Cake stand under a dome.
        b.cylinder((1.15, 0.35, 1.0), 0.05, 0.1, ctx.paint("ceramic", 0, tile="plain"), sides=8, bevel=0.0)
        b.cylinder((1.15, 0.35, 1.1), 0.18, 0.02, ctx.paint("ceramic", 0, tile="plain"), sides=14, bevel=0.0)
        b.cylinder((1.15, 0.35, 1.12), 0.13, 0.1, ctx.paint("bread", 2, tile="plain"), sides=14, bevel=0.0)
        b.cylinder((1.15, 0.35, 1.22), 0.135, 0.03, ctx.paint("food", 3, tile="plain"), sides=14, bevel=0.0)
        b.blob((1.15, 0.35, 1.12), 0.17, ctx.paint("glass", 1, tile="plain", material="glass"), scale=(1.0, 1.0, 1.15), subdivisions=2, wobble=0.0, flatten_below=1.12)
        # Cups, a tip jar and the chalk menu.
        for k in range(3):
            x = 1.45 + k * 0.1
            b.cylinder((x, 0.2, 1.0), 0.035, 0.07, ctx.paint("ceramic", k % 2, tile="plain"), sides=8, bevel=0.0)
        b.cylinder((1.8, 0.2, 1.0), 0.05, 0.12, ctx.paint("glass", 0, tile="plain", material="glass"), sides=8, bevel=0.0)
        b.box((1.5, 0.5, 1.0), (1.9, 0.54, 1.02), ctx.paint("darkwood", 0, tile="plain"), bevel=0.0)
        b.solid(solids.prism([(0.42, 1.02), (0.5, 1.02), (0.47, 1.3), (0.45, 1.3)], "x", 1.52, 1.88), ctx.paint("darkwood", 1, tile="wood"), bevel=0.0)
        r = VariantRng(params["seed"])
        for k in range(3):
            b.box((1.57, 0.44 - 0.01 * k, 1.1 + k * 0.06), (1.57 + r.uniform(0.15, 0.25), 0.45 - 0.01 * k, 1.12 + k * 0.06), ctx.paint("paper", 0, tile="plain"), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
class ClinicDesk(Furniture):
    """The Doctor's reception desk: a tall front ledge with a first-aid box, a clipboard, a
    desk bell and a plant."""

    id = "clinic.desk"
    placement = Placement(w=3, d=2)
    height = 1.3
    tags = ("furniture", "shop", "clinic", "counter")
    sockets = counter_sockets(placement, 1.05)

    def variant_params(self, style, variant, rng):
        return {"body": pick(rng, (("paint", 4), ("paint", 0), ("wood", 2)), variant), "extra": pick(rng, ("plant", "jar", "files"), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        white = ctx.paint("ceramic", 0, tile="plain")
        counter_body(b, body, ctx.paint("paint", 0, tile="wood"), 0.0, 1.5, 0.0, 0.45, 1.05, white, panels=2)
        # The working desk behind, lower.
        b.box((0.05, 0.45, 0.0), (1.45, 0.75, 0.72), body, bevel=0.01, segments=1)
        b.box((0.03, 0.45, 0.72), (1.47, 0.8, 0.76), white, bevel=0.008, segments=1)
        # A green cross on the front.
        green = ctx.paint("foliage", 1, tile="plain")
        b.box((0.7, 0.003, 0.45), (0.8, 0.02, 0.75), green, bevel=0.0, noise=0.0)
        b.box((0.6, 0.003, 0.55), (0.9, 0.02, 0.65), green, bevel=0.0, noise=0.0)
        # First-aid box, clipboard and bell on the ledge.
        b.box((0.12, 0.12, 1.05), (0.42, 0.36, 1.22), white, bevel=0.01, segments=1)
        red = ctx.paint("food", 0, tile="plain")
        b.box((0.24, 0.115, 1.1), (0.3, 0.12, 1.18), red, bevel=0.0, noise=0.0)
        b.box((0.23, 0.115, 1.12), (0.31, 0.12, 1.16), red, bevel=0.0, noise=0.0)
        b.box((0.6, 0.1, 1.05), (0.85, 0.4, 1.065), ctx.paint("wood", 0, tile="wood"), bevel=0.0)
        b.box((0.62, 0.13, 1.065), (0.83, 0.37, 1.07), ctx.paint("paper", 0, tile="plain"), bevel=0.0, noise=0.0)
        b.box((0.68, 0.33, 1.07), (0.77, 0.37, 1.09), ctx.paint("metal", 1, tile="plain"), bevel=0.0)
        b.cylinder((1.05, 0.25, 1.05), 0.05, 0.05, ctx.paint("metal", 2, tile="plain"), sides=8, radius_top=0.012, bevel=0.0)
        extra = params["extra"]
        if extra == "plant":
            b.cylinder((1.3, 0.25, 1.05), 0.07, 0.11, ctx.paint("pot", 1, tile="plain"), sides=8, radius_top=0.08, bevel=0.0)
            for k in range(4):
                b.blob((1.3 + 0.04 * math.cos(k * 1.6), 0.25 + 0.04 * math.sin(k * 1.6), 1.22), 0.06, ctx.paint("foliage", k % 4, tile="leaves"), subdivisions=1, wobble=0.12)
        elif extra == "jar":
            b.cylinder((1.3, 0.25, 1.05), 0.07, 0.16, ctx.paint("glass", 0, tile="plain", material="glass"), sides=8, bevel=0.0)
            for k in range(4):
                b.blob((1.28 + 0.02 * k, 0.25, 1.24 + 0.01 * k), 0.02, ctx.paint("art", k, tile="plain"), subdivisions=1, wobble=0.0)
        else:
            for k in range(3):
                b.box((1.15, 0.12 + 0.01 * k, 1.05 + 0.05 * k), (1.43, 0.38, 1.09 + 0.05 * k), ctx.paint("paint", k + 1, tile="plain"), bevel=0.0)
        # A monitor-less cosy desk: a lamp glow and a stack of folders behind.
        b.box((0.2, 0.55, 0.76), (0.5, 0.75, 0.86), ctx.paint("paint", 2, tile="plain"), bevel=0.0)
        b.cylinder((1.2, 0.65, 0.76), 0.06, 0.02, ctx.paint("metal", 2, tile="plain"), sides=8, bevel=0.0)
        b.cylinder((1.2, 0.65, 0.78), 0.012, 0.25, ctx.paint("metal", 2, tile="plain"), sides=5, bevel=0.0)
        b.cylinder((1.2, 0.65, 0.98), 0.09, 0.1, ctx.paint("foliage", 1, tile="plain"), sides=10, radius_top=0.04, bevel=0.0)
        b.blob((1.2, 0.65, 0.99), 0.035, ctx.paint("light", 0, tile="plain", material="glow"), subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
class LibraryShelf(Furniture):
    """A tall 1 m library bookcase with a crown: packed with books, books with a globe and
    bookends, or books with a rolling ladder leaning on it."""

    id = "library.shelf"
    placement = Placement(w=2, d=1, against_wall=True)
    height = 2.6
    tags = ("furniture", "shop", "library", "storage")
    sockets = (use_socket(placement),)

    def variant_params(self, style, variant, rng):
        return {"extra": pick(rng, ("full", "globe", "ladder"), variant), "body": pick(rng, (("darkwood", 0), ("darkwood", 2), ("wood", 1)), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        shelves = (0.5, 0.9, 1.3, 1.7, 2.1)
        case(b, body, 0.0, 0.18, 1.0, 0.5, 2.5, shelves, t=0.035, top_overhang=0.0)
        b.box((0.0, 0.15, 2.5), (1.0, 0.5, 2.6), body, bevel=0.01, segments=1)
        r = VariantRng(params["seed"])
        levels = (0.08,) + shelves
        extra = params["extra"]
        for k, z in enumerate(levels):
            hmax = (levels[k + 1] if k + 1 < len(levels) else 2.465) - z - 0.05
            if extra == "globe" and k == 3:
                books(b, ctx, r, 0.05, 0.5, 0.21, 0.48, z, hmax)
                b.cylinder((0.72, 0.34, z), 0.07, 0.03, ctx.paint("darkwood", 1, tile="wood"), sides=8, bevel=0.0)
                b.blob((0.72, 0.34, z + 0.17), 0.13, ctx.paint("glass", 0, tile="plain"), subdivisions=2, wobble=0.0)
                b.blob((0.69, 0.3, z + 0.2), 0.07, ctx.paint("foliage", 1, tile="plain"), scale=(1.0, 0.9, 0.8), subdivisions=1, wobble=0.1)
                continue
            books(b, ctx, r, 0.05, 0.95, 0.21, 0.48, z, hmax, gap_chance=0.05)
        if extra == "ladder":
            wood = ctx.paint("wood", 0, tile="wood")
            for x in (0.18, 0.62):
                b.solid(solids.tube([(x, 0.03, 0.015), (x, 0.15, 2.45)], [0.02, 0.02], sides=5), wood, bevel=0.0)
            for k in range(7):
                z = 0.3 + k * 0.32
                y = 0.03 + 0.12 * z / 2.45
                b.solid(solids.tube([(0.18, y, z), (0.62, y, z)], [0.014, 0.014], sides=4), wood, bevel=0.0)
            b.solid(solids.tube([(0.05, 0.16, 2.45), (0.95, 0.16, 2.45)], [0.012, 0.012], sides=6), ctx.paint("metal", 2, tile="plain"), bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class TownHallDesk(Furniture):
    """The Mayor's grand desk: carved front panels, a nameplate, a stamp and ink, papers, and two
    little flags (or a globe, or the festival bell)."""

    id = "townhall.desk"
    placement = Placement(w=4, d=2)
    height = 1.5
    tags = ("furniture", "shop", "townhall", "counter")
    sockets = counter_sockets(placement, 0.85)

    def variant_params(self, style, variant, rng):
        return {"extra": pick(rng, ("flags", "globe", "bell"), variant), "body": pick(rng, (("darkwood", 0), ("darkwood", 2), ("wood", 1)), variant), "flag": pick(rng, (0, 1, 2), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        trim = ctx.paint("frame", 0, tile="plain")
        b.box((0.05, 0.05, 0.0), (1.95, 0.75, 0.08), body, bevel=0.0)
        b.box((0.08, 0.08, 0.08), (1.92, 0.72, 0.8), body, bevel=0.012, segments=1)
        for k in range(4):
            a = 0.14 + 0.44 * k
            b.box((a, 0.065, 0.16), (a + 0.38, 0.08, 0.7), body, bevel=0.006, segments=1)
            b.box((a + 0.06, 0.06, 0.4), (a + 0.32, 0.065, 0.46), trim, bevel=0.0, noise=0.0)
        b.box((0.0, 0.0, 0.8), (2.0, 0.8, 0.85), ctx.paint("darkwood", 1, tile="wood"), bevel=0.012, segments=1)
        b.box((0.04, 0.04, 0.85), (1.96, 0.76, 0.855), ctx.paint("foliage", 3, tile="fabric"), bevel=0.0, noise=0.0)
        # Nameplate, papers, stamp and inkwell.
        b.solid(solids.prism([(0.08, 0.855), (0.16, 0.855), (0.12, 0.93)], "x", 0.8, 1.2), trim, bevel=0.0)
        for k in range(3):
            b.box((0.3 + 0.02 * k, 0.25 + 0.015 * k, 0.855 + 0.006 * k), (0.62 + 0.02 * k, 0.6 + 0.015 * k, 0.861 + 0.006 * k), ctx.paint("paper", k, tile="plain"), bevel=0.0, noise=0.0)
        b.cylinder((1.4, 0.4, 0.855), 0.04, 0.05, ctx.paint("food", 0, tile="plain"), sides=8, bevel=0.0)
        b.cylinder((1.4, 0.4, 0.905), 0.012, 0.06, ctx.paint("darkwood", 0, tile="plain"), sides=6, bevel=0.0)
        b.cylinder((1.55, 0.45, 0.855), 0.035, 0.05, ctx.paint("metal", 0, tile="plain"), sides=8, bevel=0.0)
        b.solid(solids.tube([(1.55, 0.45, 0.9), (1.62, 0.5, 1.05)], [0.006, 0.004], sides=4), ctx.paint("paper", 0, tile="plain"), bevel=0.0)
        extra = params["extra"]
        if extra == "flags":
            for x, colour in ((0.15, params["flag"]), (1.85, (params["flag"] + 2) % 5)):
                b.cylinder((x, 0.6, 0.855), 0.04, 0.02, trim, sides=8, bevel=0.0)
                b.solid(solids.tube([(x, 0.6, 0.875), (x, 0.6, 1.45)], [0.008, 0.008], sides=4), trim, bevel=0.0)
                # The cloth flies towards the middle of the desk.
                fx0, fx1 = (x + 0.008, x + 0.2) if x < 1 else (x - 0.2, x - 0.008)
                b.box((fx0, 0.595, 1.22), (fx1, 0.605, 1.42), ctx.paint("art", colour, tile="fabric"), bevel=0.0, noise=0.0)
        elif extra == "globe":
            b.cylinder((1.75, 0.5, 0.855), 0.07, 0.03, trim, sides=8, bevel=0.0)
            b.blob((1.75, 0.5, 1.05), 0.16, ctx.paint("glass", 0, tile="plain"), subdivisions=2, wobble=0.0)
            b.blob((1.72, 0.45, 1.09), 0.09, ctx.paint("foliage", 2, tile="plain"), scale=(1.0, 0.9, 0.8), subdivisions=1, wobble=0.1)
        else:
            b.box((1.7, 0.4, 0.855), (1.9, 0.6, 0.9), ctx.paint("darkwood", 2, tile="wood"), bevel=0.0)
            b.cylinder((1.8, 0.5, 0.9), 0.07, 0.12, trim, sides=10, radius_top=0.03, bevel=0.0)
            b.blob((1.8, 0.5, 1.04), 0.025, trim, subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
class BarnStall(Furniture):
    """A 1.5 m livestock pen in the Farmer's barn: plank fence on three sides with an open front,
    a straw floor and a feed trough, a hay rack or a closed gate."""

    id = "barn.stall"
    placement = Placement(w=3, d=3)
    height = 1.3
    tags = ("furniture", "shop", "barn")
    sockets = (use_socket(placement), Socket("animal", "prop", (0.75, 0.8, 0.0), FRONT))

    def variant_params(self, style, variant, rng):
        return {"extra": pick(rng, ("trough", "rack", "gate"), variant), "wood": pick(rng, (1, 0, 2), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="floorboards")
        post = ctx.paint("darkwood", 0, tile="wood")
        straw = ctx.paint("hay", 0, tile="straw")
        b.box((0.05, 0.05, 0.0), (1.45, 1.45, 0.03), straw, bevel=0.0)
        for x, y in ((0.0, 0.0), (1.4, 0.0), (0.0, 1.4), (1.4, 1.4)):
            b.box((x, y, 0.0), (x + 0.1, y + 0.1, 1.3), post, bevel=0.012, segments=1)
        for z in (0.35, 0.75, 1.1):
            b.box((0.02, 1.42, z), (1.48, 1.48, z + 0.15), wood, bevel=0.008, segments=1)
            for x in (0.02, 1.42):
                b.box((x, 0.1, z), (x + 0.06, 1.4, z + 0.15), wood, bevel=0.008, segments=1)
        r = VariantRng(params["seed"])
        for k in range(4):
            b.blob((r.uniform(0.3, 1.2), r.uniform(0.3, 1.2), 0.03), r.uniform(0.12, 0.2), ctx.paint("hay", r.randint(0, 2), tile="straw"), scale=(1.4, 1.0, 0.35), subdivisions=1, wobble=0.15, flatten_below=0.03)
        extra = params["extra"]
        if extra == "trough":
            b.box((0.2, 1.05, 0.0), (1.3, 1.4, 0.38), wood, bevel=0.01, segments=1)
            b.box((0.26, 1.11, 0.25), (1.24, 1.34, 0.37), ctx.paint("glass", 0, tile="plain"), bevel=0.0, noise=0.0)
        elif extra == "rack":
            b.solid(solids.prism([(1.4, 0.7), (1.4, 1.25), (1.05, 1.25)], "x", 0.2, 1.3), post, bevel=0.0)
            b.blob((0.75, 1.3, 1.08), 0.3, straw, scale=(1.6, 0.35, 0.45), subdivisions=1, wobble=0.12)
        else:
            for z in (0.35, 0.75, 1.1):
                b.box((0.1, 0.02, z), (1.4, 0.08, z + 0.15), wood, bevel=0.008, segments=1)
            b.solid(solids.beam((0.15, 0.4), (1.35, 1.18), 0.1, 0.0, 0.06), wood, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class BarnHay(Furniture):
    """Hay in the barn: two stacked bales, one bale with a pitchfork, or a loose pile with a
    milk pail."""

    id = "barn.hay"
    placement = Placement(w=2, d=1)
    height = 1.15
    tags = ("furniture", "shop", "barn")
    sockets = (use_socket(placement),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("stack", "fork", "pile"), variant), "hay": pick(rng, (0, 1, 2), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        hay = ctx.paint("hay", params["hay"], tile="straw")
        twine = ctx.paint("hay", 1, tile="plain")
        kind = params["kind"]

        def bale(x0, y0, z0, x1, y1, z1):
            b.box((x0, y0, z0), (x1, y1, z1), hay, bevel=0.03, segments=1)
            for f in (0.3, 0.7):
                x = x0 + (x1 - x0) * f
                b.box((x - 0.015, y0 - 0.004, z0 + 0.01), (x + 0.015, y1 + 0.004, z1 + 0.004), twine, bevel=0.0, noise=0.0)

        if kind == "stack":
            bale(0.03, 0.05, 0.0, 0.97, 0.45, 0.42)
            bale(0.12, 0.07, 0.42, 0.88, 0.43, 0.8)
        elif kind == "fork":
            bale(0.03, 0.05, 0.0, 0.75, 0.45, 0.42)
            wood = ctx.paint("wood", 0, tile="wood")
            metal = ctx.paint("metal", 1, tile="plain")
            b.solid(solids.tube([(0.85, 0.3, 0.15), (0.9, 0.35, 1.12)], [0.014, 0.014], sides=5), wood, bevel=0.0)
            for dx in (-0.04, 0.0, 0.04):
                b.solid(solids.tube([(0.85 + dx, 0.3, 0.15), (0.85 + dx, 0.3, 0.01)], [0.006, 0.004], sides=4), metal, bevel=0.0)
            b.solid(solids.tube([(0.8, 0.3, 0.15), (0.9, 0.3, 0.15)], [0.008, 0.008], sides=4), metal, bevel=0.0)
        else:
            r = VariantRng(params["seed"])
            for k in range(4):
                b.blob((0.22 + 0.11 * k + r.uniform(-0.02, 0.02), 0.25 + r.uniform(-0.03, 0.03), 0.05), r.uniform(0.13, 0.16), hay, scale=(1.1, 1.0, 0.9), subdivisions=1, wobble=0.12, flatten_below=0.0)
            b.blob((0.38, 0.25, 0.18), 0.17, hay, scale=(1.25, 0.95, 0.8), subdivisions=1, wobble=0.1, flatten_below=0.0)
            b.cylinder((0.85, 0.25, 0.0), 0.1, 0.22, ctx.paint("metal", 1, tile="plain"), sides=10, radius_top=0.12, bevel=0.0)
            b.cylinder((0.85, 0.25, 0.2), 0.105, 0.012, ctx.paint("ceramic", 0, tile="plain"), sides=10, bevel=0.0)
        return [b.to_object(ctx.collection)]


SHOP_IDS = ("bakery.counter", "bakery.oven", "barn.hay", "barn.stall", "cafe.bar", "clinic.desk", "library.shelf", "store.shelf", "townhall.desk")
