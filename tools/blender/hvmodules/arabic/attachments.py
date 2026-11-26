"""Arabic wall attachments: balcony (an enclosed mashrabiya oriel, a cedar balustrade with a
rug, or a plaster parapet with zellige), awning (woven stripes with tassels, a carved cedar
hood under green tiles, or a palm-leaf mat), flowerbox (a zellige planter, brass pots or a
carved box), shutters (cedar lattice, painted planks, or one mashrabiya screen over the window),
sign.hanging (a brass bracket with a painted board).

Same frame as the European attachments: the cell in front of a wall, the wall face at the back
plane (y = 1), the storey floor at z = 0, and the same ``mount`` sockets and ``fits:`` tags.
"""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.attachments import Awning as EuropeAwning
from hvmodules.europe.attachments import SignHanging as EuropeSignHanging

from .common import FASCIA_Z, WINDOW, ArabModule, lattice, mirror, pick

BACK = 1.0


@register
@mirror
class Balcony(ArabModule):
    """A shallow balcony on brackets: an enclosed cedar mashrabiya oriel under a small green
    tile roof, an open cedar balustrade with a rug over it, or a plaster parapet with a zellige
    band and potted jasmine."""

    id = "balcony"

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("mashrabiya", "balustrade", "parapet"), variant), "rug": rng.randint(0, 4), "pots": rng.randint(2, 3)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, y0 = 0.04, 0.96, 0.36
        kind = params["kind"]
        wood = ctx.paint("trims", 1, tile="timber")
        slab = wood if kind != "parapet" else ctx.paint("trims", 2, tile="stone")
        b.box((x0, y0, -0.09), (x1, BACK, 0.02), slab, bevel=0.015, segments=1, seams=("y+",))
        for cx in (0.14, 0.86):
            prof = [(BACK, -0.09), (y0 + 0.06, -0.09), (y0 + 0.2, -0.2), (BACK, -0.38)]
            b.solid(solids.prism(prof, "x", cx - 0.03, cx + 0.03), wood, bevel=0.0)
        if kind == "mashrabiya":
            # Solid lower panels, lattice above, on the front and both sides.
            b.box((x0, y0, 0.02), (x1, y0 + 0.04, 0.7), wood, bevel=0.0)
            for xa in (x0, x1 - 0.04):
                b.box((xa, y0 + 0.04, 0.02), (xa + 0.04, BACK, 0.7), wood, bevel=0.0, seams=("y+",))
            for xa, xb in ((x0, x0 + 0.05), (x1 - 0.05, x1)):
                b.box((xa, y0, 0.7), (xb, y0 + 0.05, 2.2), wood, bevel=0.0)
            b.box((x0, y0, 0.7), (x1, y0 + 0.04, 0.75), wood, bevel=0.0)
            lattice(b, x0 + 0.05, x1 - 0.05, 0.75, 2.2, y0 + 0.008, y0 + 0.032, wood, 6, 9)
            for xa in (x0, x1 - 0.04):
                lattice(b, y0 + 0.05, BACK, 0.75, 2.2, xa + 0.008, xa + 0.032, wood, 3, 9, axis="x")
            b.box((x0 - 0.03, y0 - 0.03, 2.2), (x1 + 0.03, BACK, 2.3), wood, bevel=0.01, segments=1, seams=("y+",))
            green = ctx.paint("roofs", 1, tile="roof_tile")
            prof = [(y0 - 0.06, 2.3), (BACK, 2.3), (BACK, 2.55)]
            b.solid(solids.prism(prof, "x", x0 - 0.05, x1 + 0.05), green, bevel=0.0)
            return [b.to_object(ctx.collection)]
        if kind == "balustrade":
            top = 0.85
            b.box((x0, y0, top - 0.05), (x1, y0 + 0.05, top), wood, bevel=0.01, segments=1)
            for xa in (x0, x1 - 0.05):
                b.box((xa, y0, top - 0.05), (xa + 0.05, BACK, top), wood, bevel=0.0, seams=("y+",))
                b.box((xa, y0, 0.02), (xa + 0.05, y0 + 0.05, top), wood, bevel=0.0)
            n = 8
            for i in range(1, n):
                x = x0 + (x1 - x0) * i / n
                b.cylinder((x, y0 + 0.025, 0.02), 0.018, top - 0.07, wood, sides=6, bevel=0.0)
            rug = ctx.paint("fabric", params["rug"], tile="plain")
            b.box((0.3, y0 - 0.02, 0.35), (0.7, y0 + 0.07, top + 0.02), rug, bevel=0.0)
            fringe = ctx.paint("fabric", 3, tile="plain")
            b.box((0.3, y0 - 0.025, 0.3), (0.7, y0 - 0.005, 0.35), fringe, bevel=0.0)
        else:
            wall = ctx.paint("walls", variant % 3, tile="stucco")
            b.box((x0, y0, 0.02), (x1, y0 + 0.1, 0.8), wall, bevel=0.02, segments=1)
            for xa in (x0, x1 - 0.1):
                b.box((xa, y0 + 0.1, 0.02), (xa + 0.1, BACK, 0.8), wall, bevel=0.02, segments=1, seams=("y+",))
            b.box((x0 - 0.02, y0 - 0.02, 0.8), (x1 + 0.02, y0 + 0.12, 0.85), ctx.paint("trims", 0, tile="stucco"), bevel=0.01, segments=1)
            for i in range(4):
                xa = x0 + 0.06 + i * 0.21
                b.box((xa, y0 - 0.006, 0.35), (xa + 0.19, y0, 0.55), ctx.paint("zellige", 1 + i % 3, tile="zellige"), bevel=0.0, noise=0.0)
        pot = ctx.paint("brass", 1, tile="plain") if kind == "balustrade" else ctx.paint("roofs", 2, tile="plain")
        leaf = ctx.paint("foliage", 1, tile="plain")
        flower = ctx.paint("flowers", variant % 2, tile="plain")
        for i in range(params["pots"]):
            cx = 0.22 + i * 0.28 + rng.jitter(0.03)
            cy = 0.8
            b.cylinder((cx, cy, 0.02), 0.07, 0.16, pot, sides=8, radius_top=0.09, bevel=0.0)
            b.blob((cx, cy, 0.25), 0.1, leaf, scale=(1.0, 1.0, 0.8), subdivisions=1, wobble=0.12)
            b.blob((cx + 0.03, cy - 0.05, 0.32), 0.05, flower, subdivisions=1, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Awning(ArabModule):
    """Woven canvas in saffron, rose and teal stripes with tassels, a carved cedar door hood
    under green glazed tiles, or a flat palm-leaf mat on a light frame."""

    id = "awning"
    TOP = EuropeAwning.TOP

    def variant_params(self, style, variant, rng):
        kind = pick(rng, ("stripes", "hood", "mat"), variant)
        colours = pick(rng, (((0,), (1,), (3,)), ((2,), (3,)), ((1,), (3,), (2,))), variant)
        return {"kind": kind, "colours": [c[0] for c in colours], "stripes": pick(rng, (9, 7, 7), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        top, front_y, front_z = self.TOP, 0.36, 1.98
        x0, x1 = 0.03, 0.97
        wood = ctx.paint("trims", 1, tile="timber")
        b.box((x0, BACK - 0.05, top - 0.06), (x1, BACK, top + 0.03), wood, bevel=0.0, seams=("y+",))
        kind = params["kind"]
        if kind == "hood":
            # Carved brackets under a small green tile roof.
            for xa in (x0 + 0.02, x1 - 0.08):
                prof = [(BACK, top - 0.45), (BACK, top + 0.02), (front_y + 0.04, top + 0.02), (front_y + 0.04, top - 0.06), (BACK - 0.25, top - 0.2)]
                b.solid(solids.prism(prof, "x", xa, xa + 0.06), wood, bevel=0.0)
            b.box((x0, front_y, top + 0.02), (x1, BACK, top + 0.09), wood, bevel=0.01, segments=1, seams=("y+",))
            for i in range(9):
                x = x0 + 0.04 + i * 0.11
                b.box((x, front_y - 0.02, top + 0.0), (x + 0.04, front_y + 0.03, top + 0.04), wood, bevel=0.0)
            green = ctx.paint("roofs", 1, tile="roof_tile")
            prof = [(front_y - 0.05, top + 0.09), (BACK, top + 0.09), (BACK, top + 0.38), (front_y - 0.05, top + 0.14)]
            b.solid(solids.prism(prof, "x", x0 - 0.02, x1 + 0.02, slices=2), green, bevel=0.0)
            cap = ctx.paint("roofs", 1, tile="plain")
            for i in range(6):
                x = x0 + 0.08 + i * 0.16
                b.solid(solids.tube([(x, front_y - 0.04, top + 0.15), (x, BACK - 0.02, top + 0.385)], [0.025, 0.025], sides=5), cap, bevel=0.0)
            return [b.to_object(ctx.collection)]
        if kind == "mat":
            reed = ctx.paint("fabric", params["colours"][0], tile="timber")
            z_back, z_front = top - 0.05, top - 0.2
            mat = [(BACK, z_back), (front_y, z_front), (front_y, z_front - 0.03), (BACK, z_back - 0.03)]
            b.solid(solids.prism(mat, "x", x0, x1, slices=1), reed, bevel=0.0)
            weave = ctx.paint("bark", 2, tile="timber")
            for i in range(params["stripes"]):
                x = x0 + (x1 - x0) * (i + 0.5) / params["stripes"]
                prof = [(BACK - 0.02, z_back + 0.002), (front_y + 0.02, z_front + 0.002), (front_y + 0.02, z_front + 0.012), (BACK - 0.02, z_back + 0.012)]
                b.solid(solids.prism(prof, "x", x - 0.01, x + 0.01), weave, bevel=0.0)
            for xa in (x0 + 0.02, x1 - 0.04):
                prof = solids.beam_profile((BACK - 0.02, z_back - 0.35), (front_y + 0.03, z_front - 0.02), 0.025)
                b.solid(solids.prism(prof, "x", xa, xa + 0.025), wood, bevel=0.0)
            return [b.to_object(ctx.collection)]
        n = params["stripes"]
        paints = [ctx.paint("fabric", c, tile="plain") for c in params["colours"]]
        canvas = [(BACK, top), (front_y, front_z), (front_y, front_z - 0.025), (BACK, top - 0.025)]
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            paint = paints[i % len(paints)]
            b.solid(solids.prism(canvas, "x", xa, xb, slices=1), paint, bevel=0.0)
            b.box((xa, front_y - 0.02, front_z - 0.12), (xb, front_y, front_z), paint, bevel=0.0)
        tassel = ctx.paint("brass", 0, tile="plain")
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            b.cylinder((x, front_y - 0.01, front_z - 0.22), 0.015, 0.1, tassel, sides=4, radius_top=0.006, bevel=0.0)
        for xa in (x0 + 0.02, x1 - 0.04):
            prof = solids.beam_profile((BACK - 0.02, front_z - 0.45), (front_y + 0.03, front_z - 0.03), 0.022)
            b.solid(solids.prism(prof, "x", xa, xa + 0.02), wood, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Flowerbox(ArabModule):
    """Under a window: a zellige-tiled planter of mint and basil, brass pots of geraniums on a
    cedar shelf, or a carved cedar box with roses."""

    id = "flowerbox"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("zellige", "brass", "carved"), variant),
            "sizes": [round(rng.uniform(0.85, 1.1), 3) for _ in range(4)],
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        x0, x1 = WINDOW[0] - 0.06, WINDOW[1] + 0.06
        z_shelf = WINDOW[2] - 0.24
        y0 = 0.76
        kind = params["kind"]
        wood = ctx.paint("trims", 1, tile="timber")
        b.box((x0, y0, z_shelf - 0.03), (x1, BACK, z_shelf), wood, bevel=0.0, seams=("y+",))
        for cx in (x0 + 0.05, x1 - 0.05):
            b.box((cx - 0.02, y0 + 0.1, z_shelf - 0.16), (cx + 0.02, BACK, z_shelf - 0.03), wood, bevel=0.0, seams=("y+",))
        if kind == "brass":
            for i in range(3):
                cx = x0 + 0.12 + (x1 - x0 - 0.24) * i / 2
                cy = (y0 + BACK) / 2
                s = params["sizes"][i]
                b.cylinder((cx, cy, z_shelf), 0.05 * s, 0.13 * s, ctx.paint("brass", i % 3, tile="plain"), sides=8, radius_top=0.065 * s, bevel=0.0)
                b.blob((cx, cy, z_shelf + 0.13 * s + 0.05), 0.08, ctx.paint("foliage", i % 2, tile="plain"), scale=(1.1, 1.0, 0.75), subdivisions=1, wobble=0.15)
                b.blob((cx, cy - 0.04, z_shelf + 0.13 * s + 0.1), 0.04, ctx.paint("flowers", 1, tile="plain"), subdivisions=1, wobble=0.1)
            return [b.to_object(ctx.collection)]
        h = 0.14
        if kind == "zellige":
            b.box((x0 + 0.02, y0, z_shelf), (x1 - 0.02, BACK - 0.02, z_shelf + h), ctx.paint("zellige", 0, tile="zellige"), bevel=0.01, segments=1)
            for i in range(5):
                xa = x0 + 0.04 + i * (x1 - x0 - 0.08) / 5
                b.box((xa + 0.005, y0 - 0.01, z_shelf + 0.03), (xa + (x1 - x0 - 0.08) / 5 - 0.005, y0, z_shelf + h - 0.03), ctx.paint("zellige", 1 + i % 3, tile="zellige"), bevel=0.0, noise=0.0)
        else:
            b.box((x0 + 0.02, y0, z_shelf), (x1 - 0.02, BACK - 0.02, z_shelf + h), wood, bevel=0.01, segments=1)
            lattice(b, x0 + 0.04, x1 - 0.04, z_shelf + 0.02, z_shelf + h - 0.02, y0 - 0.012, y0, wood, 7, 2)
        for i in range(4):
            cx = x0 + 0.1 + (x1 - x0 - 0.2) * i / 3
            cy = (y0 + BACK) / 2
            s = params["sizes"][i]
            if kind == "zellige":
                b.blob((cx, cy, z_shelf + h + 0.05 * s), 0.08 * s, ctx.paint("foliage", (i + 2) % 4, tile="plain"), scale=(0.9, 0.9, 1.1), subdivisions=1, wobble=0.15)
            else:
                b.blob((cx, cy, z_shelf + h + 0.04), 0.08, ctx.paint("foliage", i % 2, tile="plain"), scale=(1.1, 1.0, 0.75), subdivisions=1, wobble=0.15)
                b.blob((cx + 0.02, cy - 0.04, z_shelf + h + 0.1), 0.045, ctx.paint("flowers", 1 if i % 2 else 0, tile="plain"), subdivisions=1, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Shutters(ArabModule):
    """Beside a wall.window opening: a pair of open cedar lattice shutters, a pair of teal
    planked shutters with brass studs, or one mashrabiya screen hung in front of the window
    under a small hood."""

    id = "shutters"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("lattice", "painted", "screen"), variant),
            "colour": pick(rng, (("trims", 1), ("accents", 0), ("trims", 1)), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        paint = ctx.paint(*params["colour"], tile="timber")
        z0, z1 = WINDOW[2] - 0.02, WINDOW[3] + 0.02
        kind = params["kind"]
        iron = ctx.paint("iron", 0, tile="plain")
        if kind == "screen":
            x0, x1 = WINDOW[0] - 0.04, WINDOW[1] + 0.04
            y0, y1 = 0.86, 0.89
            f = 0.04
            b.box((x0, y0, z0), (x1, y1, z0 + f), paint, bevel=0.0)
            b.box((x0, y0, z1 - f), (x1, y1, z1), paint, bevel=0.0)
            b.box((x0, y0, z0 + f), (x0 + f, y1, z1 - f), paint, bevel=0.0)
            b.box((x1 - f, y0, z0 + f), (x1, y1, z1 - f), paint, bevel=0.0)
            lattice(b, x0 + f, x1 - f, z0 + f, z1 - f, y0 + 0.006, y1 - 0.006, paint, 6, 9)
            for xa in (x0, x1 - 0.03):
                b.box((xa, y1, z1 - 0.1), (xa + 0.03, BACK, z1 - 0.07), iron, bevel=0.0, seams=("y+",))
            b.box((x0 - 0.03, y0 - 0.02, z1), (x1 + 0.03, BACK, z1 + 0.06), paint, bevel=0.01, segments=1, seams=("y+",))
            return [b.to_object(ctx.collection)]
        y0, y1 = 0.935, 0.965
        f = 0.03
        brass = ctx.paint("brass", 0, tile="plain")
        for xa, xb in ((0.02, 0.2), (0.8, 0.98)):
            b.box((xa, y0, z0), (xa + f, y1, z1), paint, bevel=0.0)
            b.box((xb - f, y0, z0), (xb, y1, z1), paint, bevel=0.0)
            b.box((xa, y0, z0), (xb, y1, z0 + f), paint, bevel=0.0)
            b.box((xa, y0, z1 - f), (xb, y1, z1), paint, bevel=0.0)
            if kind == "lattice":
                b.box((xa + f, y0 + 0.018, z0 + f), (xb - f, y1, z1 - f), ctx.paint("trims", 1, tile="plain"), bevel=0.0, noise=0.0)
                lattice(b, xa + f, xb - f, z0 + f, z1 - f, y0 + 0.004, y0 + 0.018, paint, 3, 8)
            else:
                b.box((xa + f, y0 + 0.01, z0 + f), (xb - f, y1, z1 - f), paint, bevel=0.0)
                for k in range(4):
                    za = z0 + 0.12 + k * 0.27
                    b.box((xa + f + 0.01, y0 - 0.006, za), (xb - f - 0.01, y0 + 0.01, za + 0.16), paint, bevel=0.0)
                    for xx in (xa + 0.06, xb - 0.06):
                        b.box((xx - 0.01, y0 - 0.014, za + 0.07), (xx + 0.01, y0 - 0.006, za + 0.09), brass, bevel=0.0, noise=0.0)
            hinge_x = xb - 0.01 if xa < 0.5 else xa - 0.02
            for z in (z0 + 0.12, z1 - 0.12):
                b.box((hinge_x, y0 - 0.01, z), (hinge_x + 0.03, BACK, z + 0.025), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class SignHanging(EuropeSignHanging, ArabModule):
    """Bracket with a hanging painted board (the European bracket and board shapes, with cedar,
    teal and brass boards). The client draws the shop icon at the ``icon`` sockets."""

    id = "sign.hanging"
    styles = ArabModule.styles

    def variant_params(self, style, variant, rng):
        return {
            "shape": pick(rng, ("shield", "round", "rect"), variant),
            "board": pick(rng, (("trims", 1), ("accents", 0), ("brass", 0)), variant),
        }


__all__ = ["Awning", "Balcony", "Flowerbox", "Shutters", "SignHanging", "FASCIA_Z"]
