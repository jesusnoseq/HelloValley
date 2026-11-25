"""The 16 animal heads (GDD §3.2) with their tails and optional parts.

Every head is authored relative to the ``head`` socket (the neck top) in Blender axes (Z up,
facing -Y): a skull of about 0.5 m (so the body reads ~2.4 heads tall), dot eyes with a
highlight (``eyes`` slot), ears and features in ``fur`` (tinted per player, GDD §3.2 natural
tints) and fixed-colour ``markings`` (muzzles, masks, inner ears, beaks). Tails are authored
relative to the ``tail`` socket and point back (+Y). Each head also places the head sockets
(``hat``, ``face``, ``ear_l``, ``ear_r``) for NPC outfit pieces.

Animal ids mirror ``ANIMALS`` in packages/shared/src/data/animals.ts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Dict, List, Sequence, Tuple

from hvkit.charshapes import Part, ShapeSet
from hvkit.grid import Vec3

WHITE_FUR = "#f7f3ec"
CREAM = "#f1e2c8"
PINK = "#eba5ad"
NOSE = "#3a302d"
DARK = "#3b3533"
IRIS = "#2b2321"
HIGHLIGHT = "#ffffff"


@dataclass(frozen=True)
class Skull:
    c: Vec3 = (0.0, 0.0, 0.24)
    r: Vec3 = (0.25, 0.23, 0.23)

    def front(self, x: float, z: float) -> float:
        """Y of the skull's front surface at (x, z) (the face is at -Y)."""
        k = 1.0 - (x / self.r[0]) ** 2 - ((z - self.c[2]) / self.r[2]) ** 2
        return self.c[1] - self.r[1] * math.sqrt(max(0.0, k))

    @property
    def top(self) -> float:
        return self.c[2] + self.r[2]


@dataclass
class AnimalBuild:
    parts: List[Part]
    sockets: Dict[str, Vec3]
    """Head sockets, relative to the head origin."""


def _front(ellipsoids: Sequence[Tuple[Vec3, Vec3]], x: float, z: float) -> float:
    """Front-most surface Y at (x, z) over several ellipsoids (centre, radii)."""
    best = 0.0
    for c, r in ellipsoids:
        k = 1.0 - ((x - c[0]) / r[0]) ** 2 - ((z - c[2]) / r[2]) ** 2
        if k > 0:
            best = min(best, c[1] - r[1] * math.sqrt(k))
    return best


class Head:
    """Builder for one head: the skull, eyes and sockets common to every animal."""

    def __init__(self, animal: str, skull: Skull = Skull(), eye_x: float = 0.085, eye_z: float = 0.26, eye_scale: float = 1.0, shade: str = None):
        self.animal = animal
        self.skull = skull
        self.s = ShapeSet(f"{animal}.head")
        self.s.ellipsoid(skull.c, skull.r, "fur", shade, detail=3)
        self.faces: List[Tuple[Vec3, Vec3]] = [(skull.c, skull.r)]
        self.eye_x, self.eye_z, self.eye_scale = eye_x, eye_z, eye_scale
        self.extra: List[Part] = []
        self.tail: ShapeSet = ShapeSet(f"{animal}.tail")

    def face(self, center: Vec3, radii: Vec3, slot: str = "markings", colour: str = CREAM, detail: int = 2) -> "Head":
        """A face feature that also counts as surface for the eyes (a muzzle, a facial disc)."""
        self.s.ellipsoid(center, radii, slot, colour if slot == "markings" else None, detail=detail)
        self.faces.append((center, radii))
        return self

    def front(self, x: float, z: float) -> float:
        return _front(self.faces, x, z)

    def on_face(self, x: float, z: float, out: float = 0.0) -> Vec3:
        return (x, self.front(x, z) - out, z)

    def nose(self, z: float, radii: Vec3 = (0.028, 0.018, 0.02), colour: str = NOSE, y: float = None) -> "Head":
        pos = (0.0, self.front(0.0, z) if y is None else y, z)
        self.s.ellipsoid(pos, radii, "markings", colour)
        return self

    def eyes(self) -> None:
        k = self.eye_scale
        for sign in (1.0, -1.0):
            x = sign * self.eye_x
            px, py, pz = self.on_face(x, self.eye_z, out=-0.006 * k)
            self.s.ellipsoid((px, py, pz), (0.03 * k, 0.018 * k, 0.04 * k), "eyes", IRIS)
            self.s.ellipsoid((px + sign * 0.009 * k, py - 0.016 * k, pz + 0.016 * k), 0.011 * k, "eyes", HIGHLIGHT, detail=1)

    def build(self) -> AnimalBuild:
        self.eyes()
        sk = self.skull
        sockets = {
            "hat": (0.0, sk.c[1], sk.top - 0.02),
            "face": (0.0, self.front(0.0, self.eye_z), self.eye_z),
            "ear_l": (sk.r[0] - 0.01, sk.c[1], sk.c[2] - 0.02),
            "ear_r": (-(sk.r[0] - 0.01), sk.c[1], sk.c[2] - 0.02),
        }
        parts = [Part("head", "head", self.s)]
        if self.tail.shapes:
            parts.append(Part("tail", "tail", self.tail))
        return AnimalBuild(parts + self.extra, sockets)

    def part(self, name: str, socket: str = "head", default: bool = True) -> ShapeSet:
        shapes = ShapeSet(f"{self.animal}.{name}")
        self.extra.append(Part(name, socket, shapes, default))
        return shapes


def _ears_cone(s: ShapeSet, base: Vec3, tip: Vec3, r: float, inner: str = CREAM, squash: float = 0.45) -> None:
    def one(sign: float) -> None:
        b = (sign * base[0], base[1], base[2])
        t = (sign * tip[0], tip[1], tip[2])
        s.cone(b, t, r, "fur", squash=squash)
        ib = (b[0] + sign * 0.003, b[1] - 0.022, b[2] + 0.015)
        it = (t[0] - sign * 0.008, t[1] - 0.018, t[2] - 0.035)
        s.cone(ib, it, r * 0.6, "markings", inner, squash=squash * 0.6)

    s.mirrored(one)


def _ears_round(s: ShapeSet, center: Vec3, radii: Vec3, inner: str = CREAM) -> None:
    def one(sign: float) -> None:
        c = (sign * center[0], center[1], center[2])
        s.ellipsoid(c, radii, "fur")
        s.ellipsoid((c[0], c[1] - radii[1] * 0.75, c[2]), (radii[0] * 0.6, radii[1] * 0.3, radii[2] * 0.6), "markings", inner)

    s.mirrored(one)


# --- animals ---------------------------------------------------------------------------------


def fox() -> AnimalBuild:
    h = Head("fox", Skull(r=(0.25, 0.22, 0.22)), eye_z=0.27)
    h.face((0.0, -0.14, 0.15), (0.17, 0.1, 0.085), colour=WHITE_FUR)
    h.face((0.0, -0.2, 0.18), (0.075, 0.115, 0.06), slot="fur")
    h.nose(0.19, (0.024, 0.02, 0.02), y=-0.312)
    _ears_cone(h.s, (0.12, 0.0, 0.38), (0.18, 0.0, 0.56), 0.085, inner=WHITE_FUR)
    h.tail.capsule((0.0, 0.0, 0.0), (0.0, 0.2, 0.12), 0.055, "fur", r2=0.105)
    h.tail.ellipsoid((0.0, 0.27, 0.165), (0.085, 0.09, 0.085), "markings", WHITE_FUR)
    return h.build()


def rabbit() -> AnimalBuild:
    h = Head("rabbit", Skull(r=(0.25, 0.23, 0.23)), eye_z=0.27)
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.055, 0.18, out=-0.03), (0.06, 0.05, 0.05), "markings", WHITE_FUR))
    h.nose(0.215, (0.024, 0.015, 0.017), colour=PINK, y=h.front(0.0, 0.215) - 0.02)

    def ear(s: ShapeSet, center: Vec3, rot: Vec3) -> None:
        s.ellipsoid(center, (0.05, 0.032, 0.17), "fur", rot=rot)
        s.ellipsoid((center[0], center[1] - 0.024, center[2]), (0.03, 0.012, 0.13), "markings", PINK, rot=rot)

    upright = h.part("ears_upright")
    upright.mirrored(lambda s: ear(upright, (s * 0.085, 0.02, 0.55), (0.0, s * 10.0, 0.0)))
    floppy = h.part("ears_floppy", default=False)
    floppy.mirrored(lambda s: ear(floppy, (s * 0.255, 0.03, 0.27), (0.0, -s * 25.0, 0.0)))
    h.tail.ellipsoid((0.0, 0.03, 0.0), 0.055, "markings", WHITE_FUR)
    return h.build()


def cat() -> AnimalBuild:
    h = Head("cat", Skull(r=(0.255, 0.225, 0.22)), eye_x=0.09)
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.045, 0.18, out=-0.025), (0.048, 0.04, 0.038), "markings", WHITE_FUR))
    h.nose(0.21, (0.022, 0.015, 0.015), colour=PINK, y=h.front(0.0, 0.21) - 0.012)
    _ears_cone(h.s, (0.13, 0.0, 0.37), (0.19, 0.0, 0.51), 0.085, inner=PINK)
    tabby = h.part("tabby", default=False)
    for x, tilt in ((0.0, 0.0), (0.065, 14.0), (-0.065, -14.0)):
        z = 0.39 - abs(x) * 0.5
        tabby.ellipsoid(h.on_face(x, z, out=-0.012), (0.018, 0.022, 0.05), "fur", "~0.55", rot=(-35.0, 0.0, tilt))
    h.tail.chain([(0.0, 0.0, 0.0), (0.0, 0.1, 0.02), (0.0, 0.18, 0.1), (0.0, 0.2, 0.22), (0.0, 0.17, 0.3)], 0.036, "fur", r_end=0.03)
    return h.build()


def dog() -> AnimalBuild:
    h = Head("dog", Skull(r=(0.25, 0.225, 0.22)), eye_z=0.27)
    h.face((0.0, -0.2, 0.17), (0.1, 0.085, 0.07))
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.085, 0.335, out=-0.008), (0.022, 0.012, 0.016), "markings", CREAM))
    h.nose(0.2, (0.03, 0.02, 0.022), y=h.front(0.0, 0.2) - 0.012)
    _ears_cone(h.s, (0.13, 0.01, 0.37), (0.17, 0.01, 0.49), 0.075, squash=0.5)
    h.tail.torus((0.0, 0.07, 0.15), 0.075, 0.036, "fur", rot=(0.0, 90.0, 0.0))
    return h.build()


def bear() -> AnimalBuild:
    h = Head("bear", Skull(r=(0.26, 0.235, 0.23)), eye_x=0.095, eye_z=0.27)
    h.face((0.0, -0.2, 0.18), (0.105, 0.08, 0.075), colour="#ead7bb")
    h.nose(0.215, (0.036, 0.022, 0.026), y=h.front(0.0, 0.215) - 0.01)
    _ears_round(h.s, (0.17, 0.0, 0.4), (0.07, 0.04, 0.07), inner="#e3cdb0")
    h.tail.ellipsoid((0.0, 0.025, 0.0), 0.045, "fur")
    return h.build()


def red_panda() -> AnimalBuild:
    h = Head("red_panda", Skull(r=(0.255, 0.225, 0.22)), eye_z=0.27)
    h.face((0.0, -0.2, 0.17), (0.09, 0.075, 0.065), colour=WHITE_FUR)
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.085, 0.335, out=-0.006), (0.036, 0.012, 0.022), "markings", WHITE_FUR))
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.155, 0.2, out=-0.006), (0.045, 0.02, 0.04), "markings", WHITE_FUR))
    h.nose(0.2, (0.026, 0.018, 0.018), y=h.front(0.0, 0.2) - 0.01)
    _ears_cone(h.s, (0.14, 0.0, 0.37), (0.2, 0.0, 0.48), 0.085, inner=WHITE_FUR, squash=0.5)
    h.tail.chain(
        [(0.0, 0.0, 0.0), (0.0, 0.1, 0.03), (0.0, 0.19, 0.1), (0.0, 0.25, 0.2), (0.0, 0.27, 0.3)],
        0.06, "fur", r_end=0.05, colours=["~1.0", "~0.55"],
    )
    return h.build()


def raccoon() -> AnimalBuild:
    h = Head("raccoon", Skull(r=(0.255, 0.225, 0.22)), eye_z=0.255)
    h.face((0.0, -0.165, 0.255), (0.2, 0.075, 0.06), colour=DARK)
    h.face((0.0, -0.2, 0.165), (0.085, 0.075, 0.06), colour=WHITE_FUR)
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.08, 0.33, out=-0.008), (0.04, 0.012, 0.02), "markings", WHITE_FUR))
    h.nose(0.2, (0.026, 0.018, 0.018), y=h.front(0.0, 0.2) - 0.01)
    _ears_cone(h.s, (0.14, 0.0, 0.37), (0.18, 0.0, 0.47), 0.07, inner=WHITE_FUR, squash=0.5)
    h.tail.chain(
        [(0.0, 0.0, 0.0), (0.0, 0.08, 0.0), (0.0, 0.16, 0.04), (0.0, 0.22, 0.11), (0.0, 0.25, 0.19), (0.0, 0.26, 0.27)],
        0.055, "fur", r_end=0.045, colours=["~1.0", "~0.35"],
    )
    return h.build()


def hedgehog() -> AnimalBuild:
    sk = Skull(r=(0.25, 0.22, 0.22))
    h = Head("hedgehog", sk, eye_z=0.26)
    h.face((0.0, -0.1, 0.21), (0.2, 0.135, 0.17), colour="#ecdcc2", detail=3)
    h.face((0.0, -0.235, 0.19), (0.06, 0.07, 0.05), colour="#ecdcc2")
    h.nose(0.2, (0.024, 0.018, 0.018), y=-0.305)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.165, -0.06, 0.39), (0.04, 0.02, 0.035), "markings", "#d9c3a5"))
    rings = ((12.0, (-90.0, -45.0, 0.0, 45.0, 90.0)), (42.0, (-70.0, -23.0, 23.0, 70.0)), (70.0, (-45.0, 45.0)), (85.0, (180.0,)))
    for el, azs in rings:
        for az in azs:
            d = (math.sin(math.radians(az)) * math.cos(math.radians(el)), math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))
            base = tuple(sk.c[i] + d[i] * 0.18 for i in range(3))
            tip = tuple(sk.c[i] + d[i] * 0.33 for i in range(3))
            h.s.cone(base, tip, 0.06, "fur", "~0.55", sides=6)
    return h.build()


def otter() -> AnimalBuild:
    h = Head("otter", Skull(c=(0.0, 0.0, 0.23), r=(0.25, 0.215, 0.21)), eye_z=0.27)
    h.face((0.0, -0.17, 0.13), (0.1, 0.08, 0.06), colour="#e8d6c0")
    h.s.mirrored(lambda s: h.s.ellipsoid(h.on_face(s * 0.04, 0.18, out=-0.03), (0.048, 0.04, 0.04), "markings", "#e8d6c0"))
    h.nose(0.21, (0.032, 0.02, 0.022), y=h.front(0.0, 0.21) - 0.025)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.2, 0.02, 0.36), (0.04, 0.025, 0.035), "fur"))
    h.tail.ellipsoid((0.0, 0.15, -0.07), (0.06, 0.17, 0.025), "fur", rot=(-25.0, 0.0, 0.0))
    return h.build()


def capybara() -> AnimalBuild:
    h = Head("capybara", Skull(c=(0.0, 0.01, 0.24), r=(0.24, 0.24, 0.21)), eye_x=0.11, eye_z=0.32, eye_scale=0.8)
    h.face((0.0, -0.15, 0.2), (0.17, 0.15, 0.135), slot="fur", detail=3)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.045, -0.296, 0.23), (0.013, 0.008, 0.009), "markings", NOSE))
    h.s.ellipsoid((0.0, -0.27, 0.15), (0.06, 0.01, 0.008), "markings", "#6a5444")
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.15, 0.07, 0.42), (0.04, 0.025, 0.035), "fur", "~0.85"))
    orange = h.part("orange", default=False)
    orange.ellipsoid((0.0, 0.02, 0.48), 0.05, "markings", "#f2a03d")
    orange.ellipsoid((0.022, 0.02, 0.534), (0.026, 0.01, 0.012), "markings", "#7fb35a", rot=(0.0, -20.0, 0.0))
    return h.build()


def koala() -> AnimalBuild:
    h = Head("koala", Skull(r=(0.26, 0.23, 0.225)), eye_x=0.1, eye_z=0.27, eye_scale=0.85)
    h.face((0.0, -0.17, 0.13), (0.09, 0.07, 0.05), colour=WHITE_FUR)
    h.nose(0.2, (0.045, 0.035, 0.065), colour=DARK, y=h.front(0.0, 0.2) - 0.01)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.235, 0.03, 0.38), (0.1, 0.05, 0.09), "fur"))
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.24, -0.01, 0.375), (0.065, 0.02, 0.06), "markings", WHITE_FUR))
    return h.build()


def penguin() -> AnimalBuild:
    h = Head("penguin", Skull(r=(0.25, 0.225, 0.225)), eye_x=0.08, eye_z=0.27)
    h.face((0.0, -0.09, 0.21), (0.19, 0.15, 0.16), colour="#f7f5f0", detail=3)
    h.s.cone((0.0, h.front(0.0, 0.21) + 0.02, 0.21), (0.0, -0.33, 0.2), 0.036, "markings", "#f0a347")
    flippers = [h.part(f"flipper_{side}", f"hand_{side}", default=False) for side in ("l", "r")]
    for sign, s in zip((1.0, -1.0), flippers):
        s.ellipsoid((sign * 0.012, 0.0, -0.04), (0.026, 0.065, 0.105), "fur", rot=(0.0, -sign * 12.0, 0.0))
    h.tail.ellipsoid((0.0, 0.03, -0.05), (0.07, 0.05, 0.025), "fur", rot=(-30.0, 0.0, 0.0))
    return h.build()


def owl() -> AnimalBuild:
    h = Head("owl", Skull(r=(0.26, 0.23, 0.23)), eye_x=0.095, eye_z=0.27, eye_scale=1.45)
    h.face((0.0, -0.16, 0.25), (0.21, 0.085, 0.17), colour="#efe2c8", detail=3)
    h.s.cone((0.0, h.front(0.0, 0.215) + 0.015, 0.215), (0.0, -0.275, 0.15), 0.026, "markings", "#e3b04b")
    tufts = lambda sign: h.s.cone((sign * 0.13, 0.0, 0.4), (sign * 0.2, 0.02, 0.53), 0.06, "fur", "~0.8", squash=0.45)  # noqa: E731
    h.s.mirrored(tufts)
    for tilt in (-20.0, 0.0, 20.0):
        h.tail.ellipsoid((math.sin(math.radians(tilt)) * 0.05, 0.05, -0.06), (0.035, 0.03, 0.1), "fur", "~0.85", rot=(-35.0, 0.0, -tilt))
    return h.build()


def frog() -> AnimalBuild:
    sk = Skull(c=(0.0, 0.0, 0.2), r=(0.28, 0.22, 0.19))
    h = Head("frog", sk, eye_x=0.13, eye_z=0.37, eye_scale=1.2)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.13, -0.06, 0.36), (0.085, 0.08, 0.075), "fur"))
    h.faces += [((s * 0.13, -0.06, 0.36), (0.085, 0.08, 0.075)) for s in (1.0, -1.0)]
    h.s.ellipsoid((0.0, -0.1, 0.09), (0.2, 0.13, 0.08), "markings", "#e8efc4")
    xs = [-0.15, -0.075, 0.0, 0.075, 0.15]
    smile = [(x, sk.front(x, 0.15 + 0.035 * (x / 0.15) ** 2) - 0.004, 0.15 + 0.035 * (x / 0.15) ** 2) for x in xs]
    h.s.chain(smile, 0.009, "markings", "#4a3b34", detail=2)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.19, sk.front(s * 0.19, 0.2) + 0.004, 0.2), (0.035, 0.012, 0.025), "markings", "#f2a7a7"))
    return h.build()


def sheep() -> AnimalBuild:
    sk = Skull(r=(0.24, 0.22, 0.22))
    h = Head("sheep", sk, eye_z=0.25, shade="~0.8")  # the face a little darker than the wool
    h.nose(0.19, (0.026, 0.015, 0.016), colour=PINK, y=h.front(0.0, 0.19) - 0.004)
    for d in ((0.0, 0.05, 1.0), (0.5, 0.1, 0.8), (-0.5, 0.1, 0.8), (0.0, -0.5, 0.8), (0.42, 0.55, 0.6), (-0.42, 0.55, 0.6), (0.0, 0.72, 0.6), (0.78, 0.25, 0.4), (-0.78, 0.25, 0.4)):
        n = math.sqrt(sum(c * c for c in d))
        c = tuple(sk.c[i] + d[i] / n * 0.18 for i in range(3))
        h.s.ellipsoid(c, 0.1, "fur", detail=2)
    h.s.mirrored(lambda s: h.s.ellipsoid((s * 0.25, -0.02, 0.27), (0.075, 0.03, 0.035), "fur", "~0.8", rot=(0.0, s * 20.0, 0.0)))
    h.tail.ellipsoid((0.0, 0.03, 0.0), 0.055, "fur")
    return h.build()


def deer() -> AnimalBuild:
    h = Head("deer", Skull(r=(0.245, 0.225, 0.22)), eye_z=0.27)
    h.face((0.0, -0.2, 0.17), (0.085, 0.08, 0.065), colour="#efe1cc")
    h.nose(0.2, (0.03, 0.02, 0.022), y=h.front(0.0, 0.2) - 0.01)

    def ear(sign: float) -> None:
        rot = (0.0, -sign * 25.0, 0.0)
        h.s.ellipsoid((sign * 0.25, 0.02, 0.37), (0.11, 0.03, 0.05), "fur", rot=rot)
        h.s.ellipsoid((sign * 0.255, 0.0, 0.372), (0.075, 0.012, 0.03), "markings", "#f0dcc8", rot=rot)

    h.s.mirrored(ear)
    antlers = h.part("antlers")
    for sign in (1.0, -1.0):
        antlers.chain([(sign * 0.08, 0.0, 0.42), (sign * 0.11, 0.0, 0.52), (sign * 0.1, 0.02, 0.6)], 0.02, "markings", "#a47c55", r_end=0.015)
        antlers.capsule((sign * 0.11, 0.0, 0.52), (sign * 0.17, 0.0, 0.57), 0.016, "markings", "#a47c55", r2=0.012)
    h.tail.ellipsoid((0.0, 0.03, 0.02), (0.04, 0.03, 0.05), "markings", WHITE_FUR)
    return h.build()


ANIMALS: Dict[str, Callable[[], AnimalBuild]] = {
    "fox": fox,
    "rabbit": rabbit,
    "cat": cat,
    "dog": dog,
    "bear": bear,
    "red_panda": red_panda,
    "raccoon": raccoon,
    "hedgehog": hedgehog,
    "otter": otter,
    "capybara": capybara,
    "koala": koala,
    "penguin": penguin,
    "owl": owl,
    "frog": frog,
    "sheep": sheep,
    "deer": deer,
}
ANIMAL_IDS: Tuple[str, ...] = tuple(ANIMALS)


def animal_parts(animal_id: str) -> AnimalBuild:
    try:
        return ANIMALS[animal_id]()
    except KeyError:
        raise KeyError(f"unknown animal {animal_id!r}") from None


def animal_file(animal_id: str) -> str:
    return f"animal.{animal_id}.glb"
