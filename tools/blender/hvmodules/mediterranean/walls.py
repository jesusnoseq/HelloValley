"""Mediterranean walls and corners: wall.plain, wall.window, wall.door, wall.shopfront,
wall.timber (exposed stone and beam ends), corner.outer, corner.inner (GDD §7.3, art.md §2.2).

Same footprints, sockets and openings as the European walls (``mirror``)."""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.grid import STOREY_M
from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.walls import CornerOuter as EuropeCornerOuter

from .common import (
    CORNICE_Z,
    DOOR,
    FASCIA_Z,
    SHOPFRONT,
    WINDOW,
    ZOCALO_Z,
    MedModule,
    MedWallKit,
    mirror,
    pick,
    wall_params,
)

H = STOREY_M

WINDOW_ARCH = (WINDOW[0], WINDOW[1], WINDOW[3] - (WINDOW[1] - WINDOW[0]) / 2, (WINDOW[1] - WINDOW[0]) / 2)
"""A round arch inside the wall.window opening."""
DOOR_ARCH = (DOOR[0], DOOR[1], DOOR[3] - (DOOR[1] - DOOR[0]) / 2, (DOOR[1] - DOOR[0]) / 2)
"""The round-arched doorway inside the wall.door opening."""
SHOP_ARCH = (SHOPFRONT[0], SHOPFRONT[1], SHOPFRONT[3] - 0.32, 0.32)
"""A flattened arch over the display window, inside the wall.shopfront opening."""


class MedWall(MedModule):
    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return wall_params(style, variant, rng)

    def kit(self, ctx, variant: int, params, rng) -> MedWallKit:
        return MedWallKit(ctx, ctx.builder(self, variant, rng), params)


@register
@mirror
class WallPlain(MedWall):
    id = "wall.plain"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["detail"] = pick(rng, ("azulejo", "vine", "spout"), variant)
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        k.zocalo()
        k.cornice()
        detail = params["detail"]
        if detail == "azulejo":
            # A small painted-tile plaque (a street saint or a house name) in a white frame.
            frame = ctx.paint("trims", 0, tile="stucco")
            b.box((0.34, -0.03, 1.55), (0.66, 0.02, 1.95), frame, bevel=0.012, segments=1)
            for i, (xa, za) in enumerate(((0.37, 1.58), (0.5, 1.58), (0.37, 1.75), (0.5, 1.75))):
                tile = ctx.paint("ceramic", 1 if i in (0, 3) else 0, tile="plain")
                b.box((xa, -0.04, za), (xa + 0.13, -0.03, za + 0.17), tile, bevel=0.0, noise=0.0)
        elif detail == "vine":
            # A grapevine: a twisting stem up the wall and a leafy run under the cornice.
            bark = ctx.paint("bark", 0, tile="plain")
            x = 0.3 + rng.uniform(0.0, 0.2)
            stem = [(x, -0.04, ZOCALO_Z), (x + 0.08, -0.05, 1.3), (x - 0.04, -0.05, 2.0), (x + 0.04, -0.06, 2.45)]
            b.solid(solids.tube(stem, [0.03, 0.025, 0.022, 0.02], sides=5), bark, bevel=0.0, smooth=True)
            leaf = ctx.paint("foliage", 1, tile="plain")
            for i in range(4):
                b.blob((0.15 + i * 0.23 + rng.jitter(0.04), -0.035, 2.5 + rng.jitter(0.05)), 0.12, leaf, scale=(1.0, 0.3, 0.8), wobble=0.12)
            grape = ctx.paint("grapes", 0, tile="plain")
            b.blob((x + 0.18, -0.05, 2.32), 0.05, grape, scale=(0.8, 0.6, 1.2), wobble=0.1)
        else:
            # A terracotta rain spout under the cornice and an iron tie plate.
            clay = ctx.paint("roofs", 1, tile="roof_clay")
            b.solid(solids.tube([(0.62, 0.02, 2.71), (0.62, -0.075, 2.71)], [0.04, 0.04], sides=6), clay, bevel=0.0)
            iron = ctx.paint("iron", 0, tile="plain")
            b.cylinder((0.25, 0.0, 1.9), 0.05, 0.02, iron, sides=6, bevel=0.0)
            b.box((0.24, -0.025, 1.84), (0.26, 0.0, 1.98), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallWindow(MedWall):
    id = "wall.window"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["shape"] = pick(rng, ("rect", "arch", "rect"), variant)
        p["surround"] = pick(rng, (("trims", 0, "stucco"), ("trims", 2, "stone"), ("accents", 0, "stucco")), variant)
        p["frame"] = pick(rng, (("trims", 1), ("trims", 0), ("accents", 1)), variant)
        p["pattern"] = pick(rng, ("t", "cross", "cross"), variant)
        p["grille"] = variant == 0
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        arch = params["shape"] == "arch"
        k.panel([WINDOW], [WINDOW_ARCH] if arch else [])
        k.zocalo()
        k.cornice()
        surround = ctx.paint(*params["surround"][:2], tile=params["surround"][2])
        frame = ctx.paint(*params["frame"], tile="wood")
        x0, x1, z0, z1 = WINDOW
        if arch:
            k.arch_surround(WINDOW_ARCH, z0, surround)
            k.arched_glass(WINDOW_ARCH, z0, frame)
        else:
            k.frame(WINDOW, surround, width=0.07, head=0.08)
            k.glazing(WINDOW, params["pattern"], frame)
        if params["grille"]:
            # A wrought-iron reja in front of the window.
            iron = ctx.paint("iron", 0, tile="plain")
            y0, y1 = -0.06, -0.04
            for i in range(1, 5):
                x = x0 + (x1 - x0) * i / 5
                b.box((x - 0.01, y0, z0 - 0.02), (x + 0.01, y1, z1 + 0.02), iron, bevel=0.0)
            for z in (z0 + 0.05, (z0 + z1) / 2, z1 - 0.05):
                b.box((x0 - 0.02, y0 - 0.005, z - 0.012), (x1 + 0.02, y1 + 0.005, z + 0.012), iron, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallDoor(MedWall):
    """Round-arched doorway with a planked or panelled leaf; one variant has an iron fanlight
    in the arch."""

    id = "wall.door"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["leaf"] = pick(rng, (("accents", 0), ("trims", 1), ("accents", 1)), variant)
        p["style"] = pick(rng, ("planks", "panels", "planks"), variant)
        p["fanlight"] = variant == 1
        p["surround"] = pick(rng, (("trims", 2, "stone"), ("trims", 0, "stucco"), ("trims", 0, "stucco")), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, _, z1 = DOOR
        spring, rise = DOOR_ARCH[2], DOOR_ARCH[3]
        k.panel([DOOR], [DOOR_ARCH])
        k.zocalo(skip=(x0 - 0.08, x1 + 0.08))
        k.cornice()
        surround = ctx.paint(*params["surround"][:2], tile=params["surround"][2])
        k.arch_surround(DOOR_ARCH, 0.0, surround, width=0.08, sill=False)
        step = ctx.paint("ground", 1, tile="paving")
        b.box((x0 - 0.1, -0.09, 0.0), (x1 + 0.1, 0.12, 0.07), step, bevel=0.02, segments=1, seams=("z-",))
        leaf = ctx.paint(*params["leaf"], tile="wood")
        y0, y1 = 0.1, 0.15
        if params["fanlight"]:
            # Leaf up to the springing line; a glazed half-moon with iron rays above it.
            b.box((x0, y0, 0.07), (x1, y1, spring), leaf, bevel=0.0)
            glass = ctx.paint("glass", 1, tile="plain", material="glass")
            # A plain pane: the spandrels in front of it give it its half-moon outline.
            b.box((x0, y0 + 0.01, spring), (x1, y0 + 0.03, spring + rise), glass, bevel=0.0, noise=0.0)
            iron = ctx.paint("iron", 0, tile="plain")
            cx = (x0 + x1) / 2
            for p1 in ((x0 + 0.05, spring + 0.12), (cx, z1 - 0.02), (x1 - 0.05, spring + 0.12)):
                b.solid(solids.prism(solids.beam_profile((cx, spring), p1, 0.02), "y", y0 - 0.01, y0 + 0.01), iron, bevel=0.0)
        else:
            b.solid(solids.prism(solids.arched_profile(x0, x1, 0.07, spring, rise, 8), "y", y0, y1), leaf, bevel=0.0)
        top = spring - 0.05
        if params["fanlight"]:
            for z in (0.4, top - 0.1):
                b.box((x0 + 0.03, y0 - 0.02, z), (x1 - 0.03, y0, z + 0.08), leaf, bevel=0.0)
        elif params["style"] == "planks":
            for i in range(1, 4):
                x = x0 + (x1 - x0) * i / 4
                b.box((x - 0.006, y0 - 0.008, 0.1), (x + 0.006, y0, top), leaf, bevel=0.0)
            for z in (0.4, 1.5):
                b.box((x0 + 0.03, y0 - 0.02, z), (x1 - 0.03, y0, z + 0.08), leaf, bevel=0.0)
        else:
            mid = (x0 + x1) / 2
            for za, zb in ((0.25, 0.95), (1.1, top - 0.05)):
                for xa, xb in ((x0 + 0.06, mid - 0.03), (mid + 0.03, x1 - 0.06)):
                    b.box((xa, y0 - 0.02, za), (xb, y0, zb), leaf, bevel=0.0)
        if not params["fanlight"]:
            brass = ctx.paint("ceramic", 3, tile="plain")
            b.cylinder((x1 - 0.1, y0 - 0.03, 1.0), 0.03, 0.03, brass, sides=6, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallShopfront(MedWall):
    id = "wall.shopfront"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["shape"] = pick(rng, ("arch", "rect", "arch"), variant)
        p["paint"] = pick(rng, (("accents", 0), ("trims", 1), ("accents", 1)), variant)
        p["fascia"] = pick(rng, ("painted", "tiles", "painted"), variant)
        p["goods"] = pick(rng, ("lemons", "jars", "none"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, z0, z1 = SHOPFRONT
        arch = params["shape"] == "arch"
        k.panel([SHOPFRONT], [SHOP_ARCH] if arch else [])
        k.cornice()
        wood = ctx.paint(*params["paint"], tile="wood")
        b.box((0.0, -0.04, 0.0), (x0, 0.02, FASCIA_Z[0]), wood, bevel=0.012, segments=1, seams=("x-", "z-"))
        b.box((x1, -0.04, 0.0), (1.0, 0.02, FASCIA_Z[0]), wood, bevel=0.012, segments=1, seams=("x+", "z-"))
        b.box((x0, -0.03, 0.0), (x1, 0.02, z0), wood, bevel=0.012, segments=1, seams=("z-",))
        sill = ctx.paint("trims", 2, tile="stone")
        b.box((x0 - 0.02, -0.07, z0 - 0.04), (x1 + 0.02, 0.05, z0), sill, bevel=0.012, segments=1)
        if params["fascia"] == "tiles":
            frame = ctx.paint("trims", 0, tile="stucco")
            b.box((0.0, -0.05, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), frame, bevel=0.015, segments=1, seams=("x",))
            for i in range(4):
                tile = ctx.paint("ceramic", 1 if i % 2 == 0 else 2, tile="plain")
                xa = 0.06 + i * 0.225
                b.box((xa, -0.06, FASCIA_Z[0] + 0.05), (xa + 0.2, -0.05, FASCIA_Z[1] - 0.05), tile, bevel=0.0, noise=0.0)
        else:
            b.box((0.0, -0.06, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), wood, bevel=0.015, segments=1, seams=("x",))
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        y = 0.08
        if arch:
            spring, rise = SHOP_ARCH[2], SHOP_ARCH[3]
            # A plain pane behind the spandrels (they give it its arched outline).
            b.box((x0, y, z0), (x1, y + 0.02, z1), glass, bevel=0.0, noise=0.0)
            b.solid(solids.prism(solids.arch_ring(x0, x1, spring, rise, 0.04, 6), "y", -0.03, 0.04), wood, bevel=0.0)
            b.box((x0, y - 0.03, spring - 0.02), (x1, y, spring + 0.02), wood, bevel=0.0)
            cx = (x0 + x1) / 2
            b.box((cx - 0.018, y - 0.03, z0), (cx + 0.018, y, spring + rise - 0.01), wood, bevel=0.0)
        else:
            b.box((x0, y, z0), (x1, y + 0.02, z1), glass, bevel=0.0, noise=0.0)
            transom = z1 - 0.32
            b.box((x0, y - 0.03, transom - 0.02), (x1, y, transom + 0.02), wood, bevel=0.0)
            cx = (x0 + x1) / 2
            b.box((cx - 0.018, y - 0.03, z0), (cx + 0.018, y, z1), wood, bevel=0.0)
        goods = params["goods"]
        if goods != "none":
            shelf = ctx.paint("trims", 1, tile="wood")
            b.box((x0 + 0.02, y + 0.03, z0 + 0.25), (x1 - 0.02, y + 0.2, z0 + 0.29), shelf, bevel=0.0)
            for i in range(3):
                cx = x0 + 0.14 + i * 0.26 + rng.jitter(0.02)
                if goods == "lemons":
                    b.blob((cx, y + 0.12, z0 + 0.34), 0.06, ctx.paint("citrus", i % 2, tile="plain"), scale=(1.2, 1.0, 1.0), subdivisions=1, wobble=0.04)
                else:
                    jar = ctx.paint("pot", i % 3, tile="plain")
                    b.cylinder((cx, y + 0.12, z0 + 0.29), 0.06, 0.16, jar, sides=6, radius_top=0.035, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallTimber(MedWall):
    """The rustic wall of the kit (the semantic slot of the European half-timbered storey):
    stucco worn away to show the stone masonry underneath, or a whitewashed wall with
    timber beam ends (vigas) and a lintel beam."""

    id = "wall.timber"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["pattern"] = pick(rng, ("rubble", "vigas", "ashlar"), variant)
        p["stones"] = [
            [round(rng.uniform(0.0, 0.8), 3), round(rng.uniform(0.55, 2.4), 3), round(rng.uniform(0.12, 0.22), 3)] for _ in range(7)
        ]
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        pattern = params["pattern"]
        stone = ctx.paint("trims", 2, tile="stone")
        if pattern == "rubble":
            k.zocalo()
            k.cornice()
            for x, z, w in params["stones"]:
                h = w * 0.6
                b.box((x, -0.02, z), (min(1.0, x + w), 0.02, z + h), stone, bevel=0.0, seams=("x",))
        elif pattern == "vigas":
            k.zocalo()
            wood = ctx.paint("trims", 1, tile="timber")
            b.box((0.0, -0.04, 2.35), (1.0, 0.03, 2.5), wood, bevel=0.012, segments=1, seams=("x",))
            for cx in (0.25, 0.75):
                b.box((cx - 0.06, -0.09, 2.62), (cx + 0.06, 0.02, 2.76), wood, bevel=0.012, segments=1)
            k.cornice()
        else:
            # Ashlar: whole courses of sandstone blocks, half-bond.
            courses = 5
            hgt = (H - 0.0) / courses
            for c in range(courses):
                z0 = c * hgt
                offs = (0.0, 0.5) if c % 2 == 0 else (0.0, 0.25, 0.75)
                edges = sorted(set(offs + (1.0,)))
                for a, e in zip(edges, edges[1:]):
                    seams = tuple(s for s, on in (("x-", a == 0.0), ("x+", e == 1.0), ("z-", c == 0), ("z+", c == courses - 1)) if on)
                    b.box((a + 0.008, -0.03, z0 + 0.008), (e - 0.008, 0.02, z0 + hgt - 0.008), stone, bevel=0.0, seams=seams)
        return [b.to_object(ctx.collection)]


# --- corners -----------------------------------------------------------------------------


@register
@mirror
class CornerOuter(MedModule):
    """Convex corner: an L of stucco over the cell's front and left edges, with quoins, a
    painted pilaster or a plain rounded arris."""

    id = "corner.outer"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["corner"] = pick(rng, ("plain", "quoins", "pilaster"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = MedWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        l_profile = EuropeCornerOuter.l_profile
        seams = ("x+", "y+", "z")
        b.solid(solids.prism(l_profile(t), "z", 0.0, H, slices=5), k.plaster(), bevel=0.05, segments=2, seams=seams)
        kind = params["zocalo"]
        if kind == "blue":
            base = ctx.paint("accents", 0, tile="stucco")
        elif kind == "stone":
            base = ctx.paint("ground", 1, tile="paving")
        else:
            base = ctx.paint("roofs", 2, tile="stucco")
        b.solid(solids.prism(l_profile(t, 0.02), "z", 0.0, ZOCALO_Z), base, bevel=0.015, segments=1, seams=("x+", "y+", "z-"))
        trim = ctx.paint("trims", 2 if params["cornice"] == "moulding" else 0, tile="stucco")
        b.solid(solids.prism(l_profile(t, 0.03), "z", CORNICE_Z, H), trim, bevel=0.02, segments=1, seams=seams)
        corner = params["corner"]
        if corner == "quoins":
            block = ctx.paint("trims", 2, tile="stone")
            for i in range(4):
                z = ZOCALO_Z + 0.1 + i * 0.56
                if i % 2 == 0:
                    lo, hi = (-0.02, -0.02, z), (0.3, 0.12, z + 0.4)
                else:
                    lo, hi = (-0.02, -0.02, z), (0.12, 0.3, z + 0.4)
                b.box(lo, hi, block, bevel=0.02, segments=1)
        elif corner == "pilaster":
            pil = ctx.paint("walls", 1 if params["swatch"] != 1 else 0, tile="stucco")
            b.solid(solids.prism([(-0.02, -0.02), (0.18, -0.02), (0.18, 0.0), (0.0, 0.0), (0.0, 0.18), (-0.02, 0.18)], "z", ZOCALO_Z, CORNICE_Z, slices=3), pil, bevel=0.008, segments=1)
        return [b.to_object(ctx.collection)]


@register
@mirror
class CornerInner(MedModule):
    """Concave corner filler (pivot in the diagonal cell, like the European one) dressed with a
    terracotta drainpipe, sandstone quoins or a bougainvillea climbing the angle."""

    id = "corner.inner"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["dress"] = pick(rng, ("pipe", "quoins", "bougainvillea"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = MedWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        b.solid(solids.prism([(0.0, 0.0), (t, 0.0), (t, t), (0.0, t)], "z", 0.0, H, slices=6), k.plaster(), bevel=0.0)
        dress = params["dress"]
        if dress == "pipe":
            clay = ctx.paint("roofs", 1, tile="roof_clay")
            cx = cy = -0.05
            for i in range(6):
                z = 0.1 + i * 0.47
                b.cylinder((cx, cy, z), 0.034, 0.45, clay, sides=8, radius_top=0.03, bevel=0.0)
            b.cylinder((cx, cy, 0.0), 0.045, 0.1, clay, sides=8, radius_top=0.034, bevel=0.0)
        elif dress == "quoins":
            block = ctx.paint("trims", 2, tile="stone")
            for i in range(6):
                z = 0.05 + i * 0.49
                b.box((-0.06, -0.06, z), (0.02, 0.02, z + 0.42), block, bevel=0.015, segments=1)
        else:
            bark = ctx.paint("bark", 0, tile="plain")
            b.solid(solids.tube([(-0.03, -0.03, 0.0), (-0.04, -0.03, 1.0), (-0.03, -0.04, 2.0), (-0.035, -0.035, 2.6)], [0.025, 0.02, 0.02, 0.015], sides=5), bark, bevel=0.0, smooth=True)
            for i in range(7):
                z = 0.9 + i * 0.28 + rng.jitter(0.05)
                group, idx = ("blossom", i % 3) if i % 3 else ("foliage", 1)
                b.blob((-0.02, -0.02, z), 0.075, ctx.paint(group, idx, tile="plain"), scale=(1.0, 1.0, 1.3), subdivisions=1, wobble=0.08)
        return [b.to_object(ctx.collection)]
