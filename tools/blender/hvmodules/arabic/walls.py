"""Arabic walls and corners: wall.plain, wall.window, wall.door, wall.shopfront, wall.timber
(striped ablaq masonry, earth wall with palm beams, carved sebka panel), corner.outer,
corner.inner (GDD §7.3, art.md §2.3).

Same footprints, sockets and openings as the European walls (``mirror``)."""

from __future__ import annotations

from typing import Any, Dict, List

from hvkit.grid import STOREY_M
from hvkit.module import register
from hvkit.variants import VariantRng
from hvmodules.europe.walls import CornerOuter as EuropeCornerOuter

from .common import (
    CORNICE_Z,
    DADO_Z,
    DOOR,
    FASCIA_Z,
    ARC_LOW,
    ARC_SEG,
    HORSESHOE_DEG,
    SHOPFRONT,
    WINDOW,
    ArabModule,
    ArabWallKit,
    lattice,
    mirror,
    pick,
    wall_params,
)

H = STOREY_M

WINDOW_SHOE = (WINDOW[0], WINDOW[1], WINDOW[2], WINDOW[3])
"""A horseshoe arch filling the wall.window opening."""
TWIN_SHOES = ((WINDOW[0], 0.48, WINDOW[2], WINDOW[3]), (0.52, WINDOW[1], WINDOW[2], WINDOW[3]))
"""An ajimez: two small horseshoe arches on a central colonnette, inside the window opening."""
DOOR_SHOE = (DOOR[0], DOOR[1], DOOR[2], DOOR[3])
SHOP_SHOE = (SHOPFRONT[0], SHOPFRONT[1], SHOPFRONT[2], SHOPFRONT[3])


class ArabWall(ArabModule):
    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return wall_params(style, variant, rng)

    def kit(self, ctx, variant: int, params, rng) -> ArabWallKit:
        return ArabWallKit(ctx, ctx.builder(self, variant, rng), params)


@register
@mirror
class WallPlain(ArabWall):
    """Plain plaster with a dado; a horseshoe niche, a zellige star panel or a small
    mashrabiya vent."""

    id = "wall.plain"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["detail"] = pick(rng, ("niche", "star", "vent"), variant)
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        k.dado()
        k.cornice()
        detail = params["detail"]
        if detail == "niche":
            # A shallow horseshoe niche (a fountain or lamp niche) in a white surround.
            shoe = (0.36, 0.64, 1.2, 1.95)
            inner = ctx.paint("walls", 3, tile="stucco")
            b.solid(solids.prism(solids.horseshoe_profile(*shoe, HORSESHOE_DEG, ARC_SEG, ARC_LOW), "y", -0.012, 0.0), inner, bevel=0.0, noise=0.0)
            k.horseshoe_surround(shoe, ctx.paint("trims", 0, tile="stucco"), width=0.04, depth=0.025)
            b.box((0.33, -0.06, 1.14), (0.67, 0.02, 1.2), ctx.paint("trims", 2, tile="stone"), bevel=0.012, segments=1)
        elif detail == "star":
            # An eight-pointed zellige star in a square tile frame.
            frame = ctx.paint("zellige", 0, tile="zellige")
            b.box((0.3, -0.02, 1.3), (0.7, 0.01, 1.7), frame, bevel=0.01, segments=1)
            star = solids.star_polygon(0.5, 1.5, 0.17, 0.11, 8, 0.0)
            b.solid(solids.prism(star, "y", -0.035, -0.02), ctx.paint("zellige", params["tiles"][0], tile="zellige"), bevel=0.0, noise=0.0)
            b.solid(solids.prism(solids.regular_polygon(0.5, 1.5, 0.06, 8, 0.39), "y", -0.045, -0.035), ctx.paint("zellige", 2, tile="zellige"), bevel=0.0, noise=0.0)
        else:
            # A small ventilation grille high up, in cedar lattice.
            wood = ctx.paint("trims", 1, tile="timber")
            k.lattice(0.32, 0.68, 2.2, 2.6, -0.03, 0.02, wood, nx=4, nz=3, frame=0.03)
            b.box((0.33, 0.02, 2.23), (0.67, 0.05, 2.57), ctx.paint("iron", 0, tile="plain"), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallWindow(ArabWall):
    """A horseshoe-arched window, a window behind a projecting mashrabiya screen, or an ajimez
    (two small horseshoe arches on a colonnette)."""

    id = "wall.window"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["shape"] = pick(rng, ("horseshoe", "screen", "twin"), variant)
        p["surround"] = pick(rng, (("trims", 0, "stucco"), ("trims", 2, "stone"), ("zellige", 1, "zellige")), variant)
        p["frame"] = pick(rng, (("trims", 1), ("accents", 0), ("trims", 1)), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        shape = params["shape"]
        surround = ctx.paint(*params["surround"][:2], tile=params["surround"][2])
        frame = ctx.paint(*params["frame"], tile="timber")
        x0, x1, z0, z1 = WINDOW
        if shape == "horseshoe":
            k.panel([WINDOW], [WINDOW_SHOE])
            k.horseshoe_surround(WINDOW_SHOE, surround)
            k.horseshoe_glass(WINDOW_SHOE, frame)
            b.box((x0 - 0.06, -0.07, z0 - 0.06), (x1 + 0.06, 0.06, z0), surround, bevel=0.012, segments=1)
        elif shape == "twin":
            k.panel([WINDOW], list(TWIN_SHOES))
            marble = ctx.paint("trims", 0, tile="stone")
            b.box((0.48, 0.0, z0), (0.52, 0.2, z1), marble, bevel=0.0)
            b.cylinder((0.5, -0.02, z0), 0.025, 0.72, marble, sides=6, bevel=0.0)
            b.box((0.47, -0.05, z0 + 0.72), (0.53, 0.01, z0 + 0.78), marble, bevel=0.0)
            for shoe in TWIN_SHOES:
                k.horseshoe_glass(shoe, frame)
            k.alfiz((x0, x1, z0, z1), surround, width=0.045, pad=0.06)
            b.box((x0 - 0.06, -0.07, z0 - 0.06), (x1 + 0.06, 0.06, z0), ctx.paint("trims", 2, tile="stone"), bevel=0.012, segments=1)
        else:
            k.panel([WINDOW])
            k.glazing(WINDOW, "single", frame)
            # The mashrabiya screen stands 0.12 m proud on a sill, under a small hood.
            wood = ctx.paint("trims", 1, tile="timber")
            ya, yb = -0.085, -0.065
            k.lattice(x0 - 0.04, x1 + 0.04, z0 - 0.02, z1 + 0.02, ya, yb, wood, nx=5, nz=6, frame=0.04)
            b.box((x0 - 0.07, -0.09, z0 - 0.08), (x1 + 0.07, 0.04, z0 - 0.02), wood, bevel=0.0)
            b.box((x0 - 0.07, -0.09, z1 + 0.02), (x1 + 0.07, 0.04, z1 + 0.08), wood, bevel=0.0)
        k.dado()
        k.cornice()
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallDoor(ArabWall):
    """Horseshoe-arched doorway in a rectangular alfiz frame: a studded cedar leaf, a teal
    painted leaf with a zellige surround, or a saffron leaf with a carved plaster band."""

    id = "wall.door"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["leaf"] = pick(rng, (("trims", 1), ("accents", 0), ("accents", 1)), variant)
        p["surround"] = pick(rng, (("trims", 2, "stone"), ("zellige", 1, "zellige"), ("trims", 0, "stucco")), variant)
        p["studs"] = variant == 0
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, _, top = DOOR
        k.panel([DOOR], [DOOR_SHOE])
        k.dado(skip=(x0 - 0.08, x1 + 0.08))
        k.cornice()
        surround = ctx.paint(*params["surround"][:2], tile=params["surround"][2])
        k.horseshoe_surround(DOOR_SHOE, surround, width=0.06)
        k.alfiz(DOOR_SHOE, surround, pad=0.12)
        step = ctx.paint("trims", 2, tile="stone")
        b.box((x0 - 0.1, -0.09, 0.0), (x1 + 0.1, 0.12, 0.07), step, bevel=0.0, seams=("z-",))
        leaf = ctx.paint(*params["leaf"], tile="timber")
        y0, y1 = 0.1, 0.15
        b.solid(solids.prism(solids.horseshoe_profile(x0, x1, 0.07, top, HORSESHOE_DEG, ARC_SEG, ARC_LOW), "y", y0, y1), leaf, bevel=0.0)
        r, zc, xj0, xj1, z_imp = solids.horseshoe_dims(x0, x1, top, HORSESHOE_DEG)
        mid = (x0 + x1) / 2
        b.box((mid - 0.008, y0 - 0.01, 0.1), (mid + 0.008, y0, zc + r - 0.04), leaf, bevel=0.0)
        brass = ctx.paint("brass", 0, tile="plain")
        if params["studs"]:
            for zz in (0.5, 1.3):
                for xx in (xj0 + 0.08, mid - 0.08, mid + 0.08, xj1 - 0.08):
                    b.box((xx - 0.015, y0 - 0.02, zz - 0.015), (xx + 0.015, y0, zz + 0.015), brass, bevel=0.0, noise=0.0)
        else:
            # Raised geometric panels.
            for za, zb in ((0.25, 0.85), (1.0, z_imp - 0.1)):
                for xa, xb in ((xj0 + 0.05, mid - 0.04), (mid + 0.04, xj1 - 0.05)):
                    b.box((xa, y0 - 0.02, za), (xb, y0, zb), leaf, bevel=0.0)
        # A brass knocker ring.
        b.cylinder((mid + 0.08, y0 - 0.03, 1.05), 0.03, 0.02, brass, sides=6, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallShopfront(ArabWall):
    """A souk shopfront: a wide horseshoe arch or a lintel with a lattice transom over the
    display, a painted or zellige fascia, and spice cones, brass lamps or rugs."""

    id = "wall.shopfront"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["shape"] = pick(rng, ("horseshoe", "lintel", "horseshoe"), variant)
        p["paint"] = pick(rng, (("trims", 1), ("accents", 0), ("accents", 3)), variant)
        p["fascia"] = pick(rng, ("painted", "zellige", "painted"), variant)
        p["goods"] = pick(rng, ("spices", "lamps", "rugs"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, z0, z1 = SHOPFRONT
        shoe = params["shape"] == "horseshoe"
        k.panel([SHOPFRONT], [SHOP_SHOE] if shoe else [])
        k.cornice()
        wood = ctx.paint(*params["paint"], tile="timber")
        b.box((0.0, -0.04, 0.0), (x0, 0.02, FASCIA_Z[0]), wood, bevel=0.0, seams=("x-", "z-"))
        b.box((x1, -0.04, 0.0), (1.0, 0.02, FASCIA_Z[0]), wood, bevel=0.0, seams=("x+", "z-"))
        b.box((x0, -0.03, 0.0), (x1, 0.02, z0), wood, bevel=0.0, seams=("z-",))
        b.box((x0 - 0.02, -0.07, z0 - 0.04), (x1 + 0.02, 0.05, z0), ctx.paint("trims", 2, tile="stone"), bevel=0.0)
        if params["fascia"] == "zellige":
            frame = ctx.paint("trims", 0, tile="stucco")
            b.box((0.0, -0.05, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), frame, bevel=0.0, seams=("x",))
            k.zellige_strip(0.05, 0.95, FASCIA_Z[0] + 0.06, FASCIA_Z[1] - 0.06, -0.05, 4, (1, 2, 3))
        else:
            b.box((0.0, -0.06, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), wood, bevel=0.0, seams=("x",))
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        y = 0.08
        if shoe:
            b.solid(solids.prism(solids.horseshoe_profile(x0, x1, z0, z1, HORSESHOE_DEG, ARC_SEG, ARC_LOW), "y", y, y + 0.02), glass, bevel=0.0, noise=0.0)
            k.horseshoe_surround(SHOP_SHOE, wood, width=0.04)
            _, _, xj0, xj1, z_imp = solids.horseshoe_dims(x0, x1, z1, HORSESHOE_DEG)
            b.box((xj0, y - 0.03, z_imp - 0.02), (xj1, y, z_imp + 0.02), wood, bevel=0.0)
        else:
            b.box((x0, y, z0), (x1, y + 0.02, z1), glass, bevel=0.0, noise=0.0)
            transom = z1 - 0.36
            b.box((x0, y - 0.03, transom - 0.025), (x1, y, transom + 0.025), wood, bevel=0.0)
            lattice(b, x0, x1, transom + 0.025, z1, y - 0.04, y - 0.01, ctx.paint("trims", 1, tile="timber"), 6, 2)
            cx = (x0 + x1) / 2
            b.box((cx - 0.018, y - 0.03, z0), (cx + 0.018, y, transom), wood, bevel=0.0)
        shelf = ctx.paint("trims", 1, tile="timber")
        b.box((x0 + 0.02, y + 0.03, z0 + 0.25), (x1 - 0.02, y + 0.22, z0 + 0.29), shelf, bevel=0.0)
        goods = params["goods"]
        for i in range(3):
            cx = x0 + 0.16 + i * 0.24 + rng.jitter(0.015)
            base = z0 + 0.29
            if goods == "spices":
                b.cylinder((cx, y + 0.13, base), 0.08, 0.17, ctx.paint("spice", i, tile="plain"), sides=6, radius_top=0.0, bevel=0.0)
            elif goods == "lamps":
                b.cylinder((cx, y + 0.13, base), 0.05, 0.12, ctx.paint("brass", i % 3, tile="plain"), sides=6, radius_top=0.02, bevel=0.0)
            else:
                rug = ctx.paint("fabric", i, tile="plain")
                b.box((cx - 0.07, y + 0.05, base), (cx + 0.07, y + 0.2, base + 0.05 + 0.03 * (i % 2)), rug, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallTimber(ArabWall):
    """The kit's textured wall (the semantic slot of the European half-timbered storey): ablaq
    masonry in alternating sand and rose courses, an earth (ksar) wall with palm-trunk beam ends
    and triangular vents, or a plaster wall with a carved sebka lozenge panel."""

    id = "wall.timber"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["pattern"] = pick(rng, ("ablaq", "ksar", "sebka"), variant)
        p["beams"] = [round(rng.uniform(-0.02, 0.02), 3) for _ in range(3)]
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        pattern = params["pattern"]
        if pattern == "ablaq":
            # Whole courses of two-tone stone, the joints set slightly back.
            courses = 6
            hgt = H / courses
            tones = [ctx.paint("trims", 2, tile="stone"), ctx.paint("walls", 1, tile="stone")]
            for c in range(courses):
                z0 = c * hgt
                seams = tuple(s for s, on in (("z-", c == 0), ("z+", c == courses - 1)) if on) + ("x",)
                b.box((0.0, 0.0, z0), (1.0, 0.2, z0 + hgt), tones[c % 2], bevel=0.008, segments=1, seams=seams)
            k.zellige_strip(0.0, 1.0, CORNICE_Z, H - 0.04, 0.0, 4, (1, 2))
            return [b.to_object(ctx.collection)]
        k.panel()
        if pattern == "ksar":
            earth = ctx.paint("walls", 3, tile="stucco")
            b.box((0.0, -0.02, 0.0), (1.0, 0.0, DADO_Z + 0.2), earth, bevel=0.0, seams=("x", "z-"))
            palm = ctx.paint("bark", 0, tile="bark")
            for i, cx in enumerate((0.2, 0.5, 0.8)):
                b.solid(solids.tube([(cx, 0.02, 2.55 + params["beams"][i]), (cx, -0.085, 2.55 + params["beams"][i])], [0.045, 0.045], sides=6), palm, bevel=0.0)
            dark = ctx.paint("trims", 1, tile="plain")
            for cx in (0.35, 0.65):
                tri = [(cx - 0.06, 1.9), (cx + 0.06, 1.9), (cx, 2.05)]
                b.solid(solids.prism(tri, "y", -0.006, 0.0), dark, bevel=0.0, noise=0.0)
            k.cornice()
        else:
            k.dado()
            k.cornice()
            # Sebka: a raised lozenge net of thin plaster ribs over a recessed panel.
            panel = ctx.paint("walls", 2 if params["swatch"] != 2 else 0, tile="stucco")
            b.box((0.12, -0.01, 0.75), (0.88, 0.0, 2.55), panel, bevel=0.0, noise=0.0)
            rib = ctx.paint("trims", 0, tile="stucco")
            for i in range(3):
                for j in range(3):
                    cx, cz = 0.25 + i * 0.25, 1.0 + j * 0.62
                    diamond = [(cx, cz - 0.3), (cx + 0.12, cz), (cx, cz + 0.3), (cx - 0.12, cz)]
                    inner = [(cx, cz - 0.26), (cx + 0.1, cz), (cx, cz + 0.26), (cx - 0.1, cz)]
                    b.solid(solids.prism(diamond, "y", -0.025, -0.01), rib, bevel=0.0, noise=0.0)
                    b.solid(solids.prism(inner, "y", -0.028, -0.025), panel, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


# --- corners -----------------------------------------------------------------------------


@register
@mirror
class CornerOuter(ArabModule):
    """Convex corner: an L of plaster over the cell's front and left edges, rounded, with
    sandstone quoins or an engaged column with a zellige collar."""

    id = "corner.outer"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["corner"] = pick(rng, ("rounded", "quoins", "column"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = ArabWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        l_profile = EuropeCornerOuter.l_profile
        seams = ("x+", "y+", "z")
        b.solid(solids.prism(l_profile(t), "z", 0.0, H, slices=5), k.plaster(), bevel=0.06, segments=2, seams=seams)
        kind = params["dado"]
        if kind == "zellige":
            base = ctx.paint("zellige", 0, tile="zellige")
        elif kind == "stone":
            base = ctx.paint("trims", 2, tile="stone")
        else:
            base = ctx.paint("trims", 0, tile="stucco")
        b.solid(solids.prism(l_profile(t, 0.02), "z", 0.0, DADO_Z), base, bevel=0.015, segments=1, seams=("x+", "y+", "z-"))
        trim = ctx.paint("trims", 1 if params["cornice"] == "corbels" else 0, tile="timber" if params["cornice"] == "corbels" else "stucco")
        b.solid(solids.prism(l_profile(t, 0.03), "z", CORNICE_Z, H), trim, bevel=0.02, segments=1, seams=seams)
        corner = params["corner"]
        if corner == "quoins":
            block = ctx.paint("trims", 2, tile="stone")
            for i in range(4):
                z = DADO_Z + 0.1 + i * 0.56
                lo, hi = ((-0.02, -0.02, z), (0.3, 0.12, z + 0.4)) if i % 2 == 0 else ((-0.02, -0.02, z), (0.12, 0.3, z + 0.4))
                b.box(lo, hi, block, bevel=0.02, segments=1)
        elif corner == "column":
            marble = ctx.paint("trims", 0, tile="stone")
            b.cylinder((0.0, 0.0, DADO_Z), 0.07, CORNICE_Z - DADO_Z - 0.14, marble, sides=8, bevel=0.0)
            b.box((-0.09, -0.09, CORNICE_Z - 0.14), (0.09, 0.09, CORNICE_Z), ctx.paint("zellige", 1, tile="zellige"), bevel=0.0)
            b.cylinder((0.0, 0.0, DADO_Z - 0.04), 0.09, 0.06, marble, sides=8, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class CornerInner(ArabModule):
    """Concave corner filler (pivot in the diagonal cell, like the European one) dressed with a
    clay drainpipe, a climbing jasmine or sandstone quoins."""

    id = "corner.inner"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["dress"] = pick(rng, ("pipe", "jasmine", "quoins"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = ArabWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        b.solid(solids.prism([(0.0, 0.0), (t, 0.0), (t, t), (0.0, t)], "z", 0.0, H, slices=6), k.plaster(), bevel=0.0)
        dress = params["dress"]
        if dress == "pipe":
            clay = ctx.paint("roofs", 2, tile="plain")
            for i in range(6):
                z = 0.1 + i * 0.47
                b.cylinder((-0.045, -0.045, z), 0.034, 0.45, clay, sides=8, radius_top=0.03, bevel=0.0)
            b.cylinder((-0.045, -0.045, 0.0), 0.045, 0.1, clay, sides=8, radius_top=0.034, bevel=0.0)
        elif dress == "quoins":
            block = ctx.paint("trims", 2, tile="stone")
            for i in range(6):
                z = 0.05 + i * 0.49
                b.box((-0.06, -0.06, z), (0.02, 0.02, z + 0.42), block, bevel=0.015, segments=1)
        else:
            bark = ctx.paint("bark", 1, tile="plain")
            b.solid(solids.tube([(-0.03, -0.03, 0.0), (-0.04, -0.03, 1.0), (-0.03, -0.04, 2.0), (-0.035, -0.035, 2.6)], [0.025, 0.02, 0.02, 0.015], sides=5), bark, bevel=0.0, smooth=True)
            for i in range(7):
                z = 0.9 + i * 0.28 + rng.jitter(0.05)
                group, idx = ("flowers", 0) if i % 2 else ("foliage", 1)
                b.blob((-0.02, -0.02, z), 0.062, ctx.paint(group, idx, tile="plain"), scale=(1.0, 1.0, 1.3), subdivisions=1, wobble=0.08)
        return [b.to_object(ctx.collection)]
