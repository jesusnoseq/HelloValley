"""Europe walls and corners: wall.plain, wall.window, wall.door, wall.shopfront, wall.timber,
corner.outer, corner.inner (GDD §7.2-7.3, art.md §2.1)."""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.grid import STOREY_M, Footprint
from hvkit.module import Module, Socket, register
from hvkit.variants import VariantRng

from .common import (
    CORNICE_Z,
    DOOR,
    FASCIA_Z,
    PLINTH_Z,
    SHOPFRONT,
    STYLES,
    WALL_BUDGET,
    WALL_OVERHANG_M,
    WALL_T,
    WINDOW,
    WallKit,
    pick,
    wall_params,
)

H = STOREY_M
MID = H / 2


def wall_sockets(*extra: Socket) -> tuple:
    """Sockets every wall has: the next storey or roof on top, neighbours on both sides and
    the facade anchor that attachments' ``mount`` sockets mate with."""
    return (
        Socket("top", "stack", (0.5, WALL_T / 2, H), (0.0, 0.0, 1.0)),
        Socket("left", "edge", (0.0, WALL_T / 2, MID), (-1.0, 0.0, 0.0)),
        Socket("right", "edge", (1.0, WALL_T / 2, MID), (1.0, 0.0, 0.0)),
        Socket("facade", "attach", (0.5, 0.0, 0.0), (0.0, -1.0, 0.0)),
    ) + extra


class EuropeWall(Module):
    footprint = Footprint(w=1, d=1, h=H)
    variants = 3
    styles = STYLES
    tri_budget = WALL_BUDGET
    max_overhang_m = WALL_OVERHANG_M
    sockets = wall_sockets()

    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return wall_params(style, variant, rng)

    def kit(self, ctx, variant: int, params, rng) -> WallKit:
        return WallKit(ctx, ctx.builder(self, variant, rng), params)


@register
class WallPlain(EuropeWall):
    id = "wall.plain"
    tags = ("wall", "europe")

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["detail"] = pick(rng, ("patch", "ivy", "vent"), variant)
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        k.plinth()
        k.cornice()
        detail = params["detail"]
        if detail == "patch":
            # Exposed bricks where the plaster has flaked off: a cosy, lived-in touch.
            brick = ctx.paint("roofs", 1, tile="brick")
            x = 0.62 + rng.jitter(0.08)
            z = 1.7 + rng.jitter(0.2)
            for dx, dz in ((0.0, 0.0), (0.13, 0.0), (0.06, 0.08)):
                b.box((x + dx, -0.012, z + dz), (x + dx + 0.12, 0.02, z + dz + 0.065), brick, bevel=0.008, segments=1)
        elif detail == "ivy":
            leaf = ctx.paint("foliage", 1, tile="plain")
            x = 0.2 + rng.uniform(0.0, 0.5)
            for i in range(4):
                b.blob((x + rng.jitter(0.12), -0.03, 0.45 + i * 0.32), 0.13 - i * 0.015, leaf, scale=(1.2, 0.35, 1.0), wobble=0.15)
        else:
            # A small cast-iron air vent above the plinth and a house number plate.
            iron = ctx.paint("iron", 0, tile="plain")
            b.box((0.42, -0.015, 0.5), (0.58, 0.02, 0.62), iron, bevel=0.01, segments=1)
            plate = ctx.paint("trims", 1, tile="plain")
            b.box((0.78, -0.012, 1.9), (0.9, 0.02, 2.02), plate, bevel=0.01, segments=1)
        return [b.to_object(ctx.collection)]


@register
class WallWindow(EuropeWall):
    id = "wall.window"
    tags = ("wall", "window", "europe")
    sockets = wall_sockets(
        Socket("sill", "attach", (0.5, 0.0, WINDOW[2]), (0.0, -1.0, 0.0)),
        Socket("window", "attach", (0.5, 0.0, (WINDOW[2] + WINDOW[3]) / 2), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["frame"] = pick(rng, (("trims", 1), ("trims", 0), ("accents", 1)), variant)
        p["pattern"] = pick(rng, ("cross", "grid", "t"), variant)
        p["head"] = pick(rng, ("keystone", "brick", "plain"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel([WINDOW])
        k.plinth()
        k.cornice()
        frame = ctx.paint(*params["frame"], tile="wood")
        k.frame(WINDOW, frame)
        k.glazing(WINDOW, params["pattern"], frame)
        x0, x1, _, z1 = WINDOW
        if params["head"] == "keystone":
            stone = ctx.paint("trims", 1, tile="stone")
            cx = (x0 + x1) / 2
            b.box((cx - 0.06, -0.05, z1 + 0.04), (cx + 0.06, 0.04, z1 + 0.2), stone, bevel=0.015, segments=1)
        elif params["head"] == "brick":
            brick = ctx.paint("roofs", 0, tile="brick")
            b.box((x0 - 0.1, -0.035, z1 + 0.1), (x1 + 0.1, 0.03, z1 + 0.2), brick, bevel=0.015, segments=1)
        return [b.to_object(ctx.collection)]


@register
class WallDoor(EuropeWall):
    id = "wall.door"
    tags = ("wall", "door", "europe")
    sockets = wall_sockets(
        Socket("door", "prop", (0.5, 0.0, 0.0), (0.0, -1.0, 0.0)),
        Socket("lintel", "attach", (0.5, 0.0, DOOR[3] + 0.12), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["leaf"] = pick(rng, (("trims", 0), ("accents", 1), ("accents", 0)), variant)
        p["style"] = pick(rng, ("planks", "panels", "panels"), variant)
        p["fanlight"] = variant != 0
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, _, z1 = DOOR
        k.panel([DOOR])
        k.plinth(skip=(x0 - 0.06, x1 + 0.06))
        k.cornice()
        trim = ctx.paint("trims", 1, tile="wood")
        k.frame(DOOR, trim, width=0.07, sill=False, head=0.12)
        step = ctx.paint("ground", 1, tile="stone")
        b.box((x0 - 0.1, -0.09, 0.0), (x1 + 0.1, WALL_T * 0.6, 0.07), step, bevel=0.02, segments=1, seams=("z-",))
        leaf = ctx.paint(*params["leaf"], tile="wood")
        y0, y1 = 0.1, 0.15
        top = z1
        if params["fanlight"]:
            top = z1 - 0.32
            b.box((x0, y0 - 0.01, top), (x1, y1, top + 0.05), trim, bevel=0.0)
            glass = ctx.paint("glass", 1, tile="plain", material="glass")
            b.box((x0, y0 + 0.01, top + 0.05), (x1, y0 + 0.03, z1), glass, bevel=0.0, noise=0.0)
            b.box(((x0 + x1) / 2 - 0.015, y0 - 0.01, top + 0.05), ((x0 + x1) / 2 + 0.015, y0 + 0.01, z1), trim, bevel=0.0)
        if params["style"] == "planks":
            n = 4
            w = (x1 - x0) / n
            for i in range(n):
                b.box((x0 + i * w + 0.004, y0 + rng.jitter(0.004), 0.07), (x0 + (i + 1) * w - 0.004, y1, top), leaf, bevel=0.0)
            b.box((x0 + 0.02, y0 - 0.02, 0.45), (x1 - 0.02, y0, 0.55), leaf, bevel=0.0)
            b.box((x0 + 0.02, y0 - 0.02, top - 0.5), (x1 - 0.02, y0, top - 0.4), leaf, bevel=0.0)
        else:
            b.box((x0, y0, 0.07), (x1, y1, top), leaf, bevel=0.0)
            mid = (x0 + x1) / 2
            rows = ((0.25, 0.95), (1.1, top - 0.12))
            for za, zb in rows:
                for xa, xb in ((x0 + 0.06, mid - 0.03), (mid + 0.03, x1 - 0.06)):
                    b.box((xa, y0 - 0.02, za), (xb, y0, zb), leaf, bevel=0.0)
        brass = ctx.paint("accents", 2, tile="plain")
        b.box((x1 - 0.12, y0 - 0.05, 1.0), (x1 - 0.08, y0, 1.06), brass, bevel=0.008, segments=1)
        return [b.to_object(ctx.collection)]


@register
class WallShopfront(EuropeWall):
    id = "wall.shopfront"
    tags = ("wall", "shopfront", "europe")
    sockets = wall_sockets(
        Socket("fascia", "attach", (0.5, -0.06, (FASCIA_Z[0] + FASCIA_Z[1]) / 2), (0.0, -1.0, 0.0)),
        Socket("awning", "attach", (0.5, 0.0, FASCIA_Z[0]), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["paint"] = pick(rng, (("accents", 1), ("trims", 0), ("accents", 0)), variant)
        p["mullions"] = pick(rng, (1, 2, 0), variant)
        p["goods"] = pick(rng, ("loaves", "jars", "none"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, z0, z1 = SHOPFRONT
        k.panel([SHOPFRONT])
        k.cornice()
        wood = ctx.paint(*params["paint"], tile="wood")
        # Pilasters and the stall riser, then the fascia board that carries the shop sign.
        b.box((0.0, -0.04, 0.0), (x0, 0.02, FASCIA_Z[0]), wood, bevel=0.012, segments=1, seams=("x-", "z-"))
        b.box((x1, -0.04, 0.0), (1.0, 0.02, FASCIA_Z[0]), wood, bevel=0.012, segments=1, seams=("x+", "z-"))
        b.box((x0, -0.03, 0.0), (x1, 0.02, z0), wood, bevel=0.012, segments=1, seams=("z-",))
        sill = ctx.paint("trims", 1, tile="wood")
        b.box((x0 - 0.02, -0.07, z0 - 0.04), (x1 + 0.02, 0.05, z0), sill, bevel=0.012, segments=1)
        b.box((0.0, -0.06, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), wood, bevel=0.015, segments=1, seams=("x",))
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        y = 0.08
        b.box((x0, y, z0), (x1, y + 0.02, z1), glass, bevel=0.0, noise=0.0)
        transom = z1 - 0.32
        b.box((x0, y - 0.03, transom - 0.02), (x1, y, transom + 0.02), wood, bevel=0.0)
        n = params["mullions"]
        for i in range(1, n + 1):
            x = x0 + (x1 - x0) * i / (n + 1)
            b.box((x - 0.018, y - 0.03, z0), (x + 0.018, y, z1), wood, bevel=0.0)
        if n == 0:
            for i in range(1, 4):
                x = x0 + (x1 - x0) * i / 4
                b.box((x - 0.015, y - 0.03, transom), (x + 0.015, y, z1), wood, bevel=0.0)
        goods = params["goods"]
        if goods != "none":
            shelf = ctx.paint("trims", 2, tile="wood")
            b.box((x0 + 0.02, y + 0.03, z0 + 0.25), (x1 - 0.02, y + 0.2, z0 + 0.29), shelf, bevel=0.0)
            for i in range(3):
                cx = x0 + 0.14 + i * 0.26 + rng.jitter(0.02)
                if goods == "loaves":
                    bread = ctx.paint("accents", 2, tile="plain")
                    b.blob((cx, y + 0.12, z0 + 0.34), 0.08, bread, scale=(1.3, 0.8, 0.6), wobble=0.06)
                else:
                    jar = ctx.paint("accents", i % 2, tile="plain")
                    b.cylinder((cx, y + 0.12, z0 + 0.29), 0.05, 0.14, jar, sides=6, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class WallTimber(EuropeWall):
    """Half-timbered (Fachwerk) storey: plaster infill between dark timber posts, rails and
    braces. The posts at both ends are half width, so two neighbouring modules make one post."""

    id = "wall.timber"
    tags = ("wall", "timber", "europe")

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["swatch"] = pick(rng, (0, 1, 3), variant)
        p["timber"] = pick(rng, (0, 2, 0), variant)
        p["pattern"] = pick(rng, ("cross", "chevron", "diamond"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        k.plinth()
        wood = ctx.paint("trims", params["timber"], tile="timber")
        y0, y1 = -0.035, 0.02
        post = 0.05
        sill_z, head_z, rail_z = (PLINTH_Z - 0.02, PLINTH_Z + 0.1), (CORNICE_Z, H), (1.5, 1.6)
        kw = dict(bevel=0.012, segments=1)
        b.box((0.0, y0, sill_z[0]), (post, y1, H), wood, seams=("x-", "z+"), **kw)
        b.box((1.0 - post, y0, sill_z[0]), (1.0, y1, H), wood, seams=("x+", "z+"), **kw)
        b.box((0.0, y0, sill_z[0]), (1.0, y1, sill_z[1]), wood, seams=("x",), **kw)
        b.box((0.0, y0, head_z[0]), (1.0, y1, head_z[1]), wood, seams=("x", "z+"), **kw)
        b.box((0.0, y0, rail_z[0]), (1.0, y1, rail_z[1]), wood, seams=("x",), **kw)
        lower = ((post, sill_z[1]), (1.0 - post, rail_z[0]))
        upper = ((post, rail_z[1]), (1.0 - post, head_z[0]))
        width = 0.08

        def brace(p0, p1, rect):
            profile = solids.clip_beam_profile(p0, p1, width, rect[0], rect[1])
            if len(profile) >= 3:
                b.solid(solids.prism(profile, "y", y0 + 0.005, y1 - 0.005), wood, **kw)

        pattern = params["pattern"]
        (lx0, lz0), (lx1, lz1) = lower
        (ux0, uz0), (ux1, uz1) = upper
        if pattern == "cross":
            brace((lx0, lz0), (lx1, lz1), lower)
            brace((lx1, lz0), (lx0, lz1), lower)
        elif pattern == "chevron":
            mid = (ux0 + ux1) / 2
            brace((ux0, uz0), (mid, uz1), upper)
            brace((ux1, uz0), (mid, uz1), upper)
            brace((lx0, lz1), (lx1, lz0), lower)
        else:
            mx, mz = (ux0 + ux1) / 2, (uz0 + uz1) / 2
            b.box((mx - 0.04, y0, lz0), (mx + 0.04, y1, lz1), wood, **kw)
            for a, c in (((mx, uz0), (ux0, mz)), ((ux0, mz), (mx, uz1)), ((mx, uz1), (ux1, mz)), ((ux1, mz), (mx, uz0))):
                brace(a, c, upper)
        return [b.to_object(ctx.collection)]


# --- corners -----------------------------------------------------------------------------


@register
class CornerOuter(Module):
    """Convex building corner: an L of wall covering the cell's front and left edges. Rotate
    it by 90 degree steps for the other three corners."""

    id = "corner.outer"
    footprint = Footprint(w=1, d=1, h=H)
    variants = 3
    styles = STYLES
    tri_budget = WALL_BUDGET
    max_overhang_m = WALL_OVERHANG_M
    tags = ("corner", "wall", "europe")
    sockets = (
        Socket("top", "stack", (0.5, 0.5, H), (0.0, 0.0, 1.0)),
        Socket("right", "edge", (1.0, WALL_T / 2, MID), (1.0, 0.0, 0.0)),
        Socket("back", "edge", (WALL_T / 2, 1.0, MID), (0.0, 1.0, 0.0)),
        Socket("facade_front", "attach", (0.5, 0.0, 0.0), (0.0, -1.0, 0.0)),
        Socket("facade_left", "attach", (0.0, 0.5, 0.0), (-1.0, 0.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["corner"] = pick(rng, ("quoins", "timber", "pilaster"), variant)
        return p

    @staticmethod
    def l_profile(t: float, out: float = 0.0):
        o = -out
        return [(o, o), (0.5, o), (1.0, o), (1.0, t), (t, t), (t, 1.0), (o, 1.0), (o, 0.5)]

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = WallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        seams = ("x+", "y+", "z")
        b.solid(solids.prism(self.l_profile(t), "z", 0.0, H, slices=5), k.plaster(), bevel=0.04, segments=2, seams=seams)
        stone = ctx.paint("ground", 1, tile="stone") if params["plinth"] == "stone" else ctx.paint("roofs", 0, tile="brick")
        b.solid(solids.prism(self.l_profile(t, 0.03), "z", 0.0, PLINTH_Z), stone, bevel=0.02, segments=1, seams=("x+", "y+", "z-"))
        corner = params["corner"]
        if corner == "timber":
            wood = ctx.paint("trims", 0, tile="timber")
            b.box((-0.035, -0.035, PLINTH_Z - 0.02), (0.09, 0.09, H), wood, bevel=0.015, segments=1, seams=("z+",))
            b.solid(solids.prism(self.l_profile(t, 0.035), "z", CORNICE_Z, H), wood, bevel=0.012, segments=1, seams=seams)
            b.solid(solids.prism(self.l_profile(t, 0.035), "z", 1.5, 1.6), wood, bevel=0.012, segments=1, seams=("x+", "y+"))
            return [b.to_object(ctx.collection)]
        trim = ctx.paint("trims", 1, tile="plaster")
        b.solid(solids.prism(self.l_profile(t, 0.03), "z", CORNICE_Z, H), trim, bevel=0.02, segments=1, seams=seams)
        if corner == "quoins":
            block = ctx.paint("trims", 1, tile="stone")
            for i in range(5):
                z = PLINTH_Z + 0.08 + i * 0.47
                if i % 2 == 0:
                    lo, hi = (-0.02, -0.02, z), (0.32, 0.12, z + 0.38)
                else:
                    lo, hi = (-0.02, -0.02, z), (0.12, 0.32, z + 0.38)
                b.box(lo, hi, block, bevel=0.02, segments=1)
        else:
            pil = ctx.paint("trims", 1, tile="plaster")
            b.solid(solids.prism([(-0.02, -0.02), (0.2, -0.02), (0.2, 0.0), (0.0, 0.0), (0.0, 0.2), (-0.02, 0.2)], "z", PLINTH_Z, CORNICE_Z, slices=3), pil, bevel=0.008, segments=1)
        return [b.to_object(ctx.collection)]


@register
class CornerInner(Module):
    """Concave building corner. Two walls meeting at an inner corner leave a wall-thickness
    square gap in the diagonal cell; this module fills it (pivot at that cell) and dresses the
    concave angle outside it (x < 0, y < 0) with a downpipe, quoin column or timber post."""

    id = "corner.inner"
    footprint = Footprint(w=1, d=1, h=H)
    variants = 3
    styles = STYLES
    tri_budget = WALL_BUDGET
    max_overhang_m = WALL_OVERHANG_M
    tags = ("corner", "wall", "europe")
    sockets = (
        Socket("top", "stack", (WALL_T / 2, WALL_T / 2, H), (0.0, 0.0, 1.0)),
        Socket("corner", "attach", (0.0, 0.0, 0.0), (-0.7071, -0.7071, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["dress"] = pick(rng, ("downpipe", "quoins", "timber"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = WallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        b.solid(solids.prism([(0.0, 0.0), (t, 0.0), (t, t), (0.0, t)], "z", 0.0, H, slices=6), k.plaster(), bevel=0.0)
        dress = params["dress"]
        if dress == "downpipe":
            zinc = ctx.paint("iron", 1, tile="plain")
            cx = cy = -0.055
            b.cylinder((cx, cy, 0.12), 0.032, H - 0.42, zinc, sides=8, bevel=0.0)
            b.cylinder((cx, cy, 0.0), 0.042, 0.14, zinc, sides=8, radius_top=0.032, bevel=0.0)
            b.box((-0.09, -0.09, H - 0.36), (0.0, 0.0, H - 0.18), zinc, bevel=0.015, segments=1)
            for z in (0.8, 1.6, 2.4):
                b.box((cx - 0.01, cy, z), (0.0, 0.0, z + 0.03), zinc, bevel=0.0)
                b.box((cx, cy - 0.01, z), (0.0, 0.0, z + 0.03), zinc, bevel=0.0)
        elif dress == "quoins":
            block = ctx.paint("trims", 1, tile="stone")
            for i in range(6):
                z = 0.05 + i * 0.49
                b.box((-0.06, -0.06, z), (0.02, 0.02, z + 0.42), block, bevel=0.015, segments=1)
        else:
            wood = ctx.paint("trims", 0, tile="timber")
            b.box((-0.07, -0.07, 0.0), (0.03, 0.03, H), wood, bevel=0.015, segments=2, seams=("z",))
            for z in (PLINTH_Z, 1.5, CORNICE_Z):
                b.box((-0.07, -0.07, z), (0.03, 0.03, z + 0.12), wood, bevel=0.012, segments=1)
        return [b.to_object(ctx.collection)]
