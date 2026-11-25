"""GLB export and measurements."""

from __future__ import annotations

from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector

from ..grid import Vec3, bounds_of

# Options for bpy.ops.export_scene.gltf. Names that the running Blender does not know are
# dropped with a warning (the exporter's options shift between releases).
GLTF_OPTIONS: Dict[str, object] = {
    "export_format": "GLB",
    "use_selection": True,
    "export_apply": True,
    "export_yup": True,
    "export_extras": True,  # hv_module / hv_variant / hv_atlas custom properties
    "export_texcoords": True,
    "export_normals": True,
    "export_tangents": False,
    "export_materials": "EXPORT",
    "export_vertex_color": "ACTIVE",  # COLOR_0 from the active colour attribute
    "export_all_vertex_colors": False,
    "export_image_format": "NONE",  # the atlas ships once per kit, not in every GLB
    "export_cameras": False,
    "export_lights": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_draco_mesh_compression_enable": False,  # tools/optimize-assets applies meshopt
    "check_existing": False,
}


def supported_options(options: Dict[str, object]) -> Tuple[Dict[str, object], List[str]]:
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kept = {k: v for k, v in options.items() if k in props}
    dropped = sorted(k for k in options if k not in props)
    return kept, dropped


def export_glb(path: str, objects: Iterable["bpy.types.Object"]) -> None:
    objs = list(objects)
    if not objs:
        raise ValueError(f"nothing to export for {path}")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kwargs, dropped = supported_options(GLTF_OPTIONS)
    if dropped:
        print(f"[hvkit] glTF exporter does not support: {', '.join(dropped)} (ignored)")
    result = bpy.ops.export_scene.gltf(filepath=path, **kwargs)
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed for {path}: {result}")


def _evaluated_mesh_data(obj: "bpy.types.Object"):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    return evaluated, evaluated.to_mesh()


def count_tris(objects: Sequence["bpy.types.Object"]) -> int:
    """Triangles after modifiers, as the exporter will triangulate them."""
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated, mesh = _evaluated_mesh_data(obj)
        try:
            total += sum(max(0, len(p.vertices) - 2) for p in mesh.polygons)
        finally:
            evaluated.to_mesh_clear()
    return total


def world_bounds(objects: Sequence["bpy.types.Object"]) -> Tuple[Vec3, Vec3]:
    """Blender-space bounds of the evaluated vertices of all mesh objects."""
    points: List[Vec3] = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated, mesh = _evaluated_mesh_data(obj)
        try:
            mw = obj.matrix_world
            for v in mesh.vertices:
                p = mw @ Vector(v.co)
                points.append((p.x, p.y, p.z))
        finally:
            evaluated.to_mesh_clear()
    if not points:
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    return bounds_of(points)
