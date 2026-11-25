"""Apartment furniture (GDD §4.2: a small studio with a bed, kitchen nook, table, window,
mirror and wardrobe), plus sofas, shelves, plants, rugs, lamps and paintings for decorating.
Every piece declares its placement footprint on the 0.5 m grid; see ``base`` for the
conventions."""

from __future__ import annotations

import math

from hvkit import solids
from hvkit.grid import Placement
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import FRONT, SEAT_Z, UP, Furniture, arch_profile, ellipse, pick, use_socket
from .parts import books, case, jars, knob, leafy, legs, oval_frame, rect_frame


@register
class Bed(Furniture):
    """A single bed, headboard against the wall: an arched oak bed, a painted slatted bed or a
    walnut bed with a footboard. ``sleep`` is where a character lies down."""

    id = "bed"
    placement = Placement(w=2, d=4, against_wall=True)
    height = 1.15
    tags = ("furniture", "apartment", "bed")
    sockets = (use_socket(placement), Socket("sleep", "prop", (0.5, 1.2, 0.55), UP))

    def variant_params(self, style, variant, rng):
        return {
            "head": pick(rng, ("arched", "slats", "panel"), variant),
            "frame": pick(rng, (("wood", 0), ("paint", 0), ("darkwood", 0)), variant),
            "quilt": pick(rng, (0, 1, 2), variant),
            "pillows": pick(rng, (1, 2, 1), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        group, idx = params["frame"]
        wood = ctx.paint(group, idx, tile="wood")
        legs(b, wood, 0.02, 0.02, 0.98, 1.9, 0.16, t=0.07)
        b.box((0.02, 0.02, 0.14), (0.98, 1.92, 0.3), wood, bevel=0.015, segments=1)
        b.box((0.06, 0.08, 0.3), (0.94, 1.9, 0.46), ctx.paint("ceramic", 0, tile="fabric"), bevel=0.04, segments=2)
        quilt = ctx.paint("fabric", params["quilt"], tile="fabric")
        b.box((0.03, 0.05, 0.36), (0.97, 1.3, 0.5), quilt, bevel=0.035, segments=2)
        b.box((0.05, 1.22, 0.4), (0.95, 1.42, 0.53), ctx.paint("fabric", 4, tile="fabric"), bevel=0.04, segments=2)
        n = params["pillows"]
        for k in range(n):
            x = 0.5 if n == 1 else 0.28 + 0.44 * k
            b.blob((x, 1.66, 0.54), 0.2 if n == 1 else 0.17, ctx.paint("ceramic", 1, tile="fabric"), scale=(1.6 if n == 1 else 1.2, 0.75, 0.42), subdivisions=2, wobble=0.03)
        head = params["head"]
        if head == "arched":
            b.solid(solids.prism(arch_profile(0.0, 1.0, 0.0, 0.62, 10), "y", 1.92, 2.0), wood, bevel=0.012, segments=1)
        elif head == "slats":
            for x in (0.0, 0.92):
                b.box((x, 1.92, 0.0), (x + 0.08, 2.0, 1.0), wood, bevel=0.01, segments=1)
            b.box((0.0, 1.93, 0.92), (1.0, 2.0, 1.02), wood, bevel=0.01, segments=1)
            for k in range(5):
                x = 0.14 + k * 0.155
                b.box((x, 1.94, 0.3), (x + 0.07, 1.98, 0.92), wood, bevel=0.0)
        else:
            b.box((0.0, 1.92, 0.0), (1.0, 2.0, 0.95), wood, bevel=0.015, segments=1)
            b.box((0.1, 1.9, 0.5), (0.9, 1.92, 0.85), ctx.paint("darkwood", 2, tile="wood"), bevel=0.0)
            b.box((0.0, 0.0, 0.0), (1.0, 0.06, 0.6), wood, bevel=0.012, segments=1)
        return [b.to_object(ctx.collection)]


@register
class Table(Furniture):
    """A 1 m table: square oak with four legs, a round pedestal café table (the store's small
    table), or a table with a cloth and a vase of flowers. ``top`` holds surface pieces."""

    id = "table"
    placement = Placement(w=2, d=2)
    height = 1.1
    tags = ("furniture", "apartment", "table")
    sockets = (use_socket(placement), Socket("top", "stack", (0.5, 0.5, 0.78), UP))

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("square", "round", "cloth"), variant),
            "wood": pick(rng, (0, 2, 1), variant),
            "cloth": pick(rng, (1, 3, 0), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        kind = params["kind"]
        if kind == "round":
            b.cylinder((0.5, 0.5, 0.0), 0.24, 0.04, wood, sides=12, radius_top=0.2, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.04), 0.05, 0.68, wood, sides=8, bevel=0.0)
            b.cylinder((0.5, 0.5, 0.72), 0.46, 0.06, wood, sides=20, bevel=0.012, segments=1)
            return [b.to_object(ctx.collection)]
        legs(b, wood, 0.06, 0.06, 0.94, 0.94, 0.72, t=0.06)
        b.box((0.08, 0.08, 0.6), (0.92, 0.92, 0.72), wood, bevel=0.0)
        b.box((0.02, 0.02, 0.72), (0.98, 0.98, 0.78), wood, bevel=0.012, segments=1)
        if kind == "cloth":
            cloth = ctx.paint("fabric", params["cloth"], tile="fabric")
            b.box((0.015, 0.015, 0.6), (0.985, 0.985, 0.782), cloth, bevel=0.02, segments=1)
            b.cylinder((0.5, 0.5, 0.782), 0.07, 0.2, ctx.paint("ceramic", 2, tile="plain"), sides=8, radius_top=0.05, bevel=0.0)
            for k in range(5):
                a = 2 * math.pi * k / 5
                b.blob((0.5 + 0.06 * math.cos(a), 0.5 + 0.06 * math.sin(a), 1.02), 0.05, ctx.paint("art", (k + 2) % 5, tile="plain"), subdivisions=1, wobble=0.1)
            b.blob((0.5, 0.5, 0.97), 0.07, ctx.paint("foliage", 1, tile="leaves"), subdivisions=1, wobble=0.15)
        return [b.to_object(ctx.collection)]


@register
class Chair(Furniture):
    """A dining chair (0.5 m): an oak ladder-back (the store's wooden chair), a painted chair
    with a cushion, or a round stool. ``sit`` is the seat, facing the front."""

    id = "chair"
    placement = Placement(w=1, d=1)
    height = 1.05
    tags = ("furniture", "apartment", "seat")
    sockets = (use_socket(placement), Socket("sit", "prop", (0.25, 0.25, SEAT_Z), FRONT))

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("ladder", "painted", "stool"), variant), "paint": pick(rng, (0, 0, 1), variant), "cushion": pick(rng, (2, 0, 3), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        kind = params["kind"]
        wood = ctx.paint("wood", 0, tile="wood") if kind == "ladder" else ctx.paint("paint", params["paint"], tile="wood")
        if kind == "stool":
            wood = ctx.paint("wood", 1, tile="wood")
            for a in (0.25, 1.82, 3.39, 4.96):
                x, y = 0.25 + 0.15 * math.cos(a), 0.25 + 0.15 * math.sin(a)
                b.solid(solids.tube([(x, y, 0.012), (0.25 + 0.13 * math.cos(a), 0.25 + 0.13 * math.sin(a), SEAT_Z)], [0.022, 0.02], sides=5), wood, bevel=0.0)
            b.cylinder((0.25, 0.25, SEAT_Z - 0.04), 0.19, 0.05, wood, sides=12, bevel=0.01, segments=1)
            b.cylinder((0.25, 0.25, SEAT_Z + 0.01), 0.17, 0.03, ctx.paint("fabric", params["cushion"], tile="fabric"), sides=12, bevel=0.008, segments=1)
            return [b.to_object(ctx.collection)]
        legs(b, wood, 0.06, 0.06, 0.44, 0.44, SEAT_Z - 0.04, t=0.04)
        b.box((0.05, 0.05, SEAT_Z - 0.05), (0.45, 0.45, SEAT_Z), wood, bevel=0.01, segments=1)
        for x in (0.06, 0.4):
            b.box((x, 0.4, SEAT_Z), (x + 0.04, 0.44, 0.95), wood, bevel=0.0)
        if kind == "ladder":
            for z in (0.6, 0.72, 0.84, 0.94):
                b.box((0.1, 0.405, z), (0.4, 0.435, z + 0.04), wood, bevel=0.0)
        else:
            b.solid(solids.prism(arch_profile(0.06, 0.44, 0.68, 0.84, 8), "y", 0.4, 0.44), wood, bevel=0.0)
            cushion = ctx.paint("fabric", params["cushion"], tile="fabric")
            b.box((0.07, 0.06, SEAT_Z), (0.43, 0.4, SEAT_Z + 0.05), cushion, bevel=0.02, segments=1)
        return [b.to_object(ctx.collection)]


@register
class Sofa(Furniture):
    """A two-seat sofa against the wall: rounded arms, a square modern one with throw pillows,
    or a cottage loveseat with a skirt. ``sit_l``/``sit_r`` are the two seats."""

    id = "sofa"
    placement = Placement(w=3, d=2, against_wall=True)
    height = 0.88
    tags = ("furniture", "apartment", "seat")
    sockets = (
        use_socket(placement),
        Socket("sit_l", "prop", (0.48, 0.4, SEAT_Z), FRONT),
        Socket("sit_r", "prop", (1.02, 0.4, SEAT_Z), FRONT),
    )

    def variant_params(self, style, variant, rng):
        return {"arms": pick(rng, ("round", "square", "skirt"), variant), "fabric": pick(rng, (1, 5, 0), variant), "pillows": pick(rng, (2, 3, 2), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        fabric = ctx.paint("fabric", params["fabric"], tile="fabric")
        arms = params["arms"]
        base_z = 0.0 if arms == "skirt" else 0.1
        if arms != "skirt":
            legs(b, ctx.paint("darkwood", 0, tile="wood"), 0.08, 0.1, 1.42, 0.9, 0.1, t=0.05, round_=True)
        b.box((0.08, 0.06, base_z), (1.42, 0.94, 0.3), fabric, bevel=0.03, segments=1)
        for x0, x1 in ((0.15, 0.75), (0.75, 1.35)):
            b.box((x0 + 0.005, 0.06, 0.3), (x1 - 0.005, 0.8, SEAT_Z), fabric, bevel=0.04, segments=2)
            b.box((x0 + 0.01, 0.72, 0.4), (x1 - 0.01, 0.95, 0.84), fabric, bevel=0.05, segments=2)
        for x0, x1 in ((0.0, 0.18), (1.32, 1.5)):
            if arms == "round":
                b.solid(solids.tube([((x0 + x1) / 2, 0.08, 0.5), ((x0 + x1) / 2, 0.95, 0.5)], [0.085, 0.085], sides=8), fabric, bevel=0.0, smooth=True)
                b.box((x0 + 0.01, 0.06, base_z), (x1 - 0.01, 0.95, 0.5), fabric, bevel=0.02, segments=1)
            else:
                b.box((x0, 0.05, base_z), (x1, 0.96, 0.62), fabric, bevel=0.03, segments=2)
        n = params["pillows"]
        for k in range(n):
            x = 0.35 + (0.8 / max(1, n - 1)) * k
            b.blob((x, 0.66, 0.6), 0.13, ctx.paint("fabric", (params["fabric"] + 2 + k) % 6, tile="fabric"), scale=(1.0, 0.45, 1.0), subdivisions=1, wobble=0.04)
        return [b.to_object(ctx.collection)]


@register
class Wardrobe(Furniture):
    """A wardrobe against the wall: a two-door oak wardrobe, a painted one with a mirror door,
    or a walnut one with drawers below. ``use`` is where a character opens it."""

    id = "wardrobe"
    placement = Placement(w=2, d=1, against_wall=True)
    height = 2.0
    tags = ("furniture", "apartment", "storage")
    sockets = (use_socket(placement),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("doors", "mirror", "drawers"), variant), "body": pick(rng, (("wood", 1), ("paint", 2), ("darkwood", 2)), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        metal = ctx.paint("metal", 2, tile="plain")
        b.box((0.03, 0.05, 0.0), (0.97, 0.5, 0.1), body, bevel=0.0)
        b.box((0.03, 0.05, 0.1), (0.97, 0.5, 1.9), body, bevel=0.012, segments=1)
        b.box((0.0, 0.02, 1.9), (1.0, 0.5, 2.0), body, bevel=0.012, segments=1)
        kind = params["kind"]
        z0 = 0.62 if kind == "drawers" else 0.14
        for k, (x0, x1) in enumerate(((0.06, 0.495), (0.505, 0.94))):
            b.box((x0, 0.035, z0), (x1, 0.05, 1.86), body, bevel=0.006, segments=1)
            if kind == "mirror" and k == 0:
                b.box((x0 + 0.06, 0.03, z0 + 0.1), (x1 - 0.06, 0.035, 1.76), ctx.paint("glass", 1, tile="plain", material="glass"), bevel=0.0, noise=0.0)
            else:
                b.box((x0 + 0.06, 0.03, z0 + 0.1), (x1 - 0.06, 0.035, (z0 + 1.86) / 2 - 0.04), body, bevel=0.0)
                b.box((x0 + 0.06, 0.03, (z0 + 1.86) / 2 + 0.04), (x1 - 0.06, 0.035, 1.76), body, bevel=0.0)
            knob(b, metal, x1 - 0.05 if k == 0 else x0 + 0.05, 0.035, 1.05)
        if kind == "drawers":
            for z in (0.14, 0.38):
                b.box((0.06, 0.035, z), (0.94, 0.05, z + 0.21), body, bevel=0.006, segments=1)
                knob(b, metal, 0.5, 0.035, z + 0.105)
        return [b.to_object(ctx.collection)]


@register
class Mirror(Furniture):
    """A wall mirror (the appearance editor, TODO(M15)): an oval gilt mirror, a square wooden one
    with a little shelf, or an arched painted one. Stand at ``use`` to look into it."""

    id = "mirror"
    placement = Placement(w=1, d=1, mount="wall")
    height = 1.85
    tags = ("furniture", "apartment", "wall_mounted", "interactive")
    sockets = (use_socket(placement), Socket("glass", "attach", (0.25, 0.44, 1.35), FRONT))

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("oval", "square", "arched"), variant), "frame": pick(rng, (("frame", 0), ("wood", 1), ("paint", 3)), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        frame = ctx.paint(*params["frame"], tile="wood")
        glass = ctx.paint("glass", 1, tile="plain", material="glass")
        kind = params["kind"]
        y0, y1 = 0.45, 0.5
        if kind == "oval":
            oval_frame(b, frame, glass, 0.25, 1.35, 0.2, 0.32, y0, y1, border=0.04, segments=18)
        elif kind == "square":
            b.box((0.03, y0 + 0.01, 1.0), (0.47, y1, 1.62), frame, bevel=0.0)
            b.box((0.07, y0 + 0.002, 1.04), (0.43, y0 + 0.01, 1.58), glass, bevel=0.0, noise=0.0)
            b.box((0.02, 0.4, 0.94), (0.48, y1, 1.0), frame, bevel=0.008, segments=1)
            b.cylinder((0.38, 0.45, 1.0), 0.025, 0.07, ctx.paint("ceramic", 2, tile="plain"), sides=6, bevel=0.0)
        else:
            b.solid(solids.prism(arch_profile(0.04, 0.46, 0.85, 1.6, 10), "y", y0 + 0.01, y1), frame, bevel=0.0)
            b.solid(solids.prism(arch_profile(0.08, 0.42, 0.89, 1.6, 10), "y", y0, y0 + 0.01), glass, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
class KitchenNook(Furniture):
    """The apartment kitchen (cooking, TODO(M29)): base cabinets with a sink and a two-ring
    stove with an oven, under an open shelf, wall cabinets or a tiled splashback with a hood.
    ``cook`` faces the stove, ``sink`` the sink."""

    id = "kitchen.nook"
    placement = Placement(w=3, d=1, against_wall=True)
    height = 2.2
    tags = ("furniture", "apartment", "kitchen", "interactive")
    sockets = (
        use_socket(placement),
        Socket("cook", "prop", (1.15, 0.0, 0.0), FRONT),
        Socket("sink", "prop", (0.35, 0.0, 0.0), FRONT),
    )

    def variant_params(self, style, variant, rng):
        return {
            "upper": pick(rng, ("shelf", "cabinets", "hood"), variant),
            "body": pick(rng, (("paint", 0), ("wood", 0), ("paint", 4)), variant),
            "seed": rng.randint(0, 9999),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        metal = ctx.paint("metal", 1, tile="plain")
        dark = ctx.paint("metal", 0, tile="plain")
        top = ctx.paint("stone", 0, tile="stone")
        b.box((0.0, 0.06, 0.0), (1.5, 0.5, 0.1), ctx.paint("darkwood", 0, tile="wood"), bevel=0.0)
        b.box((0.0, 0.04, 0.1), (0.85, 0.5, 0.85), body, bevel=0.01, segments=1)
        # Cabinet doors under the sink.
        for x0, x1 in ((0.04, 0.4), (0.44, 0.81)):
            b.box((x0, 0.03, 0.15), (x1, 0.04, 0.8), body, bevel=0.005, segments=1)
            knob(b, ctx.paint("metal", 2, tile="plain"), x1 - 0.05 if x0 < 0.1 else x0 + 0.05, 0.03, 0.7, 0.018)
        b.box((0.0, 0.0, 0.85), (0.85, 0.5, 0.9), top, bevel=0.008, segments=1)
        # Sink basin and tap.
        b.box((0.15, 0.1, 0.88), (0.55, 0.4, 0.905), metal, bevel=0.0)
        b.box((0.18, 0.13, 0.9), (0.52, 0.37, 0.906), dark, bevel=0.0, noise=0.0)
        b.solid(solids.tube([(0.35, 0.44, 0.9), (0.35, 0.44, 1.08), (0.35, 0.32, 1.1), (0.35, 0.28, 1.04)], [0.018, 0.018, 0.016, 0.014], sides=6), metal, bevel=0.0)
        # Stove: body, oven door with a window, hob and rings.
        b.box((0.85, 0.04, 0.1), (1.5, 0.5, 0.88), ctx.paint("ceramic", 0, tile="plain"), bevel=0.012, segments=1)
        b.box((0.9, 0.03, 0.2), (1.45, 0.04, 0.65), ctx.paint("ceramic", 0, tile="plain"), bevel=0.0)
        b.box((0.98, 0.025, 0.32), (1.37, 0.03, 0.58), ctx.paint("glass", 0, tile="plain", material="glass"), bevel=0.0, noise=0.0)
        b.box((0.95, 0.005, 0.62), (1.4, 0.03, 0.64), metal, bevel=0.0, noise=0.0)
        for k in range(3):
            knob(b, dark, 0.98 + k * 0.08, 0.04, 0.78, 0.018)
        b.box((0.85, 0.0, 0.88), (1.5, 0.5, 0.9), dark, bevel=0.0)
        for x, y, r in ((1.02, 0.18, 0.09), (1.32, 0.32, 0.08)):
            b.cylinder((x, y, 0.9), r, 0.015, ctx.paint("metal", 0, tile="plain"), sides=10, bevel=0.0)
            b.cylinder((x, y, 0.915), r * 0.5, 0.006, ctx.paint("fire", 0, tile="plain", material="glow"), sides=8, bevel=0.0)
        # A pot on the stove.
        b.cylinder((1.02, 0.18, 0.915), 0.08, 0.12, ctx.paint("fabric", 0, tile="plain"), sides=10, bevel=0.0)
        b.box((1.08, 0.165, 0.99), (1.18, 0.195, 1.01), dark, bevel=0.0)
        upper = params["upper"]
        r = VariantRng(params["seed"])
        if upper == "shelf":
            b.box((0.0, 0.3, 1.5), (1.5, 0.5, 1.54), ctx.paint("wood", 1, tile="wood"), bevel=0.006, segments=1)
            for x in (0.1, 1.38):
                b.box((x, 0.44, 1.38), (x + 0.03, 0.5, 1.5), ctx.paint("wood", 1, tile="wood"), bevel=0.0)
            jars(b, ctx, r, 0.06, 0.8, 0.4, 1.54, 0.18, 0.05, groups=(("glass", 0), ("ceramic", 2), ("pot", 1)))
            for k in range(4):
                x = 0.95 + k * 0.13
                b.cylinder((x, 0.4, 1.54), 0.05, 0.07, ctx.paint("ceramic", k % 2, tile="plain"), sides=8, bevel=0.0)
            b.box((0.0, 0.47, 0.9), (1.5, 0.5, 1.3), ctx.paint("tiles", 0, tile="tiles"), bevel=0.0)
        elif upper == "cabinets":
            b.box((0.0, 0.18, 1.45), (1.5, 0.5, 2.2), body, bevel=0.01, segments=1)
            for k in range(3):
                x0 = 0.04 + k * 0.48
                b.box((x0, 0.17, 1.49), (x0 + 0.46, 0.18, 2.16), body, bevel=0.005, segments=1)
                knob(b, ctx.paint("metal", 2, tile="plain"), x0 + 0.4, 0.17, 1.56, 0.018)
            b.box((0.0, 0.47, 0.9), (1.5, 0.5, 1.45), ctx.paint("tiles", 3, tile="tiles"), bevel=0.0)
        else:
            b.box((0.0, 0.47, 0.9), (1.5, 0.5, 1.6), ctx.paint("tiles", 1, tile="tiles"), bevel=0.0)
            # Extractor hood over the stove: a sloped prism in the (y, z) plane.
            b.solid(solids.prism([(0.2, 1.55), (0.5, 1.55), (0.5, 2.2), (0.36, 2.2)], "x", 0.88, 1.47), ctx.paint("metal", 1, tile="plain"), bevel=0.01, segments=1)
            b.box((0.0, 0.3, 1.62), (0.8, 0.5, 1.66), ctx.paint("wood", 1, tile="wood"), bevel=0.0)
            for k in range(3):
                x = 0.12 + k * 0.22
                b.solid(solids.tube([(x, 0.42, 1.6), (x, 0.42, 1.45)], [0.006, 0.006], sides=4), dark, bevel=0.0)
                b.cylinder((x, 0.42, 1.32), 0.06 - 0.01 * k, 0.03, ctx.paint("metal", 2 if k else 1, tile="plain"), sides=8, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Shelf(Furniture):
    """A 1 m bookcase against the wall (the store's bookshelf): full of books, plants and jars,
    or books with baskets and boxes. ``top`` holds a surface piece."""

    id = "shelf"
    placement = Placement(w=2, d=1, against_wall=True)
    height = 1.8
    tags = ("furniture", "apartment", "storage")
    sockets = (use_socket(placement), Socket("top", "stack", (0.5, 0.33, 1.8), UP))

    def variant_params(self, style, variant, rng):
        return {"fill": pick(rng, ("books", "plants", "boxes"), variant), "body": pick(rng, (("wood", 2), ("paint", 4), ("darkwood", 0)), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        body = ctx.paint(*params["body"], tile="wood")
        shelves = (0.46, 0.88, 1.3)
        case(b, body, 0.02, 0.16, 0.98, 0.5, 1.8, shelves, t=0.03)
        r = VariantRng(params["seed"])
        levels = (0.06,) + shelves
        fill = params["fill"]
        for k, z in enumerate(levels):
            hmax = (levels[k + 1] if k + 1 < len(levels) else 1.77) - z - 0.06
            if fill == "books" or (fill == "boxes" and k % 2 == 0) or (fill == "plants" and k == 1):
                books(b, ctx, r, 0.06, 0.94, 0.19, 0.48, z, hmax)
            elif fill == "plants":
                if k % 2 == 0:
                    for x in (0.22, 0.72):
                        b.cylinder((x, 0.34, z), 0.08, 0.13, ctx.paint("pot", k % 3, tile="plain"), sides=8, radius_top=0.095, bevel=0.0)
                        b.blob((x, 0.34, z + 0.2), 0.11, ctx.paint("foliage", (k + int(x * 10)) % 4, tile="leaves"), subdivisions=1, wobble=0.12)
                else:
                    jars(b, ctx, r, 0.08, 0.92, 0.34, z, hmax * 0.6, 0.055, groups=(("glass", 0), ("ceramic", 2)))
            else:
                for x0 in (0.07, 0.5):
                    b.box((x0, 0.2, z), (x0 + 0.42, 0.47, z + hmax * 0.7), ctx.paint("hay", 1, tile="straw"), bevel=0.01, segments=1)
        return [b.to_object(ctx.collection)]


@register
class PottedPlant(Furniture):
    """A potted plant (0.5 m): a big leafy monstera (the store's potted plant), a cactus, or a
    little fig tree."""

    id = "plant.potted"
    placement = Placement(w=1, d=1)
    height = 1.35
    tags = ("furniture", "apartment", "plant")
    sockets = (use_socket(placement),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("leafy", "cactus", "tree"), variant), "pot": pick(rng, (0, 1, 2), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        pot = ctx.paint("pot", params["pot"], tile="plain")
        kind = params["kind"]
        r = VariantRng(params["seed"])
        b.cylinder((0.25, 0.25, 0.0), 0.13, 0.3, pot, sides=10, radius_top=0.17, bevel=0.0)
        b.cylinder((0.25, 0.25, 0.28), 0.18, 0.05, pot, sides=10, bevel=0.0)
        b.cylinder((0.25, 0.25, 0.31), 0.16, 0.02, ctx.paint("darkwood", 1, tile="plain"), sides=10, bevel=0.0)
        if kind == "leafy":
            leafy(b, ctx, r, (0.25, 0.25, 0.32), 7, 0.5, swatch=1, spread=0.42, width=0.14)
            leafy(b, ctx, r, (0.25, 0.25, 0.32), 4, 0.75, swatch=3, spread=0.25, width=0.13)
        elif kind == "cactus":
            green = ctx.paint("foliage", 3, tile="leaves")
            b.solid(solids.tube([(0.25, 0.25, 0.3), (0.25, 0.25, 0.7), (0.25, 0.25, 0.92)], [0.085, 0.085, 0.05], sides=8), green, bevel=0.0, smooth=True)
            b.solid(solids.tube([(0.25, 0.25, 0.55), (0.37, 0.25, 0.58), (0.38, 0.25, 0.75)], [0.045, 0.045, 0.035], sides=6), green, bevel=0.0, smooth=True)
            b.solid(solids.tube([(0.25, 0.25, 0.48), (0.13, 0.27, 0.5), (0.12, 0.27, 0.62)], [0.04, 0.04, 0.03], sides=6), green, bevel=0.0, smooth=True)
            b.blob((0.25, 0.25, 0.94), 0.035, ctx.paint("food", 3, tile="plain"), subdivisions=1, wobble=0.1)
        else:
            b.solid(solids.tube([(0.25, 0.25, 0.3), (0.24, 0.26, 0.7), (0.26, 0.24, 0.9)], [0.025, 0.02, 0.015], sides=5), ctx.paint("darkwood", 0, tile="wood"), bevel=0.0)
            for k, (x, y, z, rad) in enumerate(((0.25, 0.25, 1.05, 0.17), (0.15, 0.3, 0.95, 0.11), (0.34, 0.2, 0.97, 0.1), (0.26, 0.3, 1.2, 0.1))):
                b.blob((x, y, z), rad, ctx.paint("foliage", k % 4, tile="leaves"), subdivisions=2, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
class Rug(Furniture):
    """A 1.5 m rug that players walk over: a round braided rug (the store's round rug), a
    bordered rectangle, or a striped runner."""

    id = "rug"
    placement = Placement(w=3, d=3, mount="rug")
    height = 0.02
    tags = ("furniture", "apartment", "rug")
    sockets = (Socket("center", "prop", (0.75, 0.75, 0.0), UP),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("round", "border", "stripes"), variant), "colours": pick(rng, ((0, 4, 2), (5, 4, 1), (3, 4, 2)), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        a, c, d = (ctx.paint("fabric", i, tile="fabric") for i in params["colours"])
        kind = params["kind"]
        if kind == "round":
            for k, (rad, paint) in enumerate(((0.72, a), (0.56, c), (0.4, d), (0.22, a))):
                b.cylinder((0.75, 0.75, 0.0), rad, 0.012 + 0.002 * k, paint, sides=24, bevel=0.0, noise=0.0)
        elif kind == "border":
            b.box((0.1, 0.25, 0.0), (1.4, 1.25, 0.012), a, bevel=0.0, noise=0.0)
            b.box((0.2, 0.35, 0.0), (1.3, 1.15, 0.014), c, bevel=0.0, noise=0.0)
            b.box((0.32, 0.47, 0.0), (1.18, 1.03, 0.016), d, bevel=0.0, noise=0.0)
            for x in (0.06, 1.4):
                for k in range(6):
                    y = 0.3 + k * 0.17
                    b.box((x, y, 0.0), (x + 0.04, y + 0.06, 0.008), c, bevel=0.0, noise=0.0)
        else:
            n = 7
            for k in range(n):
                y0 = 0.2 + 1.1 * k / n
                b.box((0.25, y0, 0.0), (1.25, y0 + 1.1 / n, 0.012), (a, c, d)[k % 3], bevel=0.0, noise=0.0)
            for y in (0.16, 1.3):
                b.box((0.25, y, 0.0), (1.25, y + 0.04, 0.008), c, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


def _shade(b, paint, glow, x, y, z0, r0, r1, h, sides=10) -> None:
    b.cylinder((x, y, z0), r0, h, paint, sides=sides, radius_top=r1, bevel=0.0)
    b.blob((x, y, z0 + 0.02), min(r0, r1) * 0.55, glow, subdivisions=1, wobble=0.0)


@register
class FloorLamp(Furniture):
    """A standing lamp (warm light at night, TODO(M09)): a drum-shade lamp (the store's floor
    lamp), a wooden tripod, or a brass reading lamp. ``light`` is the bulb."""

    id = "lamp.floor"
    placement = Placement(w=1, d=1)
    height = 1.65
    tags = ("furniture", "apartment", "lamp", "light")
    sockets = (use_socket(placement), Socket("light", "prop", (0.25, 0.25, 1.4), UP))

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("drum", "tripod", "reading"), variant), "shade": pick(rng, (4, 2, 0), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        shade = ctx.paint("fabric", params["shade"], tile="fabric")
        glow = ctx.paint("light", 0, tile="plain", material="glow")
        metal = ctx.paint("metal", 2, tile="plain")
        kind = params["kind"]
        if kind == "tripod":
            wood = ctx.paint("wood", 1, tile="wood")
            for a in (0.4, 2.5, 4.6):
                b.solid(solids.tube([(0.25 + 0.19 * math.cos(a), 0.25 + 0.19 * math.sin(a), 0.012), (0.25, 0.25, 1.1)], [0.018, 0.014], sides=5), wood, bevel=0.0)
            b.solid(solids.tube([(0.25, 0.25, 1.05), (0.25, 0.25, 1.32)], [0.012, 0.012], sides=5), metal, bevel=0.0)
            _shade(b, shade, glow, 0.25, 0.25, 1.25, 0.2, 0.13, 0.3)
        elif kind == "reading":
            b.cylinder((0.25, 0.25, 0.0), 0.15, 0.03, metal, sides=12, bevel=0.0)
            b.solid(solids.tube([(0.25, 0.25, 0.03), (0.25, 0.25, 1.3), (0.28, 0.25, 1.45), (0.36, 0.25, 1.48)], [0.014, 0.014, 0.012, 0.012], sides=6), metal, bevel=0.0)
            b.cylinder((0.36, 0.25, 1.34), 0.1, 0.14, metal, sides=10, radius_top=0.035, bevel=0.0)
            b.blob((0.36, 0.25, 1.36), 0.05, glow, subdivisions=1, wobble=0.0)
        else:
            b.cylinder((0.25, 0.25, 0.0), 0.14, 0.05, ctx.paint("darkwood", 0, tile="wood"), sides=12, radius_top=0.1, bevel=0.0)
            b.cylinder((0.25, 0.25, 0.05), 0.016, 1.3, metal, sides=6, bevel=0.0)
            _shade(b, shade, glow, 0.25, 0.25, 1.3, 0.19, 0.19, 0.3, sides=12)
        return [b.to_object(ctx.collection)]


@register
class TableLamp(Furniture):
    """A small lamp for a table, desk or shelf ``top`` socket (``surface`` mount): a ceramic jar
    lamp, a brass candlestick or a mushroom lamp. ``light`` is the bulb."""

    id = "lamp.table"
    placement = Placement(w=1, d=1, mount="surface")
    height = 0.55
    tags = ("furniture", "apartment", "lamp", "light")
    sockets = (Socket("base", "prop", (0.25, 0.25, 0.0), UP), Socket("light", "prop", (0.25, 0.25, 0.42), UP))

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("jar", "candle", "mushroom"), variant), "colour": pick(rng, (1, 2, 3), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        glow = ctx.paint("light", 0, tile="plain", material="glow")
        kind = params["kind"]
        if kind == "jar":
            b.cylinder((0.25, 0.25, 0.0), 0.07, 0.04, ctx.paint("ceramic", 0, tile="plain"), sides=10, radius_top=0.1, bevel=0.0)
            b.blob((0.25, 0.25, 0.14), 0.11, ctx.paint("tiles", params["colour"], tile="plain"), scale=(1.0, 1.0, 1.1), subdivisions=2, wobble=0.0)
            b.cylinder((0.25, 0.25, 0.24), 0.012, 0.12, ctx.paint("metal", 2, tile="plain"), sides=6, bevel=0.0)
            _shade(b, ctx.paint("fabric", 4, tile="fabric"), glow, 0.25, 0.25, 0.32, 0.15, 0.09, 0.18)
        elif kind == "candle":
            brass = ctx.paint("metal", 2, tile="plain")
            b.cylinder((0.25, 0.25, 0.0), 0.09, 0.03, brass, sides=10, radius_top=0.05, bevel=0.0)
            b.cylinder((0.25, 0.25, 0.03), 0.02, 0.22, brass, sides=6, bevel=0.0)
            b.cylinder((0.25, 0.25, 0.25), 0.05, 0.03, brass, sides=10, bevel=0.0)
            _shade(b, ctx.paint("fabric", params["colour"], tile="fabric"), glow, 0.25, 0.25, 0.28, 0.13, 0.07, 0.2)
        else:
            b.cylinder((0.25, 0.25, 0.0), 0.06, 0.2, ctx.paint("ceramic", 0, tile="plain"), sides=10, radius_top=0.045, bevel=0.0)
            b.blob((0.25, 0.25, 0.22), 0.16, ctx.paint("fabric", params["colour"], tile="fabric"), scale=(1.0, 1.0, 0.6), subdivisions=2, wobble=0.0, flatten_below=0.2)
            b.blob((0.25, 0.25, 0.2), 0.06, glow, subdivisions=1, wobble=0.0)
            for a in (0.5, 2.2, 3.9, 5.2):
                b.blob((0.25 + 0.09 * math.cos(a), 0.25 + 0.09 * math.sin(a), 0.3), 0.025, ctx.paint("ceramic", 0, tile="plain"), subdivisions=1, wobble=0.0)
        return [b.to_object(ctx.collection)]


@register
class Painting(Furniture):
    """A 1 m wall picture: a framed landscape, a seascape with a sailing boat, or a gallery of
    three small frames."""

    id = "painting"
    placement = Placement(w=2, d=1, mount="wall")
    height = 1.95
    tags = ("furniture", "apartment", "wall_mounted", "decor")
    sockets = (Socket("mount", "attach", (0.5, 0.5, 1.5), FRONT),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("landscape", "sea", "gallery"), variant), "frame": pick(rng, (0, 1, 2), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        frame = ctx.paint("frame", params["frame"], tile="wood")
        kind = params["kind"]
        y1 = 0.5
        if kind == "gallery":
            r = VariantRng(params["seed"])
            for k, (x0, z0, x1, z1) in enumerate(((0.05, 1.25, 0.38, 1.75), (0.44, 1.35, 0.72, 1.85), (0.78, 1.2, 0.97, 1.5))):
                rect_frame(b, ctx.paint("frame", (params["frame"] + k) % 3, tile="wood"), x0, z0, x1, z1, y1 - 0.03, y1, 0.03)
                b.box((x0 + 0.03, y1 - 0.02, z0 + 0.03), (x1 - 0.03, y1, z1 - 0.03), ctx.paint("art", k, tile="plain"), bevel=0.0, noise=0.0)
                b.blob(((x0 + x1) / 2, y1 - 0.02, (z0 + z1) / 2), min(x1 - x0, z1 - z0) * 0.22, ctx.paint("art", (k + 2 + r.randint(0, 2)) % 5, tile="plain"),
                       scale=(1.0, 0.15, 1.0), subdivisions=1, wobble=0.1)
            return [b.to_object(ctx.collection)]
        x0, z0, x1, z1 = 0.08, 1.15, 0.92, 1.8
        rect_frame(b, frame, x0, z0, x1, z1, y1 - 0.04, y1, 0.05)
        b.box((x0 + 0.05, y1 - 0.02, z0 + 0.05), (x1 - 0.05, y1, z1 - 0.05), ctx.paint("art", 0, tile="plain"), bevel=0.0, noise=0.0)
        ya, yb = y1 - 0.03, y1 - 0.02
        if kind == "landscape":
            hills = (
                ([(0.13, 1.2), (0.87, 1.2), (0.87, 1.42), (0.6, 1.5), (0.35, 1.38), (0.13, 1.46)], 1),
                ([(0.13, 1.2), (0.87, 1.2), (0.87, 1.3), (0.55, 1.36), (0.13, 1.28)], 3),
            )
            for k, (prof, colour) in enumerate(hills):
                b.solid(solids.prism(prof, "y", ya - 0.004 * k, yb), ctx.paint("art", colour, tile="plain") if colour != 3 else ctx.paint("foliage", 1, tile="plain"), bevel=0.0, noise=0.0)
            b.solid(solids.prism(ellipse(0.7, 1.64, 0.06, 0.06, 10), "y", ya, yb), ctx.paint("art", 2, tile="plain"), bevel=0.0, noise=0.0)
        else:
            for k in range(3):
                z = 1.2 + 0.07 * k
                b.box((0.13, ya - 0.002 * k, z), (0.87, yb, z + 0.07), ctx.paint("glass", k % 2, tile="plain"), bevel=0.0, noise=0.0)
            b.solid(solids.prism([(0.4, 1.42), (0.62, 1.42), (0.58, 1.38), (0.44, 1.38)], "y", ya - 0.008, yb), ctx.paint("darkwood", 0, tile="plain"), bevel=0.0, noise=0.0)
            b.solid(solids.prism([(0.5, 1.43), (0.5, 1.66), (0.6, 1.45)], "y", ya - 0.008, yb), ctx.paint("ceramic", 0, tile="plain"), bevel=0.0, noise=0.0)
            b.solid(solids.prism(ellipse(0.25, 1.65, 0.05, 0.05, 10), "y", ya, yb), ctx.paint("art", 2, tile="plain"), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


APARTMENT_IDS = ("bed", "chair", "kitchen.nook", "lamp.floor", "lamp.table", "mirror", "painting", "plant.potted", "rug", "shelf", "sofa", "table", "wardrobe")
