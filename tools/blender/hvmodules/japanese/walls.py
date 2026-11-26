"""Japanese walls and corners: wall.plain, wall.window, wall.door, wall.shopfront, wall.timber
(exposed post-and-beam frame, charred cedar boards, clapboards under plaster), corner.outer,
corner.inner (GDD §7.3, art.md §2.4).

Same footprints, sockets and openings as the European walls (``mirror``)."""

from __future__ import annotations

import math
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
    NAGESHI_Z,
    POST_PROUD,
    POST_W,
    SHOPFRONT,
    WINDOW,
    JapModule,
    JapWallKit,
    mirror,
    pick,
    wall_params,
)

H = STOREY_M


class JapWall(JapModule):
    def variant_params(self, style, variant: int, rng: VariantRng) -> Dict[str, Any]:
        return wall_params(style, variant, rng)

    def kit(self, ctx, variant: int, params, rng) -> JapWallKit:
        return JapWallKit(ctx, ctx.builder(self, variant, rng), params)


@register
@mirror
class WallPlain(JapWall):
    """Plaster between dark posts and beams: a round paper window (marumado), a small barred
    vent high up (muso-mado) or a patch of bamboo lath showing through earth plaster."""

    id = "wall.plain"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["detail"] = pick(rng, ("round", "lath", "vent"), variant)
        return p

    def build(self, ctx, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        from hvkit import solids

        k = self.kit(ctx, variant, params, rng)
        b = k.b
        k.panel()
        k.base()
        k.posts()
        k.beams()
        detail = params["detail"]
        if detail == "round":
            # A round window set into the plaster: a dark ring around a paper disc with a grid.
            cx, cz, r = 0.5, 1.55, 0.3
            ring = [(cx + (r + 0.04) * math.cos(a), cz + (r + 0.04) * math.sin(a)) for a in (i * math.pi / 6 for i in range(12))]
            disc = [(cx + r * math.cos(a), cz + r * math.sin(a)) for a in (i * math.pi / 6 for i in range(12))]
            b.solid(solids.prism(ring, "y", -0.03, -0.005), k.wood(0), bevel=0.0)
            b.solid(solids.prism(disc, "y", -0.04, -0.03), ctx.paint("glass", 0, tile="plain", material="glass"), bevel=0.0, noise=0.0)
            light = ctx.paint("trims", 2, tile="timber")
            for d in (-0.1, 0.1):
                b.box((cx + d - 0.008, -0.046, cz - r + 0.03), (cx + d + 0.008, -0.04, cz + r - 0.03), light, bevel=0.0, noise=0.0)
                b.box((cx - r + 0.03, -0.046, cz + d - 0.008), (cx + r - 0.03, -0.04, cz + d + 0.008), light, bevel=0.0, noise=0.0)
        elif detail == "lath":
            # A worn patch where the earth plaster has fallen away from the bamboo lath (komai).
            hole = [(0.3, 0.95), (0.62, 0.9), (0.72, 1.18), (0.55, 1.4), (0.28, 1.3)]
            b.solid(solids.prism(hole, "y", -0.004, 0.0), ctx.paint("walls", 3, tile="shikkui"), bevel=0.0, noise=0.0)
            cane = ctx.paint("bamboo", 0, tile="bamboo")
            for i in range(4):
                z = 1.0 + i * 0.1
                b.box((0.33, -0.012, z), (0.66, -0.004, z + 0.02), cane, bevel=0.0, noise=0.0)
            for x in (0.4, 0.52, 0.62):
                b.box((x, -0.016, 0.96), (x + 0.02, -0.012, 1.34), cane, bevel=0.0, noise=0.0)
        else:
            # A small barred vent window under the tie beam.
            x0, x1, z0, z1 = 0.3, 0.7, 1.95, 2.3
            k.frame((x0, x1, z0, z1), k.wood(0), width=0.04, depth=0.03, sill=True, head=0.04)
            b.box((x0, 0.06, z0), (x1, 0.08, z1), ctx.paint("trims", 0, tile="plain"), bevel=0.0, noise=0.0)
            for i in range(5):
                x = x0 + (x1 - x0) * (i + 0.5) / 5
                b.box((x - 0.015, -0.02, z0), (x + 0.015, 0.06, z1), k.wood(1), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallWindow(JapWall):
    """A shoji window in a dark frame, a shoji behind a koshi lattice, or a shoji over a solid
    lower panel with a carved transom (ranma)."""

    id = "wall.window"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["shape"] = pick(rng, ("shoji", "koshi", "ranma"), variant)
        p["grid"] = pick(rng, ((3, 4), (2, 3), (4, 3)), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        shape = params["shape"]
        nx, nz = params["grid"]
        x0, x1, z0, z1 = WINDOW
        k.panel([WINDOW])
        k.base()
        k.posts()
        k.beams()
        dark = k.wood(0)
        k.frame(WINDOW, dark, width=0.045, depth=0.03, sill=True, head=0.05)
        if shape == "shoji":
            k.shoji(WINDOW, 0.08, nx, nz)
        elif shape == "koshi":
            k.shoji(WINDOW, 0.1, nx, nz)
            k.koshi((x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02), -0.075, -0.045, k.wood(1), n=4, rail=False)
        else:
            mid = z0 + (z1 - z0) * 0.3
            b.box((x0, 0.06, z0), (x1, 0.12, mid), k.wood(1), bevel=0.0)
            b.box((x0 + 0.04, 0.05, z0 + 0.05), (x1 - 0.04, 0.06, mid - 0.05), k.wood(0), bevel=0.0, noise=0.0)
            top = z1 - 0.22
            k.shoji((x0, x1, mid, top), 0.08, nx, 2)
            b.box((x0, 0.06, top), (x1, 0.12, top + 0.03), dark, bevel=0.0)
            # The ranma: a light panel with three pierced lozenges.
            b.box((x0, 0.1, top + 0.03), (x1, 0.12, z1), ctx.paint("trims", 2, tile="timber"), bevel=0.0)
            from hvkit import solids

            for i in range(3):
                cx = x0 + (x1 - x0) * (i + 0.5) / 3
                cz = top + 0.03 + (z1 - top - 0.03) / 2
                lozenge = [(cx, cz - 0.07), (cx + 0.06, cz), (cx, cz + 0.07), (cx - 0.06, cz)]
                b.solid(solids.prism(lozenge, "y", 0.095, 0.1), ctx.paint("glass", 0, tile="plain", material="glass"), bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallDoor(JapWall):
    """Two sliding doors in the doorway: lattice doors (koshi-do) with paper behind, shoji doors
    over wooden kick panels under a noren curtain, or plank doors with battens. A step stone
    (kutsunugi-ishi) lies in front."""

    id = "wall.door"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["leaf"] = pick(rng, ("lattice", "shoji", "planks"), variant)
        p["noren"] = pick(rng, (0, 1, 3), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, _, top = DOOR
        k.panel([DOOR])
        k.base(skip=(x0 - 0.04, x1 + 0.04))
        k.posts()
        k.beams()
        dark = k.wood(0)
        k.frame(DOOR, dark, width=0.05, depth=0.03, sill=False, head=0.06)
        b.box((x0, 0.0, 0.0), (x1, 0.2, 0.03), dark, bevel=0.0, seams=("z-",))
        stone = ctx.paint("stone", 1, tile="paving")
        b.box((x0 + 0.08, -0.095, 0.0), (x1 - 0.08, 0.0, 0.08), stone, bevel=0.015, segments=1, seams=("z-",))
        leaf = params["leaf"]
        mid = (x0 + x1) / 2
        leaves = ((x0, mid + 0.02, 0.06), (mid - 0.02, x1, 0.11))
        for la, lb, y in leaves:
            frame = k.wood(1 if leaf != "planks" else 0)
            if leaf == "planks":
                b.box((la, y, 0.03), (lb, y + 0.04, top), k.wood(1), bevel=0.0)
                for z in (0.4, 1.1, 1.8):
                    b.box((la + 0.02, y - 0.015, z), (lb - 0.02, y, z + 0.06), dark, bevel=0.0)
                b.box((lb - 0.07, y - 0.02, 0.95), (lb - 0.05, y, 1.15), ctx.paint("iron", 0, tile="plain"), bevel=0.0, noise=0.0)
            elif leaf == "shoji":
                b.box((la, y, 0.03), (lb, y + 0.04, 0.6), frame, bevel=0.0)
                k.shoji((la, lb, 0.6, top), y, 2, 3, paint_frame=frame)
            else:
                paper = ctx.paint("glass", 0, tile="plain", material="glass")
                b.box((la, y + 0.025, 0.03), (lb, y + 0.035, top), paper, bevel=0.0, noise=0.0)
                k.koshi((la, lb, 0.03, top), y, y + 0.025, frame, n=4)
                b.box((la, y, 0.03), (la + 0.03, y + 0.025, top), frame, bevel=0.0)
                b.box((lb - 0.03, y, 0.03), (lb, y + 0.025, top), frame, bevel=0.0)
        colour = params["noren"]
        if leaf == "shoji":
            k.noren(x0 - 0.02, x1 + 0.02, top + 0.02, 0.55, -0.075, ctx.paint("fabric", colour, tile="plain"), panels=2)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallShopfront(JapWall):
    """A machiya shopfront: a lattice front with a noren across the top, sliding shoji over a
    low counter, or an open front with shelves of goods (sake casks, tea jars, folded cloth),
    under a dark fascia board."""

    id = "wall.shopfront"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["front"] = pick(rng, ("lattice", "shoji", "open"), variant)
        p["noren"] = pick(rng, (0, 1, 3), variant)
        p["goods"] = pick(rng, ("casks", "jars", "cloth"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        x0, x1, z0, z1 = SHOPFRONT
        k.panel([SHOPFRONT])
        k.posts()
        k.beams(nageshi=False)
        dark = k.wood(0)
        b.box((POST_W, -POST_PROUD, 0.0), (x0, 0.02, FASCIA_Z[0]), dark, bevel=0.0, seams=("z-",))
        b.box((x1, -POST_PROUD, 0.0), (1.0 - POST_W, 0.02, FASCIA_Z[0]), dark, bevel=0.0, seams=("z-",))
        b.box((x0, -0.03, 0.0), (x1, 0.02, z0), k.wood(1), bevel=0.0, seams=("z-",))
        b.box((x0 - 0.02, -0.06, z0 - 0.04), (x1 + 0.02, 0.05, z0), dark, bevel=0.0)
        b.box((x0, -0.04, z1), (x1, 0.02, FASCIA_Z[0]), dark, bevel=0.0)
        b.box((0.0, -0.06, FASCIA_Z[0]), (1.0, 0.02, FASCIA_Z[1]), dark, bevel=0.0, seams=("x",))
        front = params["front"]
        y = 0.08
        noren = ctx.paint("fabric", params["noren"], tile="plain")
        if front == "lattice":
            k.shoji((x0, x1, z0, z1), y + 0.03, 1, 1)
            k.koshi((x0, x1, z0, z1), y - 0.03, y, k.wood(1), n=9)
            k.noren(x0, x1, z1 - 0.02, 0.45, -0.09, noren, panels=4)
        elif front == "shoji":
            mid = (x0 + x1) / 2
            for la, lb, yy in ((x0, mid + 0.02, y), (mid - 0.02, x1, y + 0.04)):
                k.shoji((la, lb, z0, z1), yy, 2, 4, paint_frame=k.wood(1))
        else:
            b.box((x0, y + 0.1, z0), (x1, y + 0.12, z1), ctx.paint("trims", 0, tile="plain"), bevel=0.0, noise=0.0)
            shelf = k.wood(2)
            goods = params["goods"]
            for level in (z0 + 0.02, z0 + 0.62):
                b.box((x0 + 0.02, y - 0.04, level), (x1 - 0.02, y + 0.1, level + 0.04), shelf, bevel=0.0)
                for i in range(3):
                    cx = x0 + 0.15 + i * 0.25 + rng.jitter(0.015)
                    base = level + 0.04
                    if goods == "casks":
                        b.cylinder((cx, y + 0.03, base), 0.08, 0.16, ctx.paint("trims", 2, tile="timber"), sides=8, bevel=0.0)
                        b.box((cx - 0.05, y - 0.052, base + 0.04), (cx + 0.05, y - 0.048, base + 0.12), ctx.paint("fabric", 2, tile="plain"), bevel=0.0, noise=0.0)
                    elif goods == "jars":
                        b.cylinder((cx, y + 0.03, base), 0.06, 0.14, ctx.paint("accents", (i * 2) % 5, tile="plain"), sides=8, radius_top=0.04, bevel=0.0)
                        b.cylinder((cx, y + 0.03, base + 0.14), 0.045, 0.04, ctx.paint("trims", 1, tile="timber"), sides=8, bevel=0.0)
                    else:
                        b.box((cx - 0.09, y - 0.03, base), (cx + 0.09, y + 0.08, base + 0.05 + 0.03 * (i % 2)), ctx.paint("fabric", i, tile="plain"), bevel=0.0)
            k.noren(x0, x1, z1 - 0.02, 0.35, -0.09, noren, panels=4, mon=False)
        return [b.to_object(ctx.collection)]


@register
@mirror
class WallTimber(JapWall):
    """The kit's textured wall (the semantic slot of the European half-timbered storey): an
    exposed post-and-beam frame (shinkabe) with extra posts and tie rails, charred cedar boards
    (yakisugi) with battens, or horizontal clapboards (shitami-ita) under a band of plaster."""

    id = "wall.timber"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["pattern"] = pick(rng, ("frame", "yakisugi", "clapboard"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        k = self.kit(ctx, variant, params, rng)
        b = k.b
        pattern = params["pattern"]
        dark = k.wood(0)
        if pattern == "yakisugi":
            char = ctx.paint("iron", 0, tile="timber")
            n = 8
            for i in range(n):
                xa, xb = i / n, (i + 1) / n
                seams = ("z",) + (("x-",) if i == 0 else ()) + (("x+",) if i == n - 1 else ())
                b.box((xa, -0.015 + params["grain"][i % 3] * 0.3, 0.0), (xb, 0.2, CORNICE_Z), char, bevel=0.0, seams=seams)
            for xa in (0.0, 1.0 - POST_W):
                b.box((xa, -0.04, 0.0), (xa + POST_W, 0.2, H), dark, bevel=0.0, seams=("x", "z"))
            for z in (0.45, 1.25, 2.05):
                b.box((0.0, -0.03, z), (1.0, -0.015, z + 0.06), dark, bevel=0.0, seams=("x",))
            k.beams(nageshi=False)
            return [b.to_object(ctx.collection)]
        k.panel()
        k.posts()
        k.beams()
        if pattern == "frame":
            k.base()
            b.box((0.47, -POST_PROUD, DADO_Z), (0.53, 0.0, NAGESHI_Z[0]), dark, bevel=0.0)
            for z in (1.2, 1.85):
                b.box((POST_W, -0.025, z), (1.0 - POST_W, 0.0, z + 0.05), dark, bevel=0.0, seams=("x",))
            b.box((0.0, -0.04, DADO_Z - 0.02), (1.0, 0.0, DADO_Z + 0.04), dark, bevel=0.0, seams=("x",))
        else:
            boards = k.wood(1)
            n = 9
            top = 1.9
            for i in range(n):
                z0 = top * i / n
                z1 = top * (i + 1) / n
                b.box((POST_W, -0.03 + 0.012 * (i % 2 == 0), z0), (1.0 - POST_W, 0.0, z1 + 0.01), boards, bevel=0.0)
            for x in (0.33, 0.67):
                b.box((x - 0.02, -0.045, 0.0), (x + 0.02, -0.02, top), dark, bevel=0.0, noise=0.0)
            b.box((0.0, -0.04, top), (1.0, 0.0, top + 0.06), dark, bevel=0.0, seams=("x",))
        return [b.to_object(ctx.collection)]


# --- corners -----------------------------------------------------------------------------


@register
@mirror
class CornerOuter(JapModule):
    """Convex corner: an L of plaster over the cell's front and left edges with a square corner
    post, the base band on both faces and the top beam turning the corner; dark corner boards
    or a stone plinth on the other variants."""

    id = "corner.outer"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["corner"] = pick(rng, ("post", "boards", "post"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = JapWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        l_profile = EuropeCornerOuter.l_profile
        seams = ("x+", "y+", "z")
        b.solid(solids.prism(l_profile(t), "z", 0.0, H, slices=5), k.plaster(), bevel=0.0, seams=seams)
        dark = k.wood()
        kind = params["base"]
        base = ctx.paint("stone", 0, tile="paving") if kind == "stone" else (ctx.paint("roofs", 1, tile="kawara") if kind == "namako" else ctx.paint("trims", 0, tile="timber"))
        b.solid(solids.prism(l_profile(t, 0.02), "z", 0.0, DADO_Z), base, bevel=0.0, seams=("x+", "y+", "z-"))
        b.solid(solids.prism(l_profile(t, 0.05), "z", CORNICE_Z, H), dark, bevel=0.0, seams=seams)
        b.solid(solids.prism(l_profile(t, 0.04), "z", NAGESHI_Z[0], NAGESHI_Z[1]), dark, bevel=0.0, seams=("x+", "y+"))
        b.box((-0.04, -0.04, 0.0), (0.1, 0.1, H), dark, bevel=0.0, seams=("z",))
        b.box((1.0 - POST_W, -POST_PROUD, 0.0), (1.0, t, H), dark, bevel=0.0, seams=("x+", "z"))
        b.box((-POST_PROUD, 1.0 - POST_W, 0.0), (t, 1.0, H), dark, bevel=0.0, seams=("y+", "z"))
        if params["corner"] == "boards":
            char = ctx.paint("iron", 0, tile="timber")
            b.box((0.1, -0.025, DADO_Z), (0.4, 0.0, NAGESHI_Z[0]), char, bevel=0.0)
            b.box((-0.025, 0.1, DADO_Z), (0.0, 0.4, NAGESHI_Z[0]), char, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
@mirror
class CornerInner(JapModule):
    """Concave corner filler (pivot in the diagonal cell, like the European one): a post with a
    rain chain (kusari-doi) of little cups, a bamboo downpipe, or a plain post with a hanging
    paper lantern."""

    id = "corner.inner"

    def variant_params(self, style, variant, rng):
        p = wall_params(style, variant, rng)
        p["dress"] = pick(rng, ("chain", "bamboo", "lantern"), variant)
        return p

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        k = JapWallKit(ctx, ctx.builder(self, variant, rng), params)
        b = k.b
        t = k.t
        b.solid(solids.prism([(0.0, 0.0), (t, 0.0), (t, t), (0.0, t)], "z", 0.0, H, slices=6), k.plaster(), bevel=0.0)
        dark = k.wood()
        b.box((-0.06, -0.06, 0.0), (0.04, 0.04, H), dark, bevel=0.0, seams=("z",))
        dress = params["dress"]
        if dress == "chain":
            copper = ctx.paint("roofs", 3, tile="plain")
            b.box((-0.095, -0.095, H - 0.12), (0.0, 0.0, H - 0.04), copper, bevel=0.0)
            for i in range(9):
                z = 0.15 + i * 0.3
                b.cylinder((-0.05, -0.05, z), 0.03, 0.1, copper, sides=6, radius_top=0.042, bevel=0.0)
            b.cylinder((-0.05, -0.05, 0.0), 0.045, 0.06, ctx.paint("stone", 1, tile="paving"), sides=6, bevel=0.0)
        elif dress == "bamboo":
            cane = ctx.paint("bamboo", 1, tile="bamboo")
            b.cylinder((-0.05, -0.05, 0.0), 0.035, H - 0.1, cane, sides=6, bevel=0.0)
            for i in range(1, 6):
                b.cylinder((-0.05, -0.05, i * 0.5), 0.042, 0.03, cane, sides=6, bevel=0.0)
            b.box((-0.09, -0.09, H - 0.15), (-0.01, -0.01, H - 0.04), cane, bevel=0.0)
        else:
            paper = ctx.paint("light", 0, tile="plain", material="glow")
            red = ctx.paint("lacquer", 0, tile="plain")
            b.box((-0.06, -0.06, 2.55), (0.0, 0.0, 2.58), dark, bevel=0.0)
            b.cylinder((-0.045, -0.045, 2.0), 0.035, 0.03, red, sides=8, bevel=0.0)
            b.cylinder((-0.045, -0.045, 2.03), 0.05, 0.3, paper, sides=8, bevel=0.0, noise=0.0)
            b.cylinder((-0.045, -0.045, 2.33), 0.035, 0.03, red, sides=8, bevel=0.0)
            b.box((-0.05, -0.05, 2.36), (-0.04, -0.04, 2.55), dark, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]
