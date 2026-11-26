"""Generic style-neutral props: rocks, crates, barrels, baskets, the notice board and the
market stall. They stand on the ground (z = 0) with the front at y = 0."""

from __future__ import annotations

import math
from typing import Any, Dict, List

from hvkit.grid import Footprint
from hvkit.module import Socket, register
from hvkit.variants import VariantRng

from .base import CommonModule, pick, scatter


@register
class Rock(CommonModule):
    """Faceted rocks: a boulder, a cluster, or flat stones with moss."""

    id = "rock"
    footprint = Footprint(w=1, d=1, h=0.8)
    tags = ("prop", "rock", "nature")
    sockets = (Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("boulder", "cluster", "flat"), variant), "stone": pick(rng, (1, 2, 0), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        stone = ctx.paint("stone", params["stone"], tile="stone")
        r = VariantRng(params["seed"])
        kind = params["kind"]
        if kind == "boulder":
            b.blob((0.5, 0.5, 0.16), 0.34, stone, scale=(1.15, 1.0, 0.95), subdivisions=2, wobble=0.12, smooth=False, flatten_below=0.0)
            b.blob((0.78, 0.3, 0.05), 0.12, stone, scale=(1.2, 1.0, 0.8), wobble=0.15, smooth=False, flatten_below=0.0)
        elif kind == "cluster":
            for (x, y), rad in zip(((0.42, 0.55), (0.7, 0.4), (0.3, 0.28)), (0.26, 0.18, 0.13)):
                b.blob((x, y, rad * 0.4), rad, stone, scale=(1.1, 1.0, 0.9), subdivisions=1, wobble=0.18, smooth=False, flatten_below=0.0)
        else:
            for x, y in scatter(r, 4, lambda x, y: True, (0.2, 0.2), (0.8, 0.8), 0.28):
                b.blob((x, y, 0.02), r.uniform(0.12, 0.17), stone, scale=(1.3, 1.0, 0.35), wobble=0.12, smooth=False, flatten_below=0.0)
            b.blob((0.25, 0.75, 0.02), 0.1, ctx.paint("foliage", 3, tile="leaves"), scale=(1.5, 1.1, 0.4), wobble=0.15, flatten_below=0.0)
        return [b.to_object(ctx.collection)]


def _crate(ctx, b, lo, hi, paint, frame, angle: float = 0.0) -> None:
    """A slatted wooden crate: a body box with a darker frame on its edges."""
    from hvkit import solids

    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2

    def put(a, c, p, bevel=0.012):
        solid = solids.box(a, c)
        if angle:
            solid = solids.rotate_z(solid, angle, (cx, cy, 0.0))
        b.solid(solid, p, bevel=bevel, segments=1)

    put(lo, hi, paint, bevel=0.015)
    t = 0.035
    for x0, x1 in ((lo[0] - 0.005, lo[0] + t), (hi[0] - t, hi[0] + 0.005)):
        for y0, y1 in ((lo[1] - 0.005, lo[1] + t), (hi[1] - t, hi[1] + 0.005)):
            put((x0, y0, lo[2]), (x1, y1, hi[2]), frame)
    mid = (lo[2] + hi[2]) / 2
    for y0, y1 in ((lo[1] - 0.008, lo[1]), (hi[1], hi[1] + 0.008)):
        put((lo[0] + t, y0, mid - 0.03), (hi[0] - t, y1, mid + 0.03), frame)


@register
class Crate(CommonModule):
    """Wooden crates: one closed crate, a stack of two, or an open crate of produce."""

    id = "crate"
    footprint = Footprint(w=1, d=1, h=1.2)
    tags = ("prop", "container", "market")
    sockets = (Socket("top", "stack", (0.5, 0.5, 0.55), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {
            "kind": pick(rng, ("single", "stack", "produce"), variant),
            "wood": pick(rng, (0, 1, 2), variant),
            "turn": round(rng.uniform(0.2, 0.45), 3),
            "produce": rng.randint(0, 4),
        }

    def build(self, ctx, variant, params, rng):
        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        frame = ctx.paint("wood", (params["wood"] + 1) % 3, tile="wood")
        _crate(ctx, b, (0.2, 0.2, 0.0), (0.8, 0.8, 0.55), wood, frame)
        if params["kind"] == "stack":
            _crate(ctx, b, (0.3, 0.3, 0.55), (0.72, 0.72, 0.95), frame, wood, angle=params["turn"])
        elif params["kind"] == "produce":
            fruit = ctx.paint("produce", params["produce"], tile="plain")
            for i in range(3):
                for j in range(3):
                    x, y = 0.32 + 0.18 * i + rng.jitter(0.01), 0.32 + 0.18 * j + rng.jitter(0.01)
                    b.blob((x, y, 0.56), 0.075, fruit, subdivisions=1, wobble=0.05)
        return [b.to_object(ctx.collection)]


@register
class Barrel(CommonModule):
    """Wooden barrels with iron hoops: upright, lidded with a cup on top, or lying down."""

    id = "barrel"
    footprint = Footprint(w=1, d=1, h=1.0)
    tags = ("prop", "container", "market")
    sockets = (Socket("top", "stack", (0.5, 0.5, 0.8), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("upright", "lidded", "lying"), variant), "wood": pick(rng, (1, 0, 2), variant)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        iron = ctx.paint("iron", 0, tile="plain")
        rs = (0.24, 0.29, 0.3, 0.29, 0.24)
        if params["kind"] == "lying":
            xs = (0.15, 0.3, 0.5, 0.7, 0.85)
            pts = [(x, 0.5, 0.3) for x in xs]
            b.solid(solids.tube(pts, list(rs), sides=10), wood, bevel=0.0, smooth=True)
            for x, r in ((0.22, 0.265), (0.78, 0.265)):
                b.solid(solids.tube([(x - 0.02, 0.5, 0.3), (x + 0.02, 0.5, 0.3)], [r + 0.01, r + 0.01], sides=10), iron, bevel=0.0)
            for y in (0.28, 0.72):
                b.box((0.3, y - 0.05, 0.0), (0.7, y + 0.05, 0.07), ctx.paint("darkwood", 0, tile="wood"), bevel=0.01, segments=1)
            return [b.to_object(ctx.collection)]
        zs = (0.0, 0.18, 0.4, 0.62, 0.8)
        pts = [(0.5, 0.5, z) for z in zs]
        b.solid(solids.tube(pts, list(rs), sides=10), wood, bevel=0.0, smooth=True)
        for z, r in ((0.09, 0.27), (0.71, 0.27), (0.4, 0.305)):
            b.cylinder((0.5, 0.5, z - 0.02), r + 0.008, 0.04, iron, sides=10, bevel=0.0, noise=0.0)
        if params["kind"] == "lidded":
            b.cylinder((0.5, 0.5, 0.8), 0.25, 0.04, ctx.paint("darkwood", 0, tile="wood"), sides=10, bevel=0.01, segments=1)
            b.cylinder((0.55, 0.45, 0.84), 0.05, 0.08, ctx.paint("fabric", 0, tile="plain"), sides=8, radius_top=0.055, bevel=0.0)
        return [b.to_object(ctx.collection)]


@register
class Basket(CommonModule):
    """A wicker basket with a handle, full of apples, bread or fish."""

    id = "basket"
    footprint = Footprint(w=1, d=1, h=0.7)
    tags = ("prop", "container", "market")
    sockets = (Socket("base", "prop", (0.5, 0.5, 0.0), (0.0, 0.0, 1.0)),)

    def variant_params(self, style, variant, rng):
        return {"goods": pick(rng, ("apples", "bread", "fish"), variant), "wood": pick(rng, (2, 0, 1), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        wicker = ctx.paint("wood", params["wood"], tile="wood")
        b.cylinder((0.5, 0.5, 0.0), 0.2, 0.22, wicker, sides=10, radius_top=0.26, bevel=0.0)
        b.cylinder((0.5, 0.5, 0.2), 0.27, 0.04, ctx.paint("wood", (params["wood"] + 1) % 3, tile="wood"), sides=10, bevel=0.0)
        handle = [(0.5 + 0.24 * math.cos(a), 0.5, 0.22 + 0.24 * math.sin(a)) for a in (math.pi * k / 8 for k in range(9))]
        b.solid(solids.tube(handle, [0.015] * len(handle), sides=4, caps=True), wicker, bevel=0.0)
        r = VariantRng(params["seed"])
        goods = params["goods"]
        spots = scatter(r, 6, lambda x, y: math.hypot(x - 0.5, y - 0.5) < 0.17, (0.3, 0.3), (0.7, 0.7), 0.09)
        for x, y in spots:
            if goods == "apples":
                b.blob((x, y, 0.25), 0.06, ctx.paint("produce", r.randint(0, 2), tile="plain"), subdivisions=1, wobble=0.05)
            elif goods == "bread":
                b.blob((x, y, 0.26), 0.07, ctx.paint("produce", 4, tile="plain"), scale=(1.5, 0.9, 0.8), subdivisions=1, wobble=0.05)
            else:
                b.blob((x, y, 0.25), 0.05, ctx.paint("water", 1, tile="plain"), scale=(2.0, 0.7, 0.6), subdivisions=1, wobble=0.03)
        return [b.to_object(ctx.collection)]


@register
class NoticeBoard(CommonModule):
    """The town notice board (GDD §2): a framed board on two posts with pinned notes. ``board``
    is where the client shows the village notices (TODO(M30): the Town Hall requests)."""

    id = "notice_board"
    footprint = Footprint(w=2, d=1, h=2.4)
    tags = ("prop", "square", "interactive")
    sockets = (
        Socket("board", "attach", (1.0, 0.43, 1.3), (0.0, -1.0, 0.0)),
        Socket("stand", "prop", (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {"kind": pick(rng, ("roofed", "framed", "chalk"), variant), "wood": pick(rng, (1, 0, 2), variant), "seed": rng.randint(0, 9999)}

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        dark = ctx.paint("darkwood", 0, tile="wood")
        kind = params["kind"]
        post_h = 2.05 if kind == "roofed" else 1.85
        for x in (0.2, 1.7):
            b.box((x, 0.42, 0.0), (x + 0.1, 0.58, post_h), dark, bevel=0.015, segments=1)
        board = ctx.paint("darkwood", 1, tile="wood") if kind == "chalk" else ctx.paint("wood", (params["wood"] + 1) % 3, tile="wood")
        b.box((0.3, 0.46, 0.8), (1.7, 0.54, 1.8), board, bevel=0.0)
        for lo, hi in (((0.26, 0.44, 0.76), (1.74, 0.56, 0.82)), ((0.26, 0.44, 1.78), (1.74, 0.56, 1.84))):
            b.box(lo, hi, wood, bevel=0.01, segments=1)
        r = VariantRng(params["seed"])
        if kind == "chalk":
            chalk = ctx.paint("paper", 0, tile="plain")
            for i in range(4):
                z = 1.6 - 0.18 * i
                b.box((0.42, 0.445, z), (0.42 + r.uniform(0.6, 1.1), 0.46, z + 0.03), chalk, bevel=0.0, noise=0.0)
        else:
            for i in range(5):
                x = 0.38 + i * 0.25 + r.jitter(0.03)
                z = 0.95 + r.uniform(0.0, 0.45)
                w, h = r.uniform(0.16, 0.22), r.uniform(0.2, 0.3)
                b.box((x, 0.445, z), (x + w, 0.46, z + h), ctx.paint("paper", i % 3, tile="plain"), bevel=0.0, noise=0.0)
                b.blob((x + w / 2, 0.44, z + h - 0.03), 0.015, ctx.paint("produce", i % 5, tile="plain"), subdivisions=1, wobble=0.0)
        if kind == "roofed":
            roof = ctx.paint("darkwood", 1, tile="wood")
            for side in (0, 1):
                y0, y1 = (0.2, 0.5) if side == 0 else (0.5, 0.8)
                z0, z1 = (post_h, post_h + 0.25) if side == 0 else (post_h + 0.25, post_h)
                prof = [(y0, z0), (y1, z1), (y1, z1 + 0.05), (y0, z0 + 0.05)]
                b.solid(solids.prism(prof, "x", 0.1, 1.9), roof, bevel=0.01, segments=1)
        else:
            b.box((0.15, 0.4, post_h), (1.85, 0.6, post_h + 0.06), wood, bevel=0.015, segments=1)
        return [b.to_object(ctx.collection)]


@register
class MarketStall(CommonModule):
    """A 2 x 2 market stall with a striped canopy over a counter of goods. ``vendor`` is where
    the seller stands; ``counter`` is the front of the counter where players trade."""

    id = "market_stall"
    footprint = Footprint(w=2, d=2, h=2.6)
    tags = ("prop", "market", "interactive")
    sockets = (
        Socket("vendor", "prop", (1.0, 1.3, 0.0), (0.0, -1.0, 0.0)),
        Socket("counter", "prop", (1.0, 0.25, 0.9), (0.0, -1.0, 0.0)),
    )

    def variant_params(self, style, variant, rng):
        return {
            "stripes": pick(rng, ((0, 1), (0, 2), (0, 3)), variant),
            "goods": pick(rng, ("fruit", "bread", "flowers"), variant),
            "wood": pick(rng, (0, 1, 2), variant),
        }

    def build(self, ctx, variant, params, rng):
        from hvkit import solids

        b = ctx.builder(self, variant, rng)
        wood = ctx.paint("wood", params["wood"], tile="wood")
        dark = ctx.paint("darkwood", 0, tile="wood")
        # Counter, top and shelf.
        b.box((0.15, 0.3, 0.0), (1.85, 0.8, 0.85), wood, bevel=0.02, segments=1)
        b.box((0.1, 0.25, 0.85), (1.9, 0.85, 0.92), dark, bevel=0.015, segments=1)
        # Posts: front shorter than back, so the canopy slopes forward.
        front_h, back_h = 2.05, 2.35
        for x in (0.12, 1.8):
            b.box((x, 0.28, 0.0), (x + 0.08, 0.36, front_h), dark, bevel=0.01, segments=1)
            b.box((x, 1.72, 0.0), (x + 0.08, 1.8, back_h), dark, bevel=0.01, segments=1)
        # Striped canopy: alternating strips from front (y = 0.05) to back (y = 1.95).
        a, c = params["stripes"]
        n = 8
        y0, y1 = 0.05, 1.95
        z0 = front_h - (back_h - front_h) * (0.32 - y0) / (1.76 - 0.32)
        z1 = back_h + (back_h - front_h) * (y1 - 1.76) / (1.76 - 0.32)
        for i in range(n):
            xa, xb = 0.05 + 1.9 * i / n, 0.05 + 1.9 * (i + 1) / n
            cloth = ctx.paint("fabric", a if i % 2 == 0 else c, tile="plain")
            prof = [(y0, z0), (y1, z1), (y1, z1 + 0.04), (y0, z0 + 0.04)]
            b.solid(solids.prism(prof, "x", xa, xb), cloth, bevel=0.0)
            # Scalloped valance along the front edge.
            b.box((xa + 0.01, y0, z0 - 0.16), (xb - 0.01, y0 + 0.02, z0 + 0.02), cloth, bevel=0.0)
            b.blob(((xa + xb) / 2, y0 + 0.01, z0 - 0.16), 0.11, cloth, scale=(1.0, 0.12, 0.5), subdivisions=1, wobble=0.0)
        goods = params["goods"]
        for k, x in enumerate((0.35, 0.8, 1.25)):
            box_paint = ctx.paint("wood", (params["wood"] + 1 + k) % 3, tile="wood")
            b.box((x, 0.35, 0.92), (x + 0.38, 0.75, 1.02), box_paint, bevel=0.01, segments=1)
            for i in range(3):
                for j in range(2):
                    px, py = x + 0.08 + 0.11 * i, 0.47 + 0.15 * j
                    if goods == "fruit":
                        b.blob((px, py, 1.05), 0.055, ctx.paint("produce", k + (i + j) % 2, tile="plain"), subdivisions=1, wobble=0.05)
                    elif goods == "bread":
                        b.blob((px, py, 1.06), 0.06, ctx.paint("produce", 4, tile="plain"), scale=(1.4, 0.9, 0.75), subdivisions=1, wobble=0.05)
                    else:
                        b.blob((px, py, 1.08), 0.05, ctx.paint("flowers", (k + i + j) % 6, tile="plain"), subdivisions=1, wobble=0.1)
        # A price board on the counter front.
        b.box((0.7, 0.26, 0.45), (1.3, 0.3, 0.75), ctx.paint("paper", 1, tile="plain"), bevel=0.01, segments=1)
        return [b.to_object(ctx.collection)]


PROP_IDS = ("barrel", "basket", "crate", "market_stall", "notice_board", "rock")
