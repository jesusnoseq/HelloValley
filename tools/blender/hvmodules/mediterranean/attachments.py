"""Mediterranean wall attachments: balcony (wrought iron or stucco), awning (striped canvas or
cane), flowerbox (terracotta pots on an iron shelf), shutters (blue, sage and teal),
sign.hanging (a painted-tile board on an iron bracket).

Same frame as the European attachments: the cell in front of a wall, the wall face at the back
plane (y = 1), the storey floor at z = 0, and the same ``mount`` sockets and ``fits:`` tags.
"""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.attachments import Awning as EuropeAwning
from hvmodules.europe.attachments import SignHanging as EuropeSignHanging

from .common import FASCIA_Z, WINDOW, MedModule, mirror, pick

BACK = 1.0


@register
@mirror
class Balcony(MedModule):
    """A shallow balcony on iron brackets: a straight iron railing with geranium pots, an iron
    railing with a bougainvillea spilling over it, or a whitewashed parapet with a tiled cap."""

    id = "balcony"

    def variant_params(self, style, variant, rng):
        return {"rail": pick(rng, ("iron", "bougainvillea", "stucco"), variant), "pots": rng.randint(2, 3)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, y0 = 0.04, 0.96, 0.36
        rail = params["rail"]
        slab = ctx.paint("roofs", 1, tile="terracotta") if rail != "stucco" else ctx.paint("trims", 2, tile="stone")
        b.box((x0, y0, -0.09), (x1, BACK, 0.02), slab, bevel=0.015, segments=1, seams=("y+",))
        iron = ctx.paint("iron", 0, tile="plain")
        for cx in (0.14, 0.86):
            prof = [(BACK, -0.09), (y0 + 0.08, -0.09), (BACK, -0.38)]
            b.solid(solids.prism(prof, "x", cx - 0.015, cx + 0.015), iron, bevel=0.0)
        if rail == "stucco":
            wall = ctx.paint("trims", 0, tile="stucco")
            b.box((x0, y0, 0.02), (x1, y0 + 0.1, 0.75), wall, bevel=0.02, segments=1)
            for xa in (x0, x1 - 0.1):
                b.box((xa, y0 + 0.1, 0.02), (xa + 0.1, BACK, 0.75), wall, bevel=0.02, segments=1, seams=("y+",))
            cap = ctx.paint("roofs", 0, tile="terracotta")
            b.box((x0 - 0.02, y0 - 0.02, 0.75), (x1 + 0.02, y0 + 0.12, 0.8), cap, bevel=0.01, segments=1)
            tiles = [ctx.paint("ceramic", 1, tile="plain"), ctx.paint("ceramic", 0, tile="plain")]
            for i in range(4):
                xa = x0 + 0.08 + i * 0.2
                b.box((xa, y0 - 0.006, 0.3), (xa + 0.18, y0, 0.5), tiles[i % 2], bevel=0.0, noise=0.0)
        else:
            top = 0.88
            b.box((x0, y0, top - 0.04), (x1, y0 + 0.04, top), iron, bevel=0.0)
            b.box((x0, y0, 0.06), (x1, y0 + 0.03, 0.09), iron, bevel=0.0)
            for xa in (x0, x1 - 0.04):
                b.box((xa, y0, top - 0.04), (xa + 0.04, BACK, top), iron, bevel=0.0, seams=("y+",))
                b.box((xa, y0, 0.02), (xa + 0.03, y0 + 0.03, top), iron, bevel=0.0)
            n = 10
            for i in range(1, n):
                x = x0 + (x1 - x0) * i / n
                b.box((x - 0.008, y0 + 0.01, 0.02), (x + 0.008, y0 + 0.026, top - 0.04), iron, bevel=0.0)
            for xa in (x0 + 0.01, x1 - 0.03):
                for k in range(1, 3):
                    y = y0 + (BACK - y0) * k / 3
                    b.box((xa, y - 0.008, 0.02), (xa + 0.016, y + 0.008, top - 0.04), iron, bevel=0.0)
            # A row of iron rings under the top rail.
            for i in range(n):
                x = x0 + (x1 - x0) * (i + 0.5) / n
                ring = [(x + 0.035 * c, top - 0.13 + 0.05 * s) for c, s in ((1, 0), (0.5, 0.87), (-0.5, 0.87), (-1, 0), (-0.5, -0.87), (0.5, -0.87))]
                b.solid(solids.prism(ring, "y", y0 + 0.012, y0 + 0.024), iron, bevel=0.0)
            if rail == "bougainvillea":
                for i in range(6):
                    x = x0 + 0.1 + i * 0.15 + rng.jitter(0.03)
                    group, idx = ("blossom", i % 3) if i % 2 == 0 else ("foliage", 1)
                    b.blob((x, y0 + 0.02, top - 0.05 - 0.12 * (i % 3)), 0.1, ctx.paint(group, idx, tile="plain"), scale=(1.2, 0.6, 1.0), subdivisions=1, wobble=0.12)
        pot = ctx.paint("pot", 0, tile="terracotta")
        leaf = ctx.paint("foliage", 0, tile="plain")
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
class Awning(MedModule):
    """Canvas awning in blue-and-white or terracotta stripes with a scalloped valance, or a flat
    cane (canizo) shade on an iron frame."""

    id = "awning"
    TOP = EuropeAwning.TOP

    def variant_params(self, style, variant, rng):
        kind = pick(rng, ("stripes", "stripes", "cane"), variant)
        colours = pick(rng, ((("accents", 0), ("trims", 0)), (("roofs", 0), ("walls", 3)), (("trims", 2), ("trims", 1))), variant)
        return {"kind": kind, "colours": colours, "stripes": pick(rng, (7, 5, 9), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        top, front_y, front_z = self.TOP, 0.36, 1.98
        x0, x1 = 0.03, 0.97
        iron = ctx.paint("iron", 0, tile="plain")
        b.box((x0, BACK - 0.05, top - 0.06), (x1, BACK, top + 0.03), iron, bevel=0.0, seams=("y+",))
        if params["kind"] == "cane":
            # Flat, slightly sloping reed mat on a light iron frame.
            reed = ctx.paint(*params["colours"][0], tile="timber")
            z_back, z_front = top - 0.05, top - 0.18
            mat = [(BACK, z_back), (front_y, z_front), (front_y, z_front - 0.03), (BACK, z_back - 0.03)]
            b.solid(solids.prism(mat, "x", x0, x1, slices=1), reed, bevel=0.0)
            dark = ctx.paint(*params["colours"][1], tile="timber")
            n = params["stripes"]
            for i in range(n):
                x = x0 + (x1 - x0) * (i + 0.5) / n
                prof = [(BACK - 0.02, z_back + 0.002), (front_y + 0.02, z_front + 0.002), (front_y + 0.02, z_front + 0.012), (BACK - 0.02, z_back + 0.012)]
                b.solid(solids.prism(prof, "x", x - 0.008, x + 0.008), dark, bevel=0.0)
            for xa in (x0 + 0.02, x1 - 0.04):
                b.box((xa, front_y, z_front - 0.03), (xa + 0.02, front_y + 0.02, z_front + 0.01), iron, bevel=0.0)
                prof = solids.beam_profile((BACK - 0.02, z_back - 0.35), (front_y + 0.03, z_front - 0.02), 0.02)
                b.solid(solids.prism(prof, "x", xa, xa + 0.02), iron, bevel=0.0)
            return [b.to_object(ctx.collection)]
        n = params["stripes"]
        paints = [ctx.paint(*c, tile="plain") for c in params["colours"]]
        canvas = [(BACK, top), (front_y, front_z), (front_y, front_z - 0.025), (BACK, top - 0.025)]
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            paint = paints[i % 2]
            b.solid(solids.prism(canvas, "x", xa, xb, slices=1), paint, bevel=0.0)
            mid = (xa + xb) / 2
            flap = [(xa, front_z), (xb, front_z), (xb, front_z - 0.1), (mid, front_z - 0.17), (xa, front_z - 0.1)]
            b.solid(solids.prism(flap, "y", front_y - 0.02, front_y), paint, bevel=0.0)
        for xa in (x0 + 0.02, x1 - 0.04):
            prof = solids.beam_profile((BACK - 0.02, front_z - 0.45), (front_y + 0.03, front_z - 0.03), 0.022)
            b.solid(solids.prism(prof, "x", xa, xa + 0.02), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Flowerbox(MedModule):
    """Terracotta pots on an iron shelf under a window: red geraniums, blue-painted pots with
    pinks (a Cordoba patio), or a row of herbs."""

    id = "flowerbox"

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("geraniums", "painted", "herbs"), variant),
            "count": pick(rng, (3, 3, 4), variant),
            "sizes": [round(rng.uniform(0.85, 1.1), 3) for _ in range(4)],
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        x0, x1 = WINDOW[0] - 0.06, WINDOW[1] + 0.06
        z_shelf = WINDOW[2] - 0.24
        iron = ctx.paint("iron", 0, tile="plain")
        y0 = 0.74
        b.box((x0, y0, z_shelf - 0.025), (x1, BACK, z_shelf), iron, bevel=0.0, seams=("y+",))
        b.box((x0, y0, z_shelf + 0.1), (x1, y0 + 0.015, z_shelf + 0.12), iron, bevel=0.0)
        for cx in (x0 + 0.03, x1 - 0.03):
            b.box((cx - 0.01, y0, z_shelf - 0.16), (cx + 0.01, y0 + 0.015, z_shelf + 0.12), iron, bevel=0.0)
            b.box((cx - 0.01, y0, z_shelf - 0.16), (cx + 0.01, BACK, z_shelf - 0.14), iron, bevel=0.0, seams=("y+",))
        kind = params["kind"]
        n = params["count"]
        for i in range(n):
            cx = x0 + 0.1 + (x1 - x0 - 0.2) * i / (n - 1)
            cy = (y0 + BACK) / 2
            s = params["sizes"][i]
            if kind == "painted":
                pot = ctx.paint("accents", 0, tile="plain")
            else:
                pot = ctx.paint("pot", i % 3, tile="terracotta")
            r = 0.065 * s
            b.cylinder((cx, cy, z_shelf), r * 0.8, 0.14 * s, pot, sides=8, radius_top=r, bevel=0.0)
            if kind == "herbs":
                leaf = ctx.paint("foliage", (i + 1) % 3, tile="plain")
                b.blob((cx, cy, z_shelf + 0.14 * s + 0.07), 0.08, leaf, scale=(0.9, 0.9, 1.1), subdivisions=1, wobble=0.15)
                if i % 2 == 0:
                    b.blob((cx + 0.02, cy - 0.04, z_shelf + 0.14 * s + 0.15), 0.025, ctx.paint("flowers", 2, tile="plain"), subdivisions=1, wobble=0.05)
            else:
                leaf = ctx.paint("foliage", i % 2, tile="plain")
                b.blob((cx, cy, z_shelf + 0.14 * s + 0.06), 0.09, leaf, scale=(1.1, 1.0, 0.75), subdivisions=1, wobble=0.15)
                flower = ctx.paint("flowers", 0 if kind == "geraniums" else 1, tile="plain")
                for j in range(2):
                    b.blob((cx + (j - 0.5) * 0.07, cy - 0.03, z_shelf + 0.14 * s + 0.12 + 0.02 * j), 0.04, flower, subdivisions=1, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Shutters(MedModule):
    """A pair of open shutters beside a wall.window opening: blue louvred (persianas), sage
    planked with a Z brace, or teal louvred with a solid lower panel."""

    id = "shutters"

    def variant_params(self, style, variant, rng):
        return {
            "colour": pick(rng, (("accents", 0), ("accents", 1), ("accents", 4)), variant),
            "style": pick(rng, ("louvred", "planked", "half"), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        paint = ctx.paint(*params["colour"], tile="wood")
        flat = ctx.paint(*params["colour"], tile="plain")
        z0, z1 = WINDOW[2] - 0.02, WINDOW[3] + 0.02
        y0, y1 = 0.935, 0.965
        iron = ctx.paint("iron", 0, tile="plain")
        style = params["style"]
        f = 0.03
        for xa, xb in ((0.02, 0.2), (0.8, 0.98)):
            if style in ("louvred", "half"):
                b.box((xa, y0, z0), (xa + f, y1, z1), paint, bevel=0.0)
                b.box((xb - f, y0, z0), (xb, y1, z1), paint, bevel=0.0)
                b.box((xa, y0, z0), (xb, y1, z0 + f), paint, bevel=0.0)
                b.box((xa, y0, z1 - f), (xb, y1, z1), paint, bevel=0.0)
                b.box((xa + f, y0 + 0.012, z0 + f), (xb - f, y1, z1 - f), flat, bevel=0.0)
                lo = z0 + f
                if style == "half":
                    mid = z0 + (z1 - z0) * 0.4
                    b.box((xa + f, y0, z0 + f), (xb - f, y1, mid), paint, bevel=0.0)
                    b.box((xa, y0, mid), (xb, y1, mid + f), paint, bevel=0.0)
                    lo = mid + f
                slats = 10 if style == "louvred" else 6
                for k in range(slats):
                    z = lo + (z1 - f - lo) * (k + 0.5) / slats
                    b.box((xa + f, y0 + 0.004, z - 0.012), (xb - f, y0 + 0.016, z + 0.012), paint, bevel=0.0)
            else:
                w = (xb - xa) / 3
                for k in range(3):
                    b.box((xa + k * w + 0.003, y0 + rng.jitter(0.003), z0), (xa + (k + 1) * w - 0.003, y1, z1), paint, bevel=0.006, segments=1)
                for z in (z0 + 0.15, z1 - 0.22):
                    b.box((xa + 0.01, y0 - 0.015, z), (xb - 0.01, y0, z + 0.07), paint, bevel=0.0)
                brace = solids.beam_profile((xa + 0.03, z0 + 0.22), (xb - 0.03, z1 - 0.25), 0.05)
                b.solid(solids.prism(brace, "y", y0 - 0.015, y0), paint, bevel=0.0)
            hinge_x = xb - 0.01 if xa < 0.5 else xa - 0.02
            for z in (z0 + 0.12, z1 - 0.12):
                b.box((hinge_x, y0 - 0.01, z), (hinge_x + 0.03, BACK, z + 0.025), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class SignHanging(EuropeSignHanging, MedModule):
    """Iron bracket with a hanging painted board (the European bracket and board shapes, with
    whitewashed, ochre and painted-tile boards). The client draws the shop icon at the ``icon``
    sockets."""

    id = "sign.hanging"
    styles = MedModule.styles

    def variant_params(self, style, variant, rng):
        return {
            "shape": pick(rng, ("round", "shield", "rect"), variant),
            "board": pick(rng, (("trims", 0), ("walls", 1), ("ceramic", 1)), variant),
        }


__all__ = ["Awning", "Balcony", "Flowerbox", "Shutters", "SignHanging", "FASCIA_Z"]
