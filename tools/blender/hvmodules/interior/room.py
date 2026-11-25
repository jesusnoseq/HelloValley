"""Room panels on the 1 m building grid: floor slabs (``floor.*``) and room walls
(``iwall.*``). Walls stand at the back of their cell with the room face at ``ROOM_FACE_Y``
looking towards -Y; see ``base`` for the conventions."""

from __future__ import annotations

from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from hvmodules.europe.common import lines, opening_cells

from .base import DOOR, FLOOR_SINK_M, FRONT, IWALL_T, ROOM_FACE_Y, TRIM_M, WALL_H, WINDOW, InteriorModule, pick, split_lines
from .parts import knob, rect_frame

# --- floors ------------------------------------------------------------------------------


class Floor(InteriorModule):
    footprint = Footprint(w=1, d=1, h=0.0)
    sink_m = FLOOR_SINK_M
    sockets = (Socket("top", "stack", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)


@register
class FloorWood(Floor):
    """Floorboards: narrow oak strips, honey boards across, or wide walnut planks."""

    id = "floor.wood"
    tags = ("floor", "room", "apartment")

    def variant_params(self, style, variant, rng):
        return {
            "boards": pick(rng, (5, 4, 3), variant),
            "across": pick(rng, (False, True, False), variant),
            "group": pick(rng, ("floor", "floor", "darkwood"), variant),
            "swatches": [rng.randint(0, 2) for _ in range(5)],
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        n = params["boards"]
        for k in range(n):
            a, c = k / n, (k + 1) / n
            paint = ctx.paint(params["group"], params["swatches"][k], tile="floorboards")
            lo, hi = ((0.0, a, -FLOOR_SINK_M), (1.0, c, 0.0)) if params["across"] else ((a, 0.0, -FLOOR_SINK_M), (c, 1.0, 0.0))
            b.box(lo, hi, paint, bevel=0.006, segments=1, seams=("x", "y", "z-"))
        return [b.to_object(ctx.collection)]


@register
class FloorTile(Floor):
    """Ceramic tiles on grout: a cream and terracotta checker, sage diamonds or big blue-grey
    squares (kitchens, the bakery, the clinic, the café)."""

    id = "floor.tile"
    tags = ("floor", "room", "shop")

    def variant_params(self, style, variant, rng):
        return {
            "n": pick(rng, (4, 4, 2), variant),
            "colours": pick(rng, ((0, 1), (0, 2), (3, 0)), variant),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        b.box((0.0, 0.0, -FLOOR_SINK_M), (1.0, 1.0, -0.012), ctx.paint("stone", 1, tile="plain"), bevel=0.0, noise=0.0)
        n = params["n"]
        a, c = params["colours"]
        g = 0.006
        for i in range(n):
            for j in range(n):
                paint = ctx.paint("tiles", a if (i + j) % 2 == 0 else c, tile="tiles")
                lo = (i / n + (g if i else g / 2), j / n + (g if j else g / 2), -0.012)
                hi = ((i + 1) / n - (g if i < n - 1 else g / 2), (j + 1) / n - (g if j < n - 1 else g / 2), 0.0)
                b.box(lo, hi, paint, bevel=0.0, noise=0.0)
        return [b.to_object(ctx.collection)]


@register
class FloorStone(Floor):
    """Flagstones (the barn, the town hall, the library entrance)."""

    id = "floor.stone"
    tags = ("floor", "room", "shop")

    def variant_params(self, style, variant, rng):
        cols, rows = pick(rng, ((2, 3), (3, 2), (2, 2)), variant)
        return {
            "xs": split_lines(rng, 0.0, 1.0, cols, 0.25),
            "ys": split_lines(rng, 0.0, 1.0, rows, 0.25),
            "swatches": [rng.randint(0, 2) for _ in range(cols * rows)],
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        b.box((0.0, 0.0, -FLOOR_SINK_M), (1.0, 1.0, -0.02), ctx.paint("stone", 2, tile="plain"), bevel=0.0, noise=0.0)
        xs, ys = params["xs"], params["ys"]
        g = 0.008
        k = 0
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                lo = (xs[i] + g, ys[j] + g, -0.02)
                hi = (xs[i + 1] - g, ys[j + 1] - g, -0.002)
                b.box(lo, hi, ctx.paint("stone", params["swatches"][k], tile="stone"), bevel=0.012, segments=1)
                k += 1
        return [b.to_object(ctx.collection)]


# --- walls -------------------------------------------------------------------------------


def wall_sockets(extra=()):
    face = ROOM_FACE_Y
    return (
        Socket("top", "stack", (0.5, 1.0 - IWALL_T / 2, WALL_H), (0.0, 0.0, 1.0)),
        Socket("left", "edge", (0.0, 1.0 - IWALL_T / 2, WALL_H / 2), (-1.0, 0.0, 0.0)),
        Socket("right", "edge", (1.0, 1.0 - IWALL_T / 2, WALL_H / 2), (1.0, 0.0, 0.0)),
        Socket("face", "attach", (0.5, face, WALL_H / 2), FRONT),
    ) + tuple(extra)


class RoomWall(InteriorModule):
    footprint = Footprint(w=1, d=1, h=WALL_H)
    max_overhang_m = 0.0

    def variant_params(self, style, variant, rng):
        return {
            "wall": pick(rng, (0, 1, 3), variant),
            "lower": pick(rng, ("wainscot", "stripes", "tiles"), variant),
            "wainscot": pick(rng, (0, 1, 2), variant),
            "trim": pick(rng, (0, 1, 0), variant),
        }

    def openings(self):
        return ()

    def dress(self, ctx, b, params, rng) -> None:
        """Opening casings, doors, glass and curtains."""

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        openings = self.openings()
        xcuts = [c for r in openings for c in (r[0], r[1])]
        zcuts = [c for r in openings for c in (r[2], r[3])] + [0.95, 2.9]
        xs = lines(0.0, 1.0, xcuts, 0.25)
        zs = lines(0.0, WALL_H, zcuts, 0.5)
        holes = [c for r in openings for c in opening_cells(xs, zs, r)]
        plaster = ctx.paint("walls", params["wall"], tile="plaster")
        b.solid(solids.grid_panel(xs, zs, holes, ROOM_FACE_Y, 1.0), plaster, bevel=0.0, seams=("x", "z"))
        trim = ctx.paint("trim", params["trim"], tile="wood")
        spans = [(0.0, 1.0)]
        for x0, x1, z0, _ in openings:
            if z0 <= 0.0:
                spans = [(0.0, x0 - 0.06), (x1 + 0.06, 1.0)]
        face = ROOM_FACE_Y
        lower = params["lower"]
        for a, c in spans:
            if c - a < 1e-3:
                continue
            # Skirting board, the lower wall finish and its rail.
            b.box((a, face - TRIM_M, 0.0), (c, face, 0.12), trim, bevel=0.008, segments=1, seams=("x", "z-"))
            if lower == "wainscot":
                wains = ctx.paint("wainscot", params["wainscot"], tile="floorboards")
                b.box((a, face - 0.015, 0.12), (c, face, 0.92), wains, bevel=0.0, seams=("x",))
                for x in (a + (c - a) * k / 4 for k in range(1, 4)):
                    b.box((x - 0.008, face - 0.022, 0.12), (x + 0.008, face - 0.015, 0.92), trim, bevel=0.0, noise=0.0)
            elif lower == "tiles":
                b.box((a, face - 0.012, 0.12), (c, face, 0.92), ctx.paint("tiles", 2, tile="tiles"), bevel=0.0, seams=("x",))
            b.box((a, face - 0.03, 0.92), (c, face, 0.98), trim, bevel=0.008, segments=1, seams=("x",))
        if lower == "stripes":
            # Wallpaper stripes above the rail.
            stripe = ctx.paint("wainscot", params["wainscot"], tile="plaster")
            for k in range(5):
                x0, x1 = 0.05 + 0.2 * k, 0.15 + 0.2 * k
                for z0, z1 in self.stripe_spans(x0, x1):
                    b.box((x0, face - 0.003, z0), (x1, face, z1), stripe, bevel=0.0, noise=0.0)
        # Crown moulding.
        b.box((0.0, face - 0.03, 2.9), (1.0, face, WALL_H), trim, bevel=0.008, segments=1, seams=("x", "z+"))
        self.dress(ctx, b, params, rng)
        return [b.to_object(ctx.collection)]

    def stripe_spans(self, x0: float, x1: float):
        z0, z1 = 0.98, 2.9
        for ox0, ox1, oz0, oz1 in self.openings():
            if x1 > ox0 - 0.07 and x0 < ox1 + 0.07:
                spans = [(z0, max(z0, oz0 - 0.1)), (min(z1, oz1 + 0.12), z1)]
                return [(a, c) for a, c in spans if c - a > 0.02]
        return [(z0, z1)]


@register
class WallPlain(RoomWall):
    """A plain room wall: plaster over a wainscot, striped wallpaper, or a tiled dado."""

    id = "iwall.plain"
    tags = ("wall", "room")
    sockets = wall_sockets()


@register
class WallWindow(RoomWall):
    """A room wall with a window: casing, deep sill, panes and curtains, a blind or a plant."""

    id = "iwall.window"
    tags = ("wall", "room", "window")
    sockets = wall_sockets((Socket("sill", "prop", (0.5, ROOM_FACE_Y - 0.06, WINDOW[2]), (0.0, 0.0, 1.0)),))

    def openings(self):
        return (WINDOW,)

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p.update({"dress": pick(rng, ("curtains", "blind", "plant"), variant), "fabric": pick(rng, (0, 1, 2), variant)})
        return p

    def dress(self, ctx, b, params, rng) -> None:
        x0, x1, z0, z1 = WINDOW
        face = ROOM_FACE_Y
        trim = ctx.paint("trim", params["trim"], tile="wood")
        rect_frame(b, trim, x0 - 0.06, z0, x1 + 0.06, z1 + 0.06, face - 0.025, face + 0.005, 0.06)
        b.box((x0 - 0.08, face - 0.08, z0 - 0.05), (x1 + 0.08, face + 0.02, z0), trim, bevel=0.008, segments=1)
        glass = ctx.paint("glass", 0, tile="plain", material="glass")
        b.box((x0, 0.95, z0), (x1, 0.965, z1), glass, bevel=0.0, noise=0.0)
        bar = ctx.paint("trim", 0, tile="wood")
        cx = (x0 + x1) / 2
        b.box((cx - 0.018, 0.93, z0), (cx + 0.018, 0.95, z1), bar, bevel=0.0)
        b.box((x0, 0.93, z0 + (z1 - z0) * 0.55), (x1, 0.95, z0 + (z1 - z0) * 0.55 + 0.036), bar, bevel=0.0)
        fabric = ctx.paint("fabric", params["fabric"], tile="fabric")
        kind = params["dress"]
        if kind == "curtains":
            from hvkit import solids

            b.solid(solids.tube([(0.02, face - 0.07, z1 + 0.13), (0.98, face - 0.07, z1 + 0.13)], [0.014, 0.014], sides=6), ctx.paint("metal", 2, tile="plain"), bevel=0.0)
            for a, c in ((0.03, x0 + 0.06), (x1 - 0.06, 0.97)):
                b.box((a, face - 0.1, z0 - 0.15), (c, face - 0.05, z1 + 0.12), fabric, bevel=0.015, segments=1)
                mid = (a + c) / 2
                b.box((mid - 0.07, face - 0.11, z0 + 0.35), (mid + 0.07, face - 0.095, z0 + 0.4), ctx.paint("fabric", 4, tile="fabric"), bevel=0.0)
        elif kind == "blind":
            b.box((x0 - 0.02, face - 0.06, z1 - 0.45), (x1 + 0.02, face - 0.03, z1 + 0.05), fabric, bevel=0.008, segments=1)
            for k in range(3):
                z = z1 - 0.42 + k * 0.15
                b.box((x0 - 0.02, face - 0.065, z), (x1 + 0.02, face - 0.06, z + 0.012), ctx.paint("fabric", 4, tile="fabric"), bevel=0.0, noise=0.0)
            b.cylinder((cx, face - 0.05, z1 - 0.75), 0.012, 0.3, ctx.paint("trim", 1, tile="plain"), sides=4, bevel=0.0)
        else:
            # A small pot of herbs on the sill, and a valance.
            b.box((x0 - 0.06, face - 0.07, z1 + 0.06), (x1 + 0.06, face - 0.03, z1 + 0.2), fabric, bevel=0.01, segments=1)
            b.cylinder((cx, face - 0.04, z0), 0.07, 0.12, ctx.paint("pot", 0, tile="plain"), sides=8, radius_top=0.085, bevel=0.0)
            r = VariantRng(rng.randint(0, 9999))
            for k in range(5):
                b.blob((cx + r.uniform(-0.07, 0.07), face - 0.04 + r.uniform(-0.02, 0.02), z0 + 0.16 + r.uniform(0.0, 0.08)), 0.06,
                       ctx.paint("foliage", k % 4, tile="leaves"), subdivisions=1, wobble=0.1)


@register
class WallDoor(RoomWall):
    """A room wall with a door: casing, a panelled, plank or glazed door and a knob. ``doorway``
    is where a character steps through."""

    id = "iwall.door"
    tags = ("wall", "room", "door")
    sockets = wall_sockets((Socket("doorway", "prop", (0.5, ROOM_FACE_Y, 0.0), FRONT),))

    def openings(self):
        return (DOOR,)

    def variant_params(self, style, variant, rng):
        p = super().variant_params(style, variant, rng)
        p.update({"door": pick(rng, ("panels", "planks", "glazed"), variant), "paint": pick(rng, (0, 2, 3), variant)})
        return p

    def dress(self, ctx, b, params, rng) -> None:
        x0, x1, z0, z1 = DOOR
        face = ROOM_FACE_Y
        trim = ctx.paint("trim", params["trim"], tile="wood")
        for a, c in ((x0 - 0.06, x0), (x1, x1 + 0.06)):
            b.box((a, face - 0.025, 0.0), (c, face + 0.005, z1), trim, bevel=0.0)
        b.box((x0 - 0.08, face - 0.03, z1), (x1 + 0.08, face + 0.005, z1 + 0.09), trim, bevel=0.008, segments=1)
        kind = params["door"]
        y0, y1 = 0.93, 0.97
        leaf = ctx.paint("paint", params["paint"], tile="wood") if kind != "planks" else ctx.paint("wood", 1, tile="floorboards")
        if kind == "planks":
            n = 4
            for k in range(n):
                a = x0 + (x1 - x0) * k / n
                c = x0 + (x1 - x0) * (k + 1) / n
                b.box((a + 0.002, y0, z0), (c - 0.002, y1, z1), ctx.paint("wood", k % 3, tile="floorboards"), bevel=0.0)
            dark = ctx.paint("darkwood", 0, tile="wood")
            for z in (0.35, 1.8):
                b.box((x0 + 0.03, y0 - 0.02, z), (x1 - 0.03, y0, z + 0.1), dark, bevel=0.0)
        else:
            b.box((x0, y0, z0), (x1, y1, z1), leaf, bevel=0.0)
            panel = ctx.paint("paint", params["paint"], tile="plain")
            if kind == "panels":
                for pz0, pz1 in ((0.2, 0.95), (1.15, 2.0)):
                    b.box((x0 + 0.08, y0 - 0.015, pz0), (x1 - 0.08, y0, pz1), panel, bevel=0.006, segments=1)
            else:
                b.box((x0 + 0.08, y0 - 0.015, 0.2), (x1 - 0.08, y0, 0.9), panel, bevel=0.006, segments=1)
                glass = ctx.paint("glass", 1, tile="plain", material="glass")
                b.box((x0 + 0.08, y0 - 0.005, 1.1), (x1 - 0.08, y0, 2.05), glass, bevel=0.0, noise=0.0)
                b.box((0.5 - 0.015, y0 - 0.02, 1.1), (0.5 + 0.015, y0, 2.05), leaf, bevel=0.0)
                b.box((x0 + 0.08, y0 - 0.02, 1.56), (x1 - 0.08, y0, 1.59), leaf, bevel=0.0)
        knob(b, ctx.paint("metal", 2, tile="plain"), x1 - 0.08, y0, 1.0, 0.03)
