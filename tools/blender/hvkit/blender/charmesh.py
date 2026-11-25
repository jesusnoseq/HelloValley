"""Turns :class:`hvkit.charshapes.ShapeSet` recipes into Blender meshes (characters, M07).

Each shape becomes a smooth-shaded island in one bmesh, painted with a linear vertex colour
(plus a little per-vertex brightness jitter) and assigned to the material slot it names. On
the skinned body every vertex is weighted 1.0 to the shape's bone (rigid skinning).
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from ..character import MATERIAL_SLOTS
from ..charshapes import Shape, ShapeSet
from ..color import RGBA
from ..shaping import painted_colour
from ..variants import VariantRng
from . import materials
from .materials import COLOR_ATTRIBUTE

ROUGHNESS = {"eyes": 0.25, "fur": 0.85}


def slot_material(slot: str) -> "bpy.types.Material":
    """The shared material of a character slot: vertex colour only, extras ``hv_slot`` and
    ``hv_tint`` (the client tints tintable slots through ``material.color``)."""
    name = f"hv_char_{slot}"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = materials.vertex_material(name, roughness=ROUGHNESS.get(slot, 0.8), marker="hv_character")
        mat["hv_slot"] = slot
        mat["hv_tint"] = bool(MATERIAL_SLOTS[slot])
    return mat


def tinted_material(slot: str, tint: Optional[RGBA], key: str) -> "bpy.types.Material":
    """A preview copy of a slot material whose base colour is vertex colour x ``tint``
    (contact sheet only; the GLBs keep the shared, untinted slot materials)."""
    base = slot_material(slot)
    if tint is None:
        return base
    name = f"hv_char_{slot}.{key}"
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = base.copy()
    mat.name = name
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    vcol = next(n for n in nodes if n.type == "VERTEX_COLOR")
    rgb = nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = tuple(tint)
    mul = nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    links.new(vcol.outputs["Color"], mul.inputs[0])
    links.new(rgb.outputs[0], mul.inputs[1])
    links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    return mat


def _layers(bm):
    loops = bm.loops.layers
    colors = loops.float_color if hasattr(loops, "float_color") else loops.color
    col = colors.get(COLOR_ATTRIBUTE) or colors.new(COLOR_ATTRIBUTE)
    return col, bm.verts.layers.deform.verify()


def _trs(center: Sequence[float], rot: Sequence[float], scale: Sequence[float]) -> "Matrix":
    r = Euler(tuple(math.radians(a) for a in rot), "XYZ").to_matrix().to_4x4()
    return Matrix.Translation(Vector(center)) @ r @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))


def _along(a: Sequence[float], b: Sequence[float]):
    """A frame at ``a`` whose local Z points at ``b``, and the length a-b."""
    d = Vector(b) - Vector(a)
    length = d.length
    if length < 1e-6:
        raise ValueError(f"degenerate segment {a} -> {b}")
    q = Vector((0.0, 0.0, 1.0)).rotation_difference(d.normalized())
    return Matrix.Translation(Vector(a)) @ q.to_matrix().to_4x4(), length


def _torus(bm, major: float, minor: float, stretch: float, segs: int, rings: int) -> List:
    verts = []
    for i in range(segs):
        u = 2.0 * math.pi * i / segs
        c = Vector((major * math.cos(u), major * stretch * math.sin(u), 0.0))
        radial = Vector((math.cos(u), math.sin(u), 0.0))
        for j in range(rings):
            v = 2.0 * math.pi * j / rings
            verts.append(bm.verts.new(c + radial * (minor * math.cos(v)) + Vector((0.0, 0.0, minor * math.sin(v)))))
    faces = []
    for i in range(segs):
        for j in range(rings):
            a = verts[i * rings + j]
            b = verts[((i + 1) % segs) * rings + j]
            c = verts[((i + 1) % segs) * rings + (j + 1) % rings]
            d = verts[i * rings + (j + 1) % rings]
            faces.append(bm.faces.new((a, b, c, d)))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return verts


def _shape_verts(bm, s: Shape) -> List:
    if s.kind == "ellipsoid":
        verts = bmesh.ops.create_icosphere(bm, subdivisions=max(1, s.detail), radius=1.0)["verts"]
        bmesh.ops.transform(bm, matrix=_trs(s.center, s.rot, s.radii), verts=verts)
        return verts
    if s.kind == "capsule":
        frame, length = _along(s.a, s.b)
        u, v = s.segments()
        verts = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)["verts"]
        for vert in verts:
            x, y, z = vert.co
            r = s.r2 if z >= -1e-6 else s.r1
            vert.co = Vector((x * r, y * r * s.squash, z * r + (length if z >= -1e-6 else 0.0)))
        bmesh.ops.transform(bm, matrix=frame, verts=verts)
        return verts
    if s.kind in ("cone", "cylinder"):
        frame, length = _along(s.a, s.b)
        sides = s.segments()[0]
        verts = bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=sides, radius1=s.r1, radius2=s.r2, depth=length,
            matrix=Matrix.Translation((0.0, 0.0, length / 2)),
        )["verts"]
        bmesh.ops.transform(bm, matrix=frame @ Matrix.Diagonal((1.0, s.squash, 1.0, 1.0)), verts=verts)
        return verts
    if s.kind == "box":
        verts = bmesh.ops.create_cube(bm, size=2.0)["verts"]
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((*s.radii, 1.0)), verts=verts)
        if s.detail > 0:
            edges = list({e for v in verts for e in v.link_edges})
            geom = bmesh.ops.bevel(
                bm, geom=edges, offset=0.35 * min(s.radii), offset_type="OFFSET", segments=s.detail,
                profile=0.5, affect="EDGES", clamp_overlap=True,
            )
            verts = list({v for f in geom["faces"] for v in f.verts} | {v for v in verts if v.is_valid})
        bmesh.ops.transform(bm, matrix=_trs(s.center, s.rot, (1.0, 1.0, 1.0)), verts=verts)
        return verts
    if s.kind == "torus":
        major, minor, stretch = s.radii
        segs, rings = s.segments()
        verts = _torus(bm, major, minor, stretch, segs, rings)
        bmesh.ops.transform(bm, matrix=_trs(s.center, s.rot, (1.0, 1.0, 1.0)), verts=verts)
        return verts
    raise ValueError(f"unknown shape kind {s.kind!r}")


def build_object(
    shapes: ShapeSet,
    collection: "bpy.types.Collection",
    rng: VariantRng,
    name: Optional[str] = None,
    skinned: bool = False,
    tints: Optional[Dict[str, RGBA]] = None,
    tint_key: str = "",
) -> "bpy.types.Object":
    """One mesh object from a shape recipe. ``skinned`` writes one vertex group per bone the
    shapes name (weight 1.0). ``tints`` (contact sheet only) swaps tintable slots for tinted
    preview copies."""
    if not shapes.shapes:
        raise ValueError(f"{shapes.name}: no shapes")
    bm = bmesh.new()
    col, deform = _layers(bm)
    slots: List[str] = []
    groups: List[str] = []
    for index, shape in enumerate(shapes.shapes):
        verts = _shape_verts(bm, shape)
        # Key everything by vertex index: BMesh element wrappers are not stable dict keys, and
        # set order would make the colour jitter (and so the GLB bytes) differ between runs.
        bm.verts.index_update()
        verts = sorted(set(verts), key=lambda v: v.index)
        if shape.slot not in slots:
            slots.append(shape.slot)
        mat_index = slots.index(shape.slot)
        if skinned:
            if not shape.bone:
                raise ValueError(f"{shapes.name}: shape {index} has no bone")
            if shape.bone not in groups:
                groups.append(shape.bone)
            g = groups.index(shape.bone)
            for v in verts:
                v[deform][g] = 1.0
        part_rng = rng.fork(f"shape{index}")
        colours = {v.index: painted_colour(shape.colour, shape.jitter, part_rng) for v in verts}
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:  # per-face writes, so the set order does not matter
            f.material_index = mat_index
            f.smooth = shape.smooth
            for loop in f.loops:
                loop[col] = colours[loop.vert.index]
    # Determinism: triangulate here (single-threaded, fixed methods) and write rounded vertex
    # normals as custom normals, so Blender's threaded normal and loop-triangle passes cannot
    # change the GLB bytes from one run to the next.
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="FIXED", ngon_method="EAR_CLIP")
    bm.normal_update()
    bm.verts.index_update()
    normals = [tuple(round(c, 4) for c in (v.normal if f.smooth else f.normal)) for f in bm.faces for v in f.verts]
    mesh = bpy.data.meshes.new(name or shapes.name)
    bm.to_mesh(mesh)
    bm.free()
    loop_normals = [(0.0, 0.0, 1.0)] * len(mesh.loops)
    i = 0
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            loop_normals[li] = normals[i]
            i += 1
    mesh.normals_split_custom_set(loop_normals)
    for slot in slots:
        tint = (tints or {}).get(slot) if MATERIAL_SLOTS[slot] else None
        mesh.materials.append(tinted_material(slot, tint, tint_key) if tint is not None else slot_material(slot))
    attrs = mesh.color_attributes
    if COLOR_ATTRIBUTE in attrs:
        attrs.active_color = attrs[COLOR_ATTRIBUTE]
        try:
            attrs.render_color_index = list(attrs).index(attrs[COLOR_ATTRIBUTE])
        except (AttributeError, ValueError):  # pragma: no cover - older API
            pass
    obj = bpy.data.objects.new(name or shapes.name, mesh)
    collection.objects.link(obj)
    for g in groups:
        obj.vertex_groups.new(name=g)
    return obj
