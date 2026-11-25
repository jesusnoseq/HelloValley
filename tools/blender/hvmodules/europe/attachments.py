"""Europe wall attachments: balcony, awning, flowerbox, shutters, sign.hanging.

Each one occupies the cell in front of a wall, in the wall's storey frame: the wall face is
the back plane (y = 1) and z = 0 is the storey floor. ``mount`` (0.5, 1, 0) mates with the
wall's ``facade`` socket, so placing an attachment is "same storey, one cell forward".
``fits:<wall id>`` tags name the walls whose openings an attachment is sized for.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

from hvkit.grid import STOREY_M, Footprint
from hvkit.module import Module, Socket, register
from hvkit.variants import VariantRng

from .common import FASCIA_Z, PROP_BUDGET, STYLES, WINDOW, pick

BACK = 1.0
"""The wall plane, in attachment space."""


def mount(*extra: Socket) -> tuple:
    return (Socket("mount", "attach", (0.5, BACK, 0.0), (0.0, -1.0, 0.0)),) + extra


class EuropeAttachment(Module):
    footprint = Footprint(w=1, d=1, h=STOREY_M)
    variants = 3
    styles = STYLES
    tri_budget = PROP_BUDGET
    sockets = mount()


@register
class Balcony(EuropeAttachment):
    """A small balcony for an upper-storey wall.door (french door) or wall.window. The floor is
    level with the storey floor; corbels hang below it."""

    id = "balcony"
    tags = ("attachment", "europe", "fits:wall.door", "fits:wall.window")
    max_overhang_m = 0.42
    sockets = mount(Socket("floor", "prop", (0.5, 0.65, 0.0), (0.0, 0.0, 1.0)))

    def variant_params(self, style, variant, rng):
        return {
            "rail": pick(rng, ("wood", "iron", "parapet"), variant),
            "pots": rng.randint(1, 3),
        }

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, y0 = 0.04, 0.96, 0.32
        stone = ctx.paint("trims", 1, tile="stone")
        b.box((x0, y0, -0.1), (x1, BACK, 0.02), stone, bevel=0.02, segments=1, seams=("y+",))
        for cx in (0.16, 0.84):
            prof = [(BACK, -0.1), (y0 + 0.1, -0.1), (BACK, -0.4)]
            b.solid(solids.prism(prof, "x", cx - 0.04, cx + 0.04), stone, bevel=0.01, segments=1)
        rail = params["rail"]
        if rail == "parapet":
            plaster = ctx.paint("walls", rng.randint(0, 3), tile="plaster")
            b.box((x0, y0, 0.02), (x1, y0 + 0.1, 0.72), plaster, bevel=0.02, segments=1)
            for xa in (x0, x1 - 0.1):
                b.box((xa, y0 + 0.1, 0.02), (xa + 0.1, BACK, 0.72), plaster, bevel=0.02, segments=1, seams=("y+",))
            b.box((x0 - 0.02, y0 - 0.02, 0.72), (x1 + 0.02, y0 + 0.12, 0.78), stone, bevel=0.012, segments=1)
        else:
            iron = rail == "iron"
            paint = ctx.paint("iron", 0, tile="plain") if iron else ctx.paint("trims", 0, tile="wood")
            bar = 0.018 if iron else 0.045
            top = 0.85
            kw = dict(bevel=0.0) if iron else dict(bevel=0.008, segments=1)
            b.box((x0, y0, top - 0.05), (x1, y0 + 0.06, top), paint, **kw)
            b.box((x0, y0, 0.08), (x1, y0 + 0.04, 0.12), paint, bevel=0.0)
            for xa in (x0, x1 - 0.06):
                b.box((xa, y0, top - 0.05), (xa + 0.06, BACK, top), paint, **kw, seams=("y+",))
                b.box((xa, y0, 0.02), (xa + 0.06, y0 + 0.06, top), paint, **kw)
            n = 9 if iron else 7
            for i in range(1, n):
                x = x0 + (x1 - x0) * i / n
                b.box((x - bar / 2, y0 + 0.01, 0.02), (x + bar / 2, y0 + 0.01 + bar, top - 0.05), paint, bevel=0.0)
            for xa in (x0 + 0.01, x1 - 0.05):
                for k in range(1, 4):
                    y = y0 + (BACK - y0) * k / 4
                    b.box((xa, y - bar / 2, 0.02), (xa + bar, y + bar / 2, top - 0.05), paint, bevel=0.0)
            if iron:
                # Scrolls: small diamonds along the top rail.
                for i in range(n):
                    x = x0 + (x1 - x0) * (i + 0.5) / n
                    prof = [(x, top - 0.2), (x + 0.04, top - 0.13), (x, top - 0.06), (x - 0.04, top - 0.13)]
                    b.solid(solids.prism(prof, "y", y0 + 0.012, y0 + 0.026), paint, bevel=0.0)
        pot = ctx.paint("roofs", 1, tile="plain")
        flower = ctx.paint("accents", 0, tile="plain")
        leaf = ctx.paint("foliage", 0, tile="plain")
        for i in range(params["pots"]):
            cx = 0.2 + i * 0.3 + rng.jitter(0.03)
            cy = 0.78
            b.cylinder((cx, cy, 0.02), 0.08, 0.16, pot, sides=8, radius_top=0.1, bevel=0.0)
            b.blob((cx, cy, 0.26), 0.12, leaf, scale=(1.0, 1.0, 0.8), wobble=0.12)
            b.blob((cx + 0.04, cy - 0.06, 0.34), 0.05, flower, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
class Awning(EuropeAttachment):
    """Striped canvas awning above a shopfront or door, with a scalloped valance."""

    id = "awning"
    tags = ("attachment", "europe", "fits:wall.shopfront", "fits:wall.door")
    TOP = FASCIA_Z[0] - 0.02
    sockets = mount(Socket("valance", "attach", (0.5, 0.34, 1.86), (0.0, -1.0, 0.0)))

    def variant_params(self, style, variant, rng):
        colours = pick(rng, ((("accents", 0), ("trims", 1)), (("accents", 1), ("trims", 1)), (("walls", 1), ("roofs", 0))), variant)
        return {"colours": colours, "stripes": pick(rng, (6, 8, 5), variant), "cheeks": variant == 2}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        top, front_y, front_z = self.TOP, 0.34, 1.95
        x0, x1 = 0.03, 0.97
        n = params["stripes"]
        paints = [ctx.paint(*c, tile="plain") for c in params["colours"]]
        canvas = [(BACK, top), (front_y, front_z), (front_y, front_z - 0.025), (BACK, top - 0.025)]
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            paint = paints[i % 2]
            b.solid(solids.prism(canvas, "x", xa, xb, slices=1), paint, bevel=0.0)
            mid = (xa + xb) / 2
            flap = [(xa, front_z), (xb, front_z), (xb, front_z - 0.13), (mid, front_z - 0.2), (xa, front_z - 0.13)]
            b.solid(solids.prism(flap, "y", front_y - 0.02, front_y), paint, bevel=0.0)
        iron = ctx.paint("iron", 0, tile="plain")
        for xa in (x0 + 0.02, x1 - 0.04):
            prof = solids.beam_profile((BACK - 0.02, front_z - 0.45), (front_y + 0.03, front_z - 0.03), 0.025)
            b.solid(solids.prism(prof, "x", xa, xa + 0.02), iron, bevel=0.0)
        b.box((x0, BACK - 0.05, top - 0.06), (x1, BACK, top + 0.04), iron, bevel=0.01, segments=1, seams=("y+",))
        if params["cheeks"]:
            cheek = [(BACK, top - 0.02), (front_y, front_z - 0.02), (BACK, front_z - 0.02)]
            for xa in (x0, x1 - 0.015):
                b.solid(solids.prism(cheek, "x", xa, xa + 0.015), paints[0], bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Flowerbox(EuropeAttachment):
    """Window box under a wall.window sill, full of geraniums."""

    id = "flowerbox"
    tags = ("attachment", "plant", "europe", "fits:wall.window")
    sockets = mount(Socket("sill", "attach", (0.5, BACK, WINDOW[2]), (0.0, -1.0, 0.0)))

    def variant_params(self, style, variant, rng):
        return {
            "box": pick(rng, (("trims", 0, "wood"), ("accents", 1, "wood"), ("roofs", 1, "plain")), variant),
            "flowers": pick(rng, ((("accents", 0),), (("walls", 3), ("trims", 1)), (("accents", 0), ("accents", 2))), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1 = WINDOW[0] - 0.06, WINDOW[1] + 0.06
        y0, y1 = 0.7, 0.92
        z0, z1 = WINDOW[2] - 0.26, WINDOW[2] - 0.07
        group, idx, tile = params["box"]
        box = ctx.paint(group, idx, tile=tile)
        b.box((x0, y0, z0), (x1, y1, z1), box, bevel=0.015, segments=1)
        soil = ctx.paint("trims", 0, tile="plain")
        b.box((x0 + 0.03, y0 + 0.03, z1 - 0.02), (x1 - 0.03, y1 - 0.03, z1 + 0.005), soil, bevel=0.0)
        iron = ctx.paint("iron", 0, tile="plain")
        for cx in (x0 + 0.08, x1 - 0.08):
            prof = [(BACK, z0 + 0.04), (y0 + 0.04, z0 + 0.04), (BACK, z0 - 0.14)]
            b.solid(solids.prism(prof, "x", cx - 0.015, cx + 0.015), iron, bevel=0.0)
        leaf = ctx.paint("foliage", rng.randint(0, 2), tile="plain")
        n = 4
        for i in range(n):
            cx = x0 + 0.1 + (x1 - x0 - 0.2) * i / (n - 1)
            b.blob((cx, (y0 + y1) / 2 + rng.jitter(0.02), z1 + 0.07), 0.1, leaf, scale=(1.0, 0.9, 0.7), wobble=0.15)
        flowers = [ctx.paint(*c, tile="plain") for c in params["flowers"]]
        for i in range(5):
            cx = x0 + 0.08 + (x1 - x0 - 0.16) * i / 4 + rng.jitter(0.02)
            b.blob((cx, y0 + 0.05 + rng.jitter(0.03), z1 + 0.15 + rng.jitter(0.03)), 0.055, flowers[i % len(flowers)], wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
class Shutters(EuropeAttachment):
    """A pair of open wooden shutters flanking a wall.window opening."""

    id = "shutters"
    tags = ("attachment", "window", "europe", "fits:wall.window")
    sockets = mount(Socket("window", "attach", (0.5, BACK, (WINDOW[2] + WINDOW[3]) / 2), (0.0, -1.0, 0.0)))

    def variant_params(self, style, variant, rng):
        return {
            "colour": pick(rng, (("accents", 1), ("trims", 0), ("roofs", 2)), variant),
            "style": pick(rng, ("louvred", "planked", "panelled"), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        paint = ctx.paint(*params["colour"], tile="wood")
        z0, z1 = WINDOW[2] - 0.02, WINDOW[3] + 0.02
        y0, y1 = 0.935, 0.965
        iron = ctx.paint("iron", 0, tile="plain")
        style = params["style"]
        for xa, xb in ((0.02, 0.2), (0.8, 0.98)):
            if style == "louvred":
                f = 0.03
                b.box((xa, y0, z0), (xa + f, y1, z1), paint, bevel=0.0)
                b.box((xb - f, y0, z0), (xb, y1, z1), paint, bevel=0.0)
                b.box((xa, y0, z0), (xb, y1, z0 + f), paint, bevel=0.0)
                b.box((xa, y0, z1 - f), (xb, y1, z1), paint, bevel=0.0)
                b.box((xa, y0, (z0 + z1) / 2 - f / 2), (xb, y1, (z0 + z1) / 2 + f / 2), paint, bevel=0.0)
                b.box((xa + f, y0 + 0.012, z0 + f), (xb - f, y1, z1 - f), ctx.paint(*params["colour"], tile="plain"), bevel=0.0)
                slats = 12
                for k in range(slats):
                    z = z0 + f + (z1 - z0 - 2 * f) * (k + 0.5) / slats
                    b.box((xa + f, y0 + 0.004, z - 0.012), (xb - f, y0 + 0.016, z + 0.012), paint, bevel=0.0)
            elif style == "planked":
                w = (xb - xa) / 3
                for k in range(3):
                    b.box((xa + k * w + 0.003, y0 + rng.jitter(0.003), z0), (xa + (k + 1) * w - 0.003, y1, z1), paint, bevel=0.006, segments=1)
                for z in (z0 + 0.15, z1 - 0.25):
                    b.box((xa + 0.01, y0 - 0.015, z), (xb - 0.01, y0, z + 0.07), paint, bevel=0.006, segments=1)
            else:
                b.box((xa, y0, z0), (xb, y1, z1), paint, bevel=0.008, segments=1)
                for za, zb in ((z0 + 0.06, (z0 + z1) / 2 - 0.03), ((z0 + z1) / 2 + 0.03, z1 - 0.06)):
                    b.box((xa + 0.035, y0 - 0.015, za), (xb - 0.035, y0, zb), paint, bevel=0.008, segments=1)
            hinge_x = xb - 0.01 if xa < 0.5 else xa - 0.02
            for z in (z0 + 0.12, z1 - 0.12):
                b.box((hinge_x, y0 - 0.01, z), (hinge_x + 0.03, BACK, z + 0.025), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class SignHanging(EuropeAttachment):
    """Wrought-iron bracket with a blank hanging shop sign, readable from along the street.
    The client draws the shop icon on the board at the ``icon`` sockets (TODO(M10))."""

    id = "sign.hanging"
    tags = ("attachment", "sign", "europe", "fits:wall.plain", "fits:wall.door", "fits:wall.shopfront", "fits:wall.timber")
    BOARD = (0.42, 0.86, 1.95, 2.4)
    """y0, y1, z0, z1 of the board."""
    sockets = mount(
        Socket("icon", "attach", (0.47, 0.64, 2.175), (-1.0, 0.0, 0.0)),
        Socket("icon_back", "attach", (0.53, 0.64, 2.175), (1.0, 0.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "shape": pick(rng, ("rect", "round", "shield"), variant),
            "board": pick(rng, (("trims", 2), ("accents", 1), ("walls", 1)), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        iron = ctx.paint("iron", 0, tile="plain")
        arm_z = 2.6
        y0, y1, z0, z1 = self.BOARD
        b.box((0.44, BACK - 0.03, arm_z - 0.35), (0.56, BACK, arm_z + 0.08), iron, bevel=0.01, segments=1, seams=("y+",))
        b.box((0.485, y0 - 0.06, arm_z - 0.02), (0.515, BACK, arm_z + 0.02), iron, bevel=0.0)
        brace = solids.beam_profile((BACK - 0.02, arm_z - 0.32), (y0 + 0.12, arm_z - 0.01), 0.022)
        b.solid(solids.prism(brace, "x", 0.49, 0.51), iron, bevel=0.0)
        # A curl at the arm's tip and two short chains.
        ring = [(y0 - 0.06 + 0.04 * math.cos(a), arm_z + 0.04 * math.sin(a)) for a in (i * math.pi / 3 for i in range(6))]
        b.solid(solids.prism(ring, "x", 0.49, 0.51), iron, bevel=0.0)
        for y in (y0 + 0.06, y1 - 0.06):
            b.box((0.494, y - 0.006, z1), (0.506, y + 0.006, arm_z - 0.02), iron, bevel=0.0)
        board = ctx.paint(*params["board"], tile="wood")
        frame = ctx.paint("iron", 1, tile="plain")
        shape = params["shape"]
        cy, cz = (y0 + y1) / 2, (z0 + z1) / 2
        if shape == "rect":
            b.box((0.47, y0, z0), (0.53, y1, z1), frame, bevel=0.012, segments=1)
            b.box((0.465, y0 + 0.03, z0 + 0.03), (0.535, y1 - 0.03, z1 - 0.03), board, bevel=0.008, segments=1)
        elif shape == "round":
            r = (z1 - z0) / 2
            outer = [(cy + r * math.cos(a), cz + r * math.sin(a)) for a in (i * math.pi / 6 for i in range(12))]
            inner = [(cy + (r - 0.03) * math.cos(a), cz + (r - 0.03) * math.sin(a)) for a in (i * math.pi / 6 for i in range(12))]
            b.solid(solids.prism(outer, "x", 0.47, 0.53), frame, bevel=0.0)
            b.solid(solids.prism(inner, "x", 0.465, 0.535), board, bevel=0.0)
        else:
            outline = [(y0, z1), (y1, z1), (y1, z0 + 0.15), (cy, z0), (y0, z0 + 0.15)]
            inset = [(y0 + 0.03, z1 - 0.03), (y1 - 0.03, z1 - 0.03), (y1 - 0.03, z0 + 0.16), (cy, z0 + 0.04), (y0 + 0.03, z0 + 0.16)]
            b.solid(solids.prism(outline, "x", 0.47, 0.53), frame, bevel=0.01, segments=1)
            b.solid(solids.prism(inset, "x", 0.465, 0.535), board, bevel=0.0)
        return [b.to_object(ctx.collection)]

