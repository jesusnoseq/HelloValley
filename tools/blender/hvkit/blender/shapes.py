"""Soft low-poly shape builders.

A :class:`MeshBuilder` collects shapes (boxes with rounded bevels, cylinders, blob spheres)
into one mesh object with up to a few material slots. Every shape is painted with a linear
vertex colour (with subtle per-vertex brightness jitter, the "hand-painted" part), gets
box-projected UVs into one atlas tile, and can get a small grid-safe positional noise so
edges look hand-made without opening gaps between neighbouring modules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Matrix, Vector

from ..color import RGBA
from ..grid import Vec3
from ..shaping import grid_safe_jitter, painted_colour, project_face_uvs
from ..variants import VariantRng
from .materials import COLOR_ATTRIBUTE, UV_MAP

if TYPE_CHECKING:  # pragma: no cover
    from .runner import BuildContext


@dataclass(frozen=True)
class Paint:
    color: RGBA
    """Linear RGBA (use StyleParams.linear)."""
    tile: str = "plaster"
    """Atlas tile name."""
    material: str = "atlas"
    """BuildContext material key."""
    jitter: Optional[float] = None
    """Per-vertex brightness jitter; None = the style default."""


def _new_bmesh() -> Tuple["bmesh.types.BMesh", object, object]:
    bm = bmesh.new()
    loops = bm.loops.layers
    # A BMLayerCollection is falsy while empty, so test for the attribute, not its value.
    colors = loops.float_color if hasattr(loops, "float_color") else loops.color
    return bm, colors.new(COLOR_ATTRIBUTE), loops.uv.new(UV_MAP)


def _scale_matrix(center: Sequence[float], scale: Sequence[float]) -> "Matrix":
    m = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return Matrix.Translation(Vector(center)) @ m


class MeshBuilder:
    def __init__(self, ctx: "BuildContext", name: str, rng: VariantRng, bounds: Optional[Tuple[Vec3, Vec3]] = None) -> None:
        self.ctx = ctx
        self.name = name
        self.rng = rng
        self.bounds = bounds
        """Blender-space footprint box; vertices on it are never jittered."""
        self._parts: List["bpy.types.Mesh"] = []
        self._materials: List["bpy.types.Material"] = []

    # --- shapes --------------------------------------------------------------------------

    def box(
        self,
        lo: Sequence[float],
        hi: Sequence[float],
        paint: Paint,
        bevel: Optional[float] = None,
        segments: Optional[int] = None,
        noise: Optional[float] = None,
    ) -> "MeshBuilder":
        """An axis-aligned box from ``lo`` to ``hi`` with optional rounded bevel."""
        size = [hi[i] - lo[i] for i in range(3)]
        if min(size) <= 0:
            raise ValueError(f"{self.name}: box must have positive size, got {size}")
        center = [(lo[i] + hi[i]) / 2 for i in range(3)]
        bm, col, uv = _new_bmesh()
        bmesh.ops.create_cube(bm, size=1.0, matrix=_scale_matrix(center, size))
        self._bevel(bm, min(size), bevel, segments)
        return self._finish(bm, col, uv, paint, noise, smooth=False)

    def rounded_box(self, lo: Sequence[float], hi: Sequence[float], paint: Paint, radius: float, segments: int = 3) -> "MeshBuilder":
        """A box whose edges are rounded with ``radius`` (soft toy-like blocks)."""
        return self.box(lo, hi, paint, bevel=radius, segments=segments)

    def cylinder(
        self,
        base: Sequence[float],
        radius: float,
        height: float,
        paint: Paint,
        sides: int = 8,
        radius_top: Optional[float] = None,
        bevel: Optional[float] = None,
        noise: Optional[float] = None,
    ) -> "MeshBuilder":
        """A low-poly cylinder (or cone/frustum with ``radius_top``) standing on ``base``."""
        bm, col, uv = _new_bmesh()
        center = (base[0], base[1], base[2] + height / 2)
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=max(3, sides),
            radius1=radius,
            radius2=radius if radius_top is None else radius_top,
            depth=height,
            matrix=Matrix.Translation(Vector(center)),
        )
        self._bevel(bm, min(radius * 2, height), bevel, None)
        return self._finish(bm, col, uv, paint, noise, smooth=False)

    def blob(
        self,
        center: Sequence[float],
        radius: float,
        paint: Paint,
        scale: Sequence[float] = (1.0, 1.0, 1.0),
        subdivisions: int = 1,
        wobble: float = 0.08,
    ) -> "MeshBuilder":
        """A soft rounded lump (icosphere with radial wobble): canopies, bushes, rocks."""
        bm, col, uv = _new_bmesh()
        bmesh.ops.create_icosphere(bm, subdivisions=max(1, subdivisions), radius=1.0, matrix=_scale_matrix(center, [radius * s for s in scale]))
        if wobble > 0:
            c = Vector(center)
            for v in bm.verts:
                d = v.co - c
                v.co = c + d * (1.0 + self.rng.jitter(wobble))
        return self._finish(bm, col, uv, paint, noise=0.0, smooth=True)

    # --- internals -----------------------------------------------------------------------

    def _bevel(self, bm, min_extent: float, bevel: Optional[float], segments: Optional[int]) -> None:
        width = self.ctx.style.bevel_width_m if bevel is None else bevel
        if width <= 0:
            return
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=min(width, 0.45 * min_extent),
            offset_type="OFFSET",
            segments=self.ctx.style.bevel_segments if segments is None else max(1, segments),
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )

    def _material_index(self, key: str) -> int:
        mat = self.ctx.material(key)
        if mat not in self._materials:
            self._materials.append(mat)
        return self._materials.index(mat)

    def _finish(self, bm, col, uv, paint: Paint, noise: Optional[float], smooth: bool) -> "MeshBuilder":
        rng = self.rng.fork(f"part{len(self._parts)}")
        amount = self.ctx.style.vertex_noise_m if noise is None else noise
        lo, hi = self.bounds if self.bounds else (None, None)
        if amount > 0:
            for v in bm.verts:
                off = grid_safe_jitter(tuple(v.co), amount, rng, lo, hi)
                v.co = v.co + Vector(off)
        bm.normal_update()
        bm.verts.index_update()
        jitter = self.ctx.style.colour_jitter if paint.jitter is None else paint.jitter
        vert_colour = {v.index: painted_colour(paint.color, jitter, rng) for v in bm.verts}
        rect = self.ctx.atlas.uv_rect(paint.tile)
        mat_index = self._material_index(paint.material)
        for face in bm.faces:
            face.material_index = mat_index
            face.smooth = smooth
            uvs = project_face_uvs([tuple(l.vert.co) for l in face.loops], tuple(face.normal), rect)
            for loop, (u, v) in zip(face.loops, uvs):
                loop[uv].uv = (u, v)
                loop[col] = vert_colour[loop.vert.index]
        mesh = bpy.data.meshes.new(f"{self.name}.part{len(self._parts)}")
        bm.to_mesh(mesh)
        bm.free()
        self._parts.append(mesh)
        return self

    def to_object(self, collection: "bpy.types.Collection", parent: Optional["bpy.types.Object"] = None) -> "bpy.types.Object":
        """Join all shapes into one mesh object (one draw call per material slot)."""
        if not self._parts:
            raise ValueError(f"{self.name}: no shapes were added")
        bm = bmesh.new()
        for part in self._parts:
            bm.from_mesh(part)  # repeated calls append; layers match by name
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for part in self._parts:
            bpy.data.meshes.remove(part)
        self._parts.clear()
        for mat in self._materials:
            mesh.materials.append(mat)
        attrs = mesh.color_attributes
        if COLOR_ATTRIBUTE in attrs:
            attrs.active_color = attrs[COLOR_ATTRIBUTE]
            try:
                attrs.render_color_index = list(attrs).index(attrs[COLOR_ATTRIBUTE])
            except (AttributeError, ValueError):  # pragma: no cover - older API
                pass
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj
