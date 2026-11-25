"""Shape recipes for characters (pure Python).

Character generators (``hvchars``) describe a mesh as a list of soft primitives: ellipsoids,
capsules, cones, cylinders, rounded boxes and tori, each with a material slot, a colour and,
on the skinned body, the bone it follows. ``hvkit.blender.charmesh`` turns a
:class:`ShapeSet` into one Blender mesh; tests can inspect the recipe without Blender.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

from .character import MATERIAL_SLOTS
from .color import RGBA, hex_to_linear_rgba
from .grid import Vec3

WHITE = "#ffffff"


@dataclass(frozen=True)
class Shape:
    kind: str
    """ellipsoid, capsule, cone, cylinder, box or torus."""
    slot: str
    colour: RGBA
    bone: Optional[str] = None
    center: Vec3 = (0.0, 0.0, 0.0)
    radii: Vec3 = (1.0, 1.0, 1.0)
    """Ellipsoid radii, box half sizes, or (major, minor, depth scale) for a torus."""
    rot: Vec3 = (0.0, 0.0, 0.0)
    """Euler XYZ degrees (ellipsoid, box, torus)."""
    a: Vec3 = (0.0, 0.0, 0.0)
    b: Vec3 = (0.0, 0.0, 0.0)
    """Capsule, cone and cylinder end points (cone: base ``a``, tip ``b``)."""
    r1: float = 0.0
    r2: float = 0.0
    squash: float = 1.0
    """Cone/cylinder/capsule cross-section scale along the shape's local Y (flat ears)."""
    detail: int = 2
    """Ellipsoid icosphere subdivisions; segments for the others."""
    smooth: bool = True
    jitter: float = 0.04
    """Per-vertex brightness variation (the hand-painted look)."""

    def estimated_tris(self) -> int:
        if self.kind == "ellipsoid":
            return 20 * 4 ** (max(1, self.detail) - 1)
        if self.kind == "capsule":
            u, v = self.segments()
            return 2 * u * (v - 1)
        if self.kind in ("cone", "cylinder"):
            s = self.segments()[0]
            return 4 * s - 4
        if self.kind == "box":
            return 12 if self.detail <= 1 else 12 + 24 * self.detail
        if self.kind == "torus":
            major, minor = self.segments()
            return 2 * major * minor
        raise ValueError(f"unknown shape kind {self.kind!r}")

    def segments(self) -> Tuple[int, int]:
        if self.kind == "capsule":
            return (max(6, self.detail * 4), 6)
        if self.kind == "torus":
            return (max(8, self.detail * 6), 6)
        return (max(3, self.detail), 0)


@dataclass
class ShapeSet:
    """The shapes of one mesh object (a body, a head, a tail or an outfit piece)."""

    name: str
    shapes: List[Shape] = field(default_factory=list)
    bone: Optional[str] = None
    """Default bone for shapes added without one (skinned body only)."""

    def _add(self, kind: str, slot: str, colour: Optional[str], bone: Optional[str], **kw) -> "ShapeSet":
        if slot not in MATERIAL_SLOTS:
            raise ValueError(f"{self.name}: unknown material slot {slot!r}")
        tint = MATERIAL_SLOTS[slot]
        if tint and colour is not None and colour.lower() != WHITE and not colour.startswith("~"):
            raise ValueError(f"{self.name}: tintable slot {slot!r} takes a shade (~0.8), not a colour")
        rgba = _colour(colour)
        self.shapes.append(Shape(kind=kind, slot=slot, colour=rgba, bone=bone or self.bone, **kw))
        return self

    def ellipsoid(self, center: Vec3, radii, slot: str, colour: Optional[str] = None, rot: Vec3 = (0, 0, 0), detail: int = 2, bone: Optional[str] = None, smooth: bool = True) -> "ShapeSet":
        if isinstance(radii, (int, float)):
            radii = (radii, radii, radii)
        return self._add("ellipsoid", slot, colour, bone, center=tuple(center), radii=tuple(radii), rot=tuple(rot), detail=detail, smooth=smooth)

    def capsule(self, a: Vec3, b: Vec3, r1: float, slot: str, colour: Optional[str] = None, r2: Optional[float] = None, squash: float = 1.0, detail: int = 3, bone: Optional[str] = None) -> "ShapeSet":
        return self._add("capsule", slot, colour, bone, a=tuple(a), b=tuple(b), r1=r1, r2=r1 if r2 is None else r2, squash=squash, detail=detail)

    def cone(self, base: Vec3, tip: Vec3, r: float, slot: str, colour: Optional[str] = None, squash: float = 1.0, sides: int = 8, bone: Optional[str] = None, smooth: bool = True) -> "ShapeSet":
        return self._add("cone", slot, colour, bone, a=tuple(base), b=tuple(tip), r1=r, r2=0.0, squash=squash, detail=sides, smooth=smooth)

    def cylinder(self, base: Vec3, top: Vec3, r: float, slot: str, colour: Optional[str] = None, r_top: Optional[float] = None, squash: float = 1.0, sides: int = 12, bone: Optional[str] = None, smooth: bool = True) -> "ShapeSet":
        return self._add("cylinder", slot, colour, bone, a=tuple(base), b=tuple(top), r1=r, r2=r if r_top is None else r_top, squash=squash, detail=sides, smooth=smooth)

    def box(self, center: Vec3, half: Vec3, slot: str, colour: Optional[str] = None, rot: Vec3 = (0, 0, 0), bevel: int = 1, bone: Optional[str] = None) -> "ShapeSet":
        """A box with ``half`` sizes; ``bevel`` segments round its edges (0 = sharp)."""
        return self._add("box", slot, colour, bone, center=tuple(center), radii=tuple(half), rot=tuple(rot), detail=bevel, smooth=bevel > 0)

    def torus(self, center: Vec3, major: float, minor: float, slot: str, colour: Optional[str] = None, rot: Vec3 = (0, 0, 0), stretch: float = 1.0, detail: int = 2, bone: Optional[str] = None) -> "ShapeSet":
        """A ring around the local Z axis; ``stretch`` scales the ring along local Y (an
        oval sash around the torso)."""
        return self._add("torus", slot, colour, bone, center=tuple(center), radii=(major, minor, stretch), rot=tuple(rot), detail=detail)

    def chain(self, points: Sequence[Vec3], r: float, slot: str, colour: Optional[str] = None, r_end: Optional[float] = None, colours: Optional[Sequence[str]] = None, detail: int = 3) -> "ShapeSet":
        """Capsules through ``points`` (a curled tail, a smile), tapering to ``r_end``.
        ``colours`` alternates colours per segment (ringed tails); with a tintable slot,
        use shades like ``~0.7``."""
        n = len(points) - 1
        end = r if r_end is None else r_end
        for i in range(n):
            ra = r + (end - r) * i / n
            rb = r + (end - r) * (i + 1) / n
            c = colours[i % len(colours)] if colours else colour
            self.capsule(points[i], points[i + 1], ra, slot, c, r2=rb, detail=detail)
        return self

    def mirrored(self, fn) -> "ShapeSet":
        """Call ``fn(sign)`` for the left (+1, +X) and right (-1) side."""
        fn(1.0)
        fn(-1.0)
        return self

    @property
    def slots(self) -> List[str]:
        seen: List[str] = []
        for s in self.shapes:
            if s.slot not in seen:
                seen.append(s.slot)
        return seen

    def estimated_tris(self) -> int:
        return sum(s.estimated_tris() for s in self.shapes)


@dataclass
class Part:
    """One exported node: shapes authored relative to the socket they attach to."""

    name: str
    socket: str
    shapes: ShapeSet
    default: bool = True
    """Optional parts (floppy ears, antlers, flippers...) the client shows on request are
    ``False``; alternatives like upright ears are ``True``."""


def _colour(value: Optional[str]) -> RGBA:
    """``None`` or ``#ffffff`` = white; ``~0.7`` = a grey shade (darker fur on a tinted slot);
    anything else is an sRGB hex colour."""
    if value is None:
        return (1.0, 1.0, 1.0, 1.0)
    if value.startswith("~"):
        k = float(value[1:])
        if not 0.0 < k <= 1.0:
            raise ValueError(f"shade must be in (0, 1], got {value!r}")
        return (k, k, k, 1.0)
    return hex_to_linear_rgba(value)
