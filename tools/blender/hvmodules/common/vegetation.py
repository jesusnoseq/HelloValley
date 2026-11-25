"""Rounded "cloud" vegetation (GDD §7.1): six tree species, bushes and flower patches.

Trees split into a ``trunk`` mesh (bark, the ``atlas`` material) and a ``canopy`` mesh (the
``canopy`` material, extras ``hv_canopy``) whose object origin is the top of the trunk, so the
client can sway the canopy in a vertex shader around that pivot (TODO(M12)). Bushes and
flowers are canopy-only. Canopy blob layouts are chosen in ``variant_params`` (pure, so the
tests can check they stay inside the footprint)."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import CommonModule, pick, scatter

Blob = List[float]
"""[x, y, z, radius, scale_x, scale_y, scale_z, swatch]"""

CANOPY_WOBBLE = 0.08
BLOB_SUBDIV = 2
"""80-face icospheres, smooth shaded: round "cloud" lumps."""


def blob_extent(blob: Sequence[float], wobble: float = CANOPY_WOBBLE) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    """Axis-aligned box a canopy blob can reach (radius x scale, plus the wobble)."""
    x, y, z, r, sx, sy, sz = blob[:7]
    k = r * (1.0 + wobble)
    return (x - k * sx, y - k * sy, z - k * sz), (x + k * sx, y + k * sy, z + k * sz)


def _r(v: float) -> float:
    return round(v, 4)


def cluster(rng: VariantRng, center: Sequence[float], main_r: float, n: int, spread: float, swatches: int,
            flat: float = 1.0, lift: float = 0.0) -> List[Blob]:
    """A main blob plus ``n`` satellites around it: the cloud canopy."""
    cx, cy, cz = center
    blobs: List[Blob] = [[_r(cx), _r(cy), _r(cz), _r(main_r), 1.0, 1.0, _r(flat), 0]]
    for i in range(n):
        a = 2 * math.pi * (i + rng.uniform(-0.2, 0.2)) / n
        d = spread * rng.uniform(0.8, 1.0)
        r = main_r * rng.uniform(0.55, 0.72)
        z = cz + rng.uniform(-0.25, 0.2) * main_r + lift * (i % 2)
        blobs.append([_r(cx + d * math.cos(a)), _r(cy + d * math.sin(a)), _r(z), _r(r), 1.0, 1.0, _r(flat), i % max(1, swatches)])
    return blobs


class Plant(CommonModule):
    canopy = True
    footprint = Footprint(w=2, d=2, h=4.0)
    max_overhang_m = 0.3

    def canopy_paint(self, ctx, group: str, index: int):
        return ctx.paint(group, index, tile="leaves", material="canopy")

    def add_blobs(self, ctx, b, blobs: Sequence[Blob], group: str) -> None:
        for x, y, z, r, sx, sy, sz, sw in blobs:
            b.blob((x, y, z), r, self.canopy_paint(ctx, group, int(sw)), scale=(sx, sy, sz), subdivisions=BLOB_SUBDIV, wobble=CANOPY_WOBBLE)

    def trunk_and_canopy(self, ctx, trunk_builder, canopy_builder, pivot) -> List[Any]:
        """The trunk mesh and the canopy mesh, whose origin is ``pivot`` (the trunk top)."""
        return [
            trunk_builder.to_object(ctx.collection, part="trunk"),
            canopy_builder.to_object(ctx.collection, part="canopy", origin=pivot),
        ]


class Tree(Plant):
    trunk = True


def _trunk_line(rng: VariantRng, base: Sequence[float], height: float, lean: float, n: int = 3) -> List[Tuple[float, float, float]]:
    a = rng.uniform(0, 2 * math.pi)
    pts = []
    for i in range(n + 1):
        t = i / n
        bend = lean * t * t
        pts.append((_r(base[0] + bend * math.cos(a)), _r(base[1] + bend * math.sin(a)), _r(base[2] + height * t)))
    return pts


@register
class TreeDeciduous(Tree):
    """Linden/oak-like broadleaf with a round cloud canopy."""

    id = "tree.deciduous"
    footprint = Footprint(w=2, d=2, h=4.0)
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        shape = pick(rng, ("round", "tall", "wide"), variant)
        trunk_h = {"round": 1.25, "tall": 1.45, "wide": 1.1}[shape] + rng.uniform(-0.05, 0.05)
        main = {"round": 0.72, "tall": 0.6, "wide": 0.62}[shape]
        trunk = _trunk_line(rng, (1.0, 1.0, 0.0), trunk_h, 0.12)
        top = trunk[-1]
        if shape == "tall":
            blobs = cluster(rng, (top[0], top[1], top[2] + 0.75), main, 4, 0.42, 2, flat=1.25, lift=0.35)
            blobs.append([top[0], top[1], _r(top[2] + 1.55), _r(main * 0.65), 1.0, 1.0, 1.1, 1])
        elif shape == "wide":
            blobs = cluster(rng, (top[0], top[1], top[2] + 0.55), main, 6, 0.62, 3, flat=0.85)
        else:
            blobs = cluster(rng, (top[0], top[1], top[2] + 0.62), main, 5, 0.5, 2)
        return {"shape": shape, "trunk": trunk, "blobs": blobs, "group": pick(rng, (0, 1, 2), variant), "bark": variant % 3}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", params["bark"], tile="bark")
        trunk = params["trunk"]
        t.solid(solids.tube(trunk, [0.15, 0.12, 0.1, 0.08], sides=7), bark, bevel=0.0, smooth=True)
        t.cylinder((trunk[0][0], trunk[0][1], 0.0), 0.2, 0.12, bark, sides=7, radius_top=0.14, bevel=0.0)
        top = trunk[-1]
        for x, y, z, *_ in params["blobs"][1:4]:
            mid = (top[0] * 0.5 + x * 0.5, top[1] * 0.5 + y * 0.5, top[2] * 0.6 + z * 0.4)
            t.solid(solids.tube([trunk[-2], mid], [0.07, 0.04], sides=5), bark, bevel=0.0, smooth=True)
        blobs = [b[:7] + [(b[7] + params["group"]) % 4] for b in params["blobs"]]
        self.add_blobs(ctx, c, blobs, "foliage")
        return self.trunk_and_canopy(ctx, t, c, top)


@register
class TreeConifer(Tree):
    """Fir/pine: stacked soft cones."""

    id = "tree.conifer"
    footprint = Footprint(w=2, d=2, h=4.2)
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        tiers = pick(rng, (4, 3, 5), variant)
        height = pick(rng, (3.4, 2.8, 3.9), variant) + rng.uniform(-0.1, 0.1)
        trunk_h = 0.45
        base_r = pick(rng, (0.85, 0.75, 0.8), variant)
        layers = []
        span = height - trunk_h
        for i in range(tiers):
            f = i / tiers
            z0 = trunk_h - 0.1 + span * f * 0.82
            r = base_r * (1.0 - 0.72 * f)
            h = span / tiers * 1.55
            layers.append([_r(1.0 + rng.jitter(0.03)), _r(1.0 + rng.jitter(0.03)), _r(z0), _r(r), _r(h), i % 3])
        return {"trunk_h": trunk_h, "layers": layers, "height": _r(height), "group": variant % 3}

    def build(self, ctx, variant, params, rng):
        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 1, tile="bark")
        th = params["trunk_h"]
        t.cylinder((1.0, 1.0, 0.0), 0.12, th + 0.3, bark, sides=7, radius_top=0.08, bevel=0.0)
        for x, y, z, r, h, sw in params["layers"]:
            paint = self.canopy_paint(ctx, "conifer", (int(sw) + params["group"]) % 3)
            c.cylinder((x, y, z), r, h, paint, sides=8, radius_top=r * 0.18, bevel=0.06, segments=1, noise=0.012)
        return self.trunk_and_canopy(ctx, t, c, (1.0, 1.0, th))


@register
class TreeCypress(Tree):
    """Slim Mediterranean cypress: a tall flame of elongated blobs (1 x 1 cell)."""

    id = "tree.cypress"
    footprint = Footprint(w=1, d=1, h=3.8)
    max_overhang_m = 0.05
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        height = pick(rng, (3.3, 2.7, 3.6), variant)
        r = pick(rng, (0.34, 0.3, 0.38), variant)
        trunk_h = 0.3
        body = height - trunk_h
        blobs = [
            [0.5, 0.5, _r(trunk_h + body * 0.3), _r(r * 0.95), 1.0, 1.0, 1.5, 0],
            [_r(0.5 + rng.jitter(0.03)), _r(0.5 + rng.jitter(0.03)), _r(trunk_h + body * 0.55), _r(r), 1.0, 1.0, 2.0, 1],
            [_r(0.5 + rng.jitter(0.03)), _r(0.5 + rng.jitter(0.03)), _r(trunk_h + body * 0.82), _r(r * 0.6), 1.0, 1.0, 2.2, 2],
        ]
        return {"trunk_h": trunk_h, "blobs": blobs, "group": variant % 3}

    def build(self, ctx, variant, params, rng):
        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        th = params["trunk_h"]
        t.cylinder((0.5, 0.5, 0.0), 0.07, th + 0.25, ctx.paint("bark", 0, tile="bark"), sides=6, radius_top=0.05, bevel=0.0)
        blobs = [b[:7] + [(b[7] + params["group"]) % 3] for b in params["blobs"]]
        self.add_blobs(ctx, c, blobs, "conifer")
        return self.trunk_and_canopy(ctx, t, c, (0.5, 0.5, th))


@register
class TreePalm(Tree):
    """Date/coconut palm: a curved ringed trunk and a crown of drooping fronds."""

    id = "tree.palm"
    footprint = Footprint(w=2, d=2, h=4.4)
    max_overhang_m = 0.5
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)
    SEGMENTS = 6

    def variant_params(self, style, variant, rng):
        height = pick(rng, (3.4, 2.9, 3.8), variant)
        lean = pick(rng, (0.2, 0.05, 0.12), variant)
        trunk = _trunk_line(rng, (1.0, 1.0, 0.0), height, lean, self.SEGMENTS)
        n = pick(rng, (8, 7, 9), variant)
        fronds = []
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.15, 0.15)) / n
            length = rng.uniform(0.9, 1.05)
            rise = rng.uniform(0.15, 0.3)
            fronds.append([_r(a), _r(length), _r(rise), i % 3])
        return {"trunk": trunk, "fronds": fronds, "coconuts": variant != 1, "group": variant % 3}

    @staticmethod
    def frond_spine(top: Sequence[float], a: float, length: float, rise: float, n: int = 5) -> List[Tuple[float, float, float]]:
        pts = []
        for i in range(n):
            t = i / (n - 1)
            d = length * t
            z = top[2] + rise * 4 * t * (1 - t) * 0.9 - 0.55 * length * t * t
            pts.append((top[0] + d * math.cos(a), top[1] + d * math.sin(a), z))
        return pts

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        trunk = params["trunk"]
        for i in range(len(trunk) - 1):
            r0 = 0.14 - 0.008 * i
            bark = ctx.paint("bark", 2 if i % 2 else 0, tile="bark")
            t.solid(solids.tube([trunk[i], trunk[i + 1]], [r0, r0 * 0.82], sides=7), bark, bevel=0.0, smooth=True)
        top = trunk[-1]
        widths = [0.04, 0.26, 0.3, 0.2, 0.03]
        for a, length, rise, sw in params["fronds"]:
            spine = self.frond_spine(top, a, length, rise)
            paint = self.canopy_paint(ctx, "palm", (int(sw) + params["group"]) % 3)
            c.solid(solids.leaf(spine, widths, thickness=0.025), paint, bevel=0.0, noise=0.0, recalc_normals=True)
        c.blob(top, 0.12, self.canopy_paint(ctx, "palm", 2), subdivisions=1, wobble=0.0)
        if params["coconuts"]:
            nut = self.canopy_paint(ctx, "bark", 2)
            for k in range(3):
                a = 2 * math.pi * k / 3 + 0.4
                c.blob((top[0] + 0.1 * math.cos(a), top[1] + 0.1 * math.sin(a), top[2] - 0.1), 0.07, nut, subdivisions=1, wobble=0.05)
        return self.trunk_and_canopy(ctx, t, c, top)


@register
class TreeSakura(Tree):
    """Cherry blossom: a crooked dark trunk with spreading branches under pink clouds."""

    id = "tree.sakura"
    footprint = Footprint(w=2, d=2, h=3.6)
    max_overhang_m = 0.35
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        trunk_h = pick(rng, (1.15, 1.0, 1.3), variant)
        trunk = _trunk_line(rng, (1.0, 1.0, 0.0), trunk_h, 0.18)
        top = trunk[-1]
        n = pick(rng, (5, 4, 6), variant)
        blobs = cluster(rng, (top[0], top[1], top[2] + 0.5), pick(rng, (0.6, 0.55, 0.52), variant), n, 0.62, 3, flat=0.8)
        # Keep the spreading crown inside the footprint plus overhang.
        for bl in blobs:
            bl[0] = _r(min(max(bl[0], 0.55), 1.45))
            bl[1] = _r(min(max(bl[1], 0.55), 1.45))
        return {"trunk": trunk, "blobs": blobs, "group": variant % 3}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("darkwood", 1, tile="bark")
        trunk = params["trunk"]
        t.solid(solids.tube(trunk, [0.13, 0.11, 0.09, 0.07], sides=7), bark, bevel=0.0, smooth=True)
        top = trunk[-1]
        for x, y, z, *_ in params["blobs"][1:]:
            t.solid(solids.tube([trunk[-2], (x, y, z - 0.15)], [0.06, 0.03], sides=5), bark, bevel=0.0, smooth=True)
        blobs = [b[:7] + [(b[7] + params["group"]) % 3] for b in params["blobs"]]
        self.add_blobs(ctx, c, blobs, "blossom")
        return self.trunk_and_canopy(ctx, t, c, top)


@register
class TreeOlive(Tree):
    """Olive: a short gnarled double trunk and flat silvery-green clouds."""

    id = "tree.olive"
    footprint = Footprint(w=2, d=2, h=3.0)
    tags = ("vegetation", "tree", "canopy")
    sockets = (Socket("base", "prop", (1.0, 1.0, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        trunk_h = pick(rng, (1.0, 0.85, 1.1), variant)
        stems = []
        for k in range(2):
            a = rng.uniform(0, 2 * math.pi) if k == 0 else stems[0][1] + math.pi + rng.uniform(-0.6, 0.6)
            stems.append((k, a))
        lines = []
        for _, a in stems:
            pts = []
            for i in range(4):
                tt = i / 3
                wig = 0.06 * math.sin(tt * 5 + a)
                d = 0.22 * tt
                pts.append((_r(1.0 + d * math.cos(a) + wig), _r(1.0 + d * math.sin(a) - wig), _r(trunk_h * tt)))
            lines.append(pts)
        top = (1.0, 1.0, trunk_h)
        blobs = cluster(rng, (top[0], top[1], top[2] + 0.42), pick(rng, (0.55, 0.5, 0.6), variant), pick(rng, (5, 4, 6), variant), 0.6, 3, flat=0.65)
        return {"stems": lines, "blobs": blobs, "trunk_h": trunk_h, "group": variant % 3}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        t = ctx.builder(self, variant, rng, "trunk")
        c = ctx.builder(self, variant, rng, "canopy")
        bark = ctx.paint("bark", 2, tile="bark")
        for line in params["stems"]:
            t.solid(solids.tube(line, [0.12, 0.09, 0.08, 0.06], sides=6), bark, bevel=0.0, smooth=True)
        t.cylinder((1.0, 1.0, 0.0), 0.2, 0.1, bark, sides=7, radius_top=0.13, bevel=0.0)
        blobs = [b[:7] + [(b[7] + params["group"]) % 3] for b in params["blobs"]]
        self.add_blobs(ctx, c, blobs, "olive")
        return self.trunk_and_canopy(ctx, t, c, (1.0, 1.0, params["trunk_h"]))


@register
class Bush(Plant):
    """A rounded shrub resting on the ground: plain, with berries or flowering."""

    id = "bush"
    footprint = Footprint(w=1, d=1, h=1.0)
    max_overhang_m = 0.05
    tags = ("vegetation", "bush", "canopy")
    sockets = (Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        kind = pick(rng, ("plain", "berries", "flowering"), variant)
        n = pick(rng, (3, 4, 3), variant)
        blobs = [[0.5, 0.5, 0.3, 0.3, 1.0, 1.0, 0.9, 0]]
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.2, 0.2)) / n
            blobs.append([_r(0.5 + 0.17 * math.cos(a)), _r(0.5 + 0.17 * math.sin(a)), _r(0.2 + rng.uniform(0.0, 0.08)), _r(rng.uniform(0.2, 0.24)), 1.0, 1.0, 0.9, (i + 1) % 3])
        return {"kind": kind, "blobs": blobs, "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        c = ctx.builder(self, variant, rng, "canopy")
        for x, y, z, r, sx, sy, sz, sw in params["blobs"]:
            c.blob((x, y, z), r, self.canopy_paint(ctx, "foliage", int(sw)), scale=(sx, sy, sz), subdivisions=BLOB_SUBDIV, wobble=CANOPY_WOBBLE, flatten_below=0.0)
        kind = params["kind"]
        if kind != "plain":
            deco = VariantRng(params["seed"])
            group, idx = ("produce", 0) if kind == "berries" else ("flowers", 5)
            for k in range(9 if kind == "berries" else 7):
                a = deco.uniform(0, 2 * math.pi)
                el = deco.uniform(0.15, 1.2)
                r = 0.34
                p = (0.5 + r * math.cos(a) * math.cos(el), 0.5 + r * math.sin(a) * math.cos(el), 0.28 + r * 0.9 * math.sin(el))
                size = 0.035 if kind == "berries" else 0.07
                c.blob(p, size, self.canopy_paint(ctx, group, idx + (k % 2 if kind == "flowering" else 0)), subdivisions=1, wobble=0.05)
        return [c.to_object(ctx.collection, part="canopy", origin=(0.5, 0.5, 0.0))]


@register
class Flowers(Plant):
    """A patch of flowers (tulips, daisies or mixed wildflowers) for beds and verges."""

    id = "flowers"
    footprint = Footprint(w=1, d=1, h=0.6)
    max_overhang_m = 0.0
    tags = ("vegetation", "flowers", "canopy")
    sockets = ()

    def variant_params(self, style, variant, rng):
        kind = pick(rng, ("tulips", "daisies", "wild"), variant)
        spots = scatter(rng, 8, lambda x, y: True, (0.14, 0.14), (0.86, 0.86), 0.16)
        heads = [[x, y, _r(rng.uniform(0.22, 0.38)), rng.randint(0, 5)] for x, y in spots]
        return {"kind": kind, "heads": heads, "bed": variant == 2}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        c = ctx.builder(self, variant, rng, "canopy")
        stem = self.canopy_paint(ctx, "foliage", 1)
        kind = params["kind"]
        objects = []
        for x, y, h, sw in params["heads"]:
            c.solid(solids.tube([(x + 0.01, y, 0.0), (x + 0.01, y, h)], [0.012, 0.009], sides=3), stem, bevel=0.0, noise=0.0)
            for side in (-1, 1):
                spine = [(x, y, 0.03), (x + side * 0.05, y + 0.01, 0.09), (x + side * 0.08, y + 0.02, 0.14)]
                c.solid(solids.leaf(spine, [0.01, 0.035, 0.005], thickness=0.01), stem, bevel=0.0, noise=0.0, recalc_normals=True)
            if kind == "tulips":
                petals = self.canopy_paint(ctx, "flowers", (0, 1, 4, 2)[int(sw) % 4])
                c.cylinder((x + 0.01, y, h - 0.01), 0.03, 0.075, petals, sides=6, radius_top=0.045, bevel=0.0, noise=0.0)
            elif kind == "daisies":
                c.cylinder((x + 0.01, y, h), 0.055, 0.012, self.canopy_paint(ctx, "flowers", 3), sides=8, bevel=0.0, noise=0.0)
                c.blob((x + 0.01, y, h + 0.015), 0.02, self.canopy_paint(ctx, "flowers", 1), subdivisions=1, wobble=0.0)
            else:
                c.blob((x + 0.01, y, h + 0.02), 0.035, self.canopy_paint(ctx, "flowers", int(sw)), subdivisions=1, wobble=0.1)
        objects.append(c.to_object(ctx.collection, part="canopy"))
        if params["bed"]:
            soil = ctx.builder(self, variant, rng, "bed")
            soil.box((0.06, 0.06, 0.0), (0.94, 0.94, 0.04), ctx.paint("earth", 1, tile="dirt"), bevel=0.015, segments=1)
            stone = ctx.paint("stone", 1, tile="stone")
            for lo, hi in (((0.0, 0.0), (1.0, 0.07)), ((0.0, 0.93), (1.0, 1.0)), ((0.0, 0.07), (0.07, 0.93)), ((0.93, 0.07), (1.0, 0.93))):
                soil.box((lo[0], lo[1], 0.0), (hi[0], hi[1], 0.08), stone, bevel=0.015, segments=1)
            objects.append(soil.to_object(ctx.collection, part="bed"))
        return objects


TREE_IDS = ("tree.conifer", "tree.cypress", "tree.deciduous", "tree.olive", "tree.palm", "tree.sakura")
VEGETATION_IDS = TREE_IDS + ("bush", "flowers")
