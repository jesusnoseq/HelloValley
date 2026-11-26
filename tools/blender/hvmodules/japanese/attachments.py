"""Japanese wall attachments: balcony (a wooden veranda in the engawa manner), awning (a little
tiled pent roof, a copper one or a hanging reed blind), flowerbox (bonsai, morning glories or
ikebana on a wooden shelf), shutters (lattice screens, a bamboo blind or storm boards),
sign.hanging (a wooden kanban on a bracket).

Same frame as the European attachments: the cell in front of a wall, the wall face at the back
plane (y = 1), the storey floor at z = 0, and the same ``mount`` sockets and ``fits:`` tags.
"""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.attachments import Awning as EuropeAwning
from hvmodules.europe.attachments import SignHanging as EuropeSignHanging

from .common import WINDOW, JapModule, mirror, pick

BACK = 1.0


@register
@mirror
class Balcony(JapModule):
    """A shallow wooden veranda on brackets: a plain rail on square balusters, a lattice
    railing (koshi), or a bamboo railing tied with black rope."""

    id = "balcony"

    def variant_params(self, style, variant, rng):
        return {"rail": pick(rng, ("rail", "lattice", "bamboo"), variant), "wood": pick(rng, (1, 0, 2), variant)}

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1, y0 = 0.04, 0.96, 0.38
        wood = ctx.paint("trims", params["wood"], tile="timber")
        dark = ctx.paint("trims", 0, tile="timber")
        n = 6
        for i in range(n):
            ya = y0 + (BACK - y0) * i / n
            yb = y0 + (BACK - y0) * (i + 1) / n - 0.008
            b.box((x0, ya, -0.06), (x1, yb, 0.02), wood, bevel=0.0, seams=("y+",) if i == n - 1 else ())
        b.box((x0, y0, -0.12), (x1, y0 + 0.05, -0.06), dark, bevel=0.0)
        for cx in (0.12, 0.88):
            prof = [(BACK, -0.06), (y0 + 0.06, -0.06), (BACK, -0.36)]
            b.solid(solids.prism(prof, "x", cx - 0.025, cx + 0.025), dark, bevel=0.0)
        top = 0.82
        rail = params["rail"]
        if rail == "bamboo":
            cane = ctx.paint("bamboo", 0, tile="bamboo")
            rope = ctx.paint("rope", 0, tile="plain")
            for x in (x0 + 0.03, x1 - 0.03):
                b.cylinder((x, y0 + 0.03, 0.02), 0.03, top - 0.02, cane, sides=6, bevel=0.0)
            for z in (0.3, 0.55, top - 0.02):
                b.solid(solids.tube([(x0, y0 + 0.03, z), (x1, y0 + 0.03, z)], [0.022, 0.022], sides=5), cane, bevel=0.0)
            for x in (x0 + 0.03, x1 - 0.03):
                b.box((x - 0.035, y0, top - 0.06), (x + 0.035, y0 + 0.06, top - 0.03), rope, bevel=0.0, noise=0.0)
            for z in (0.3, 0.55):
                b.solid(solids.tube([(x0 + 0.03, y0 + 0.03, z), (x0 + 0.03, BACK, z)], [0.018, 0.018], sides=5), cane, bevel=0.0)
                b.solid(solids.tube([(x1 - 0.03, y0 + 0.03, z), (x1 - 0.03, BACK, z)], [0.018, 0.018], sides=5), cane, bevel=0.0)
            return [b.to_object(ctx.collection)]
        b.box((x0, y0, top - 0.05), (x1, y0 + 0.06, top), dark, bevel=0.0)
        for xa in (x0, x1 - 0.05):
            b.box((xa, y0, top - 0.05), (xa + 0.05, BACK, top), dark, bevel=0.0, seams=("y+",))
            b.box((xa, y0, 0.02), (xa + 0.05, y0 + 0.05, top), dark, bevel=0.0)
        b.box((x0, y0, 0.08), (x1, y0 + 0.04, 0.12), wood, bevel=0.0)
        if rail == "lattice":
            for i in range(12):
                x = x0 + 0.05 + (x1 - x0 - 0.1) * (i + 0.5) / 12
                b.box((x - 0.012, y0 + 0.012, 0.12), (x + 0.012, y0 + 0.032, top - 0.05), wood, bevel=0.0, noise=0.0)
            b.box((x0 + 0.05, y0 + 0.008, 0.45), (x1 - 0.05, y0 + 0.036, 0.49), wood, bevel=0.0)
        else:
            for i in range(5):
                x = x0 + 0.05 + (x1 - x0 - 0.1) * (i + 0.5) / 5
                b.box((x - 0.022, y0 + 0.01, 0.12), (x + 0.022, y0 + 0.05, top - 0.05), wood, bevel=0.0)
            # A potted pine on the boards.
            pot = ctx.paint("stone", 2, tile="plain")
            b.cylinder((0.7, 0.75, 0.02), 0.09, 0.1, pot, sides=8, radius_top=0.1, bevel=0.0)
            b.solid(solids.tube([(0.7, 0.75, 0.12), (0.66, 0.74, 0.25), (0.74, 0.76, 0.35)], [0.02, 0.016, 0.012], sides=4), ctx.paint("bark", 0, tile="bark"), bevel=0.0)
            b.blob((0.74, 0.76, 0.38), 0.09, ctx.paint("pine", 0, tile="leaves"), scale=(1.3, 1.0, 0.5), subdivisions=1, wobble=0.1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Awning(JapModule):
    """A small pent roof (hisashi) over a door or shopfront: grey kawara tiles or a copper sheet
    on wooden brackets, or a reed blind (sudare) hung out on two poles."""

    id = "awning"
    TOP = EuropeAwning.TOP

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("kawara", "copper", "sudare"), variant), "tiles": pick(rng, (5, 0, 0), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        top, front_y, front_z = self.TOP, 0.36, 2.0
        x0, x1 = 0.0, 1.0
        dark = ctx.paint("trims", 0, tile="timber")
        kind = params["kind"]
        b.box((0.02, BACK - 0.06, top - 0.08), (0.98, BACK, top + 0.02), dark, bevel=0.0, seams=("y+",))
        if kind == "sudare":
            cane = ctx.paint("bamboo", 2, tile="bamboo")
            blind = [(BACK - 0.02, top - 0.02), (front_y, front_z - 0.25), (front_y, front_z - 0.27), (BACK - 0.02, top - 0.04)]
            b.solid(solids.prism(blind, "x", 0.05, 0.95, slices=1), cane, bevel=0.0)
            rope = ctx.paint("rope", 0, tile="plain")
            for x in (0.25, 0.75):
                prof = [(BACK - 0.02, top - 0.015), (front_y, front_z - 0.245), (front_y, front_z - 0.235), (BACK - 0.02, top - 0.005)]
                b.solid(solids.prism(prof, "x", x - 0.01, x + 0.01), rope, bevel=0.0)
            for x in (0.06, 0.94):
                prof = solids.beam_profile((BACK - 0.03, top - 0.45), (front_y + 0.02, front_z - 0.26), 0.025)
                b.solid(solids.prism(prof, "x", x - 0.015, x + 0.015), cane, bevel=0.0)
            return [b.to_object(ctx.collection)]
        paint = ctx.paint("roofs", 0, tile="kawara") if kind == "kawara" else ctx.paint("roofs", 3, tile="plain")
        slab = [(BACK, top + 0.02), (front_y - 0.02, front_z), (front_y - 0.02, front_z - 0.05), (BACK, top - 0.03)]
        b.solid(solids.prism(slab, "x", x0, x1, slices=2), paint, bevel=0.0)
        n = params["tiles"]
        for i in range(n):
            x = x0 + (x1 - x0) * (i + 0.5) / n
            b.solid(solids.tube([(x, BACK - 0.02, top + 0.035), (x, front_y, front_z + 0.015)], [0.035, 0.035], sides=4), paint, bevel=0.0)
        if n:
            b.box((x0, front_y - 0.05, front_z - 0.05), (x1, front_y + 0.02, front_z + 0.04), ctx.paint("roofs", 0, tile="plain"), bevel=0.0)
        else:
            b.box((x0, front_y - 0.04, front_z - 0.07), (x1, front_y - 0.01, front_z - 0.02), paint, bevel=0.0)
        for x in (0.1, 0.9):
            prof = solids.beam_profile((BACK - 0.02, front_z - 0.4), (front_y + 0.05, front_z - 0.06), 0.04)
            b.solid(solids.prism(prof, "x", x - 0.025, x + 0.025), dark, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Flowerbox(JapModule):
    """A wooden shelf under a window: two bonsai in glazed pots, morning glories climbing
    bamboo canes, or an ikebana vase with a single branch."""

    id = "flowerbox"

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("bonsai", "asagao", "ikebana"), variant), "sizes": [round(rng.uniform(0.85, 1.1), 3) for _ in range(3)]}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        x0, x1 = WINDOW[0] - 0.06, WINDOW[1] + 0.06
        z_shelf = WINDOW[2] - 0.24
        y0 = 0.74
        wood = ctx.paint("trims", 1, tile="timber")
        dark = ctx.paint("trims", 0, tile="timber")
        b.box((x0, y0, z_shelf - 0.04), (x1, BACK, z_shelf), wood, bevel=0.0, seams=("y+",))
        for cx in (x0 + 0.05, x1 - 0.05):
            prof = [(BACK, z_shelf - 0.04), (y0 + 0.03, z_shelf - 0.04), (BACK, z_shelf - 0.2)]
            b.solid(solids.prism(prof, "x", cx - 0.015, cx + 0.015), dark, bevel=0.0)
        kind = params["kind"]
        cy = (y0 + BACK) / 2
        if kind == "bonsai":
            for i, cx in enumerate((x0 + 0.18, x1 - 0.18)):
                s = params["sizes"][i]
                pot = ctx.paint("accents", 0 if i == 0 else 2, tile="plain")
                b.box((cx - 0.09, cy - 0.05, z_shelf), (cx + 0.09, cy + 0.05, z_shelf + 0.05), pot, bevel=0.0)
                trunk = [(cx, cy, z_shelf + 0.05), (cx - 0.04 * s, cy, z_shelf + 0.12), (cx + 0.03, cy, z_shelf + 0.2 * s)]
                b.solid(solids.tube(trunk, [0.018, 0.014, 0.01], sides=4), ctx.paint("bark", 0, tile="bark"), bevel=0.0)
                for dx, dz, r in ((-0.06, 0.15, 0.06), (0.05, 0.22, 0.07), (0.0, 0.27, 0.05)):
                    b.blob((cx + dx, cy, z_shelf + dz * s), r, ctx.paint("pine", i, tile="leaves"), scale=(1.4, 1.0, 0.55), subdivisions=1, wobble=0.1)
        elif kind == "asagao":
            cane = ctx.paint("bamboo", 3, tile="bamboo")
            for i in range(3):
                cx = x0 + 0.12 + i * 0.2
                b.cylinder((cx, cy, z_shelf), 0.05, 0.09, ctx.paint("stone", 2, tile="plain"), sides=8, radius_top=0.06, bevel=0.0)
                b.cylinder((cx, cy, z_shelf + 0.09), 0.008, 0.45, cane, sides=4, bevel=0.0)
                for k in range(3):
                    b.blob((cx + 0.03 * (k - 1), cy - 0.02, z_shelf + 0.15 + k * 0.12), 0.04, ctx.paint("foliage", k % 2, tile="plain"), subdivisions=1, wobble=0.15)
                b.blob((cx + 0.03, cy - 0.04, z_shelf + 0.32), 0.035, ctx.paint("flowers", i % 2 * 3, tile="plain"), scale=(1.0, 0.6, 1.0), subdivisions=1, wobble=0.05)
        else:
            cx = (x0 + x1) / 2
            b.cylinder((cx, cy, z_shelf), 0.06, 0.18, ctx.paint("accents", 0, tile="plain"), sides=8, radius_top=0.035, bevel=0.0)
            branch = [(cx, cy, z_shelf + 0.18), (cx - 0.06, cy, z_shelf + 0.32), (cx - 0.2, cy, z_shelf + 0.4)]
            b.solid(solids.tube(branch, [0.012, 0.01, 0.006], sides=4), ctx.paint("bark", 1, tile="bark"), bevel=0.0)
            for k, (dx, dz) in enumerate(((-0.06, 0.32), (-0.13, 0.37), (-0.2, 0.4), (0.03, 0.24))):
                b.blob((cx + dx, cy - 0.01, z_shelf + dz), 0.035, ctx.paint("accents", 4, tile="plain"), subdivisions=1, wobble=0.1)
            b.box((x1 - 0.22, cy - 0.04, z_shelf), (x1 - 0.06, cy + 0.04, z_shelf + 0.04), ctx.paint("stone", 1, tile="plain"), bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class Shutters(JapModule):
    """Beside or over a wall.window opening: a pair of vertical lattice screens, a bamboo blind
    (sudare) half rolled down, or two storm-board panels (amado) with battens."""

    id = "shutters"

    def variant_params(self, style, variant, rng):
        return {"style": pick(rng, ("lattice", "sudare", "amado"), variant), "wood": pick(rng, (0, 2, 1), variant)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        z0, z1 = WINDOW[2] - 0.02, WINDOW[3] + 0.02
        y0, y1 = 0.935, 0.965
        style = params["style"]
        wood = ctx.paint("trims", params["wood"], tile="timber")
        dark = ctx.paint("trims", 0, tile="timber")
        if style == "sudare":
            cane = ctx.paint("bamboo", 2, tile="bamboo")
            x0, x1 = WINDOW[0] - 0.04, WINDOW[1] + 0.04
            low = z0 + (z1 - z0) * 0.45
            b.box((x0 - 0.02, y0 - 0.015, z1 - 0.03), (x1 + 0.02, BACK, z1 + 0.02), dark, bevel=0.0)
            for k in range(6):
                za = low + (z1 - 0.03 - low) * k / 6
                zb = low + (z1 - 0.03 - low) * (k + 1) / 6 - 0.006
                b.box((x0, y0, za), (x1, y1, zb), cane, bevel=0.0, noise=0.0)
            b.cylinder((x0 + 0.01, y0 - 0.02, low - 0.03), 0.03, 0.035, cane, sides=6, bevel=0.0)
            rope = ctx.paint("rope", 1, tile="plain")
            for x in (x0 + 0.12, x1 - 0.12):
                b.box((x - 0.008, y0 - 0.012, low - 0.02), (x + 0.008, y0, z1), rope, bevel=0.0, noise=0.0)
            return [b.to_object(ctx.collection)]
        f = 0.03
        for xa, xb in ((0.02, 0.2), (0.8, 0.98)):
            b.box((xa, y0, z0), (xa + f, y1, z1), dark, bevel=0.0)
            b.box((xb - f, y0, z0), (xb, y1, z1), dark, bevel=0.0)
            b.box((xa, y0, z0), (xb, y1, z0 + f), dark, bevel=0.0)
            b.box((xa, y0, z1 - f), (xb, y1, z1), dark, bevel=0.0)
            if style == "lattice":
                b.box((xa + f, y0 + 0.02, z0 + f), (xb - f, y1, z1 - f), ctx.paint("glass", 0, tile="plain", material="glass"), bevel=0.0, noise=0.0)
                for i in range(4):
                    x = xa + f + (xb - xa - 2 * f) * (i + 0.5) / 4
                    b.box((x - 0.01, y0 + 0.004, z0 + f), (x + 0.01, y0 + 0.02, z1 - f), wood, bevel=0.0, noise=0.0)
            else:
                b.box((xa + f, y0 + 0.008, z0 + f), (xb - f, y1, z1 - f), wood, bevel=0.0)
                for z in (z0 + 0.3, (z0 + z1) / 2, z1 - 0.3):
                    b.box((xa + f, y0 - 0.006, z - 0.02), (xb - f, y0 + 0.008, z + 0.02), dark, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class SignHanging(EuropeSignHanging, JapModule):
    """A bracket with a hanging wooden board (the European bracket and board shapes, with hinoki,
    dark lacquer and vermilion boards). The client draws the shop icon at the ``icon`` sockets."""

    id = "sign.hanging"
    styles = JapModule.styles

    def variant_params(self, style, variant, rng):
        return {
            "shape": pick(rng, ("rect", "round", "rect"), variant),
            "board": pick(rng, (("trims", 2), ("lacquer", 0), ("trims", 0)), variant),
        }


__all__ = ["Awning", "Balcony", "Flowerbox", "Shutters", "SignHanging"]
