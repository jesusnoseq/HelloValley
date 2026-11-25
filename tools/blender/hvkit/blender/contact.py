"""Renders a kit contact sheet: every module and variant on one ground plane, labelled, seen
through an orthographic isometric camera (GDD §7.1), saved as a PNG.

    blender --background --factory-startup --python tools/blender/build.py -- \\
        --style europe --contact-sheet docs/art/european-kit-contact-sheet.png

Modules are built in the scene with the same code as the GLB export (no import round trip,
so the atlas material and vertex colours render as authored).
"""

from __future__ import annotations

import math
import os
import shutil
import tempfile
from typing import List

import bpy
from mathutils import Euler, Vector

from .. import contact
from ..atlas import render_atlas, write_png
from ..cli import BuildPlan
from . import materials, scene
from .runner import BuildContext

CAMERA_PITCH_DEG = 50.0
"""Steeper than the game camera (35 degrees) so rows do not hide each other."""
CAMERA_YAW_DEG = -25.0
HEIGHT_GAP = 0.55


def _engine_ids() -> List[str]:
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    return [i.identifier for i in items]


def _setup_render(width: int, height: int, path: str) -> str:
    sc = bpy.context.scene
    engines = _engine_ids()
    engine = next((e for e in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH") if e in engines), engines[0])
    sc.render.engine = engine
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.compression = 100
    sc.render.filepath = path
    try:
        sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
        sc.view_settings.look = "None"
    except TypeError:  # pragma: no cover - unusual OCIO configs
        pass
    if engine.startswith("BLENDER_EEVEE"):
        eevee = sc.eevee
        for attr, value in (("taa_render_samples", 32), ("use_gtao", True), ("use_shadows", True), ("shadow_ray_count", 2)):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)
    else:
        shading = sc.display.shading
        shading.light = "STUDIO"
        shading.color_type = "VERTEX"
        shading.show_shadows = True
        shading.show_cavity = True
    return engine


def _world(colour=(0.86, 0.9, 0.95)) -> None:
    world = bpy.data.worlds.new("hv_contact_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs["Color"].default_value = (*colour, 1.0)
        bg.inputs["Strength"].default_value = 0.7
    bpy.context.scene.world = world


def _sun() -> None:
    data = bpy.data.lights.new("hv_sun", type="SUN")
    data.energy = 2.6
    data.color = (1.0, 0.93, 0.82)
    if hasattr(data, "angle"):
        data.angle = math.radians(8.0)
    sun = bpy.data.objects.new("hv_sun", data)
    sun.rotation_euler = Euler((math.radians(50.0), 0.0, math.radians(-30.0)), "XYZ")
    bpy.context.scene.collection.objects.link(sun)


def _ground(size_x: float, size_y: float, rgba) -> None:
    mesh = bpy.data.meshes.new("hv_ground")
    m = 2.0
    verts = [(-m, -m, -0.02), (size_x + m, -m, -0.02), (size_x + m, size_y + m, -0.02), (-m, size_y + m, -0.02)]
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mat = materials.flat_material("hv_ground", rgba, roughness=1.0)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("hv_ground", mesh)
    bpy.context.scene.collection.objects.link(obj)


def _label(text: str, x: float, y: float, rgba, size: float = 0.42) -> None:
    curve = bpy.data.curves.new(f"label.{text}", type="FONT")
    curve.body = text
    curve.size = size
    curve.extrude = 0.005
    obj = bpy.data.objects.new(f"label.{text}", curve)
    obj.location = (x, y, 0.0)
    curve.materials.append(materials.flat_material("hv_label", rgba, roughness=1.0))
    bpy.context.scene.collection.objects.link(obj)


def _camera(points: List[Vector], width_px: int, pitch_deg: float = CAMERA_PITCH_DEG, yaw_deg: float = CAMERA_YAW_DEG) -> tuple:
    cam_data = bpy.data.cameras.new("hv_camera")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("hv_camera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # Cameras look down their local -Z: X = 90 degrees looks at the horizon, so X = 90 - pitch
    # looks ``pitch`` degrees down.
    cam.rotation_euler = Euler((math.radians(90.0 - pitch_deg), 0.0, math.radians(yaw_deg)), "XYZ")
    rot = cam.rotation_euler.to_matrix()
    right, up, back = rot.col[0], rot.col[1], rot.col[2]
    us = [p.dot(right) for p in points]
    vs = [p.dot(up) for p in points]
    ws = [p.dot(back) for p in points]
    w = max(us) - min(us)
    h = max(vs) - min(vs)
    pad = 1.04
    cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
    cam.location = right * cu + up * cv + back * (max(ws) + 20.0)
    cam_data.ortho_scale = max(w, h) * pad
    cam_data.clip_end = (max(ws) - min(ws)) + 60.0
    height_px = max(64, int(round(width_px * h / w))) if w >= h else width_px
    width = width_px if w >= h else max(64, int(round(width_px * w / h)))
    bpy.context.scene.camera = cam
    return width, height_px


def render(plan: BuildPlan, out_png: str, width_px: int = 2200, columns: int = 4) -> int:
    scene.reset_scene()
    # Paint the atlas into a temporary folder: the kit folder keeps its optimized atlas.
    tmp = tempfile.mkdtemp(prefix="hv-contact-")
    try:
        return _render(plan, out_png, width_px, columns, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _render(plan: BuildPlan, out_png: str, width_px: int, columns: int, tmp: str) -> int:
    atlas = plan.style.atlas()
    atlas_path = os.path.join(tmp, "atlas.png")
    write_png(atlas_path, atlas.layout.size, render_atlas(atlas, plan.style.seed))
    atlas_image = materials.load_atlas_image(atlas_path)
    atlas_image.pack()
    ctx = BuildContext(plan.style, atlas_image, None, plan.seed)
    modules = sorted(plan.modules, key=lambda m: (m.footprint.height_m, m.id))
    slots, groups, (sheet_w, sheet_d) = contact.layout(modules, columns=columns, height_gap=HEIGHT_GAP)
    by_id = {m.id: m for m in modules}
    points: List[Vector] = []
    for m in modules:
        col = scene.new_collection(m.id)
        ctx.collection = col
        for slot in (s for s in slots if s.module_id == m.id):
            rng = m.rng(plan.style.id, slot.variant, plan.seed)
            params = m.variant_params(plan.style, slot.variant, rng.fork("params"))
            root = scene.new_empty(f"{m.id}.v{slot.variant}", col)
            root.location = slot.pivot
            for obj in m.build(ctx, slot.variant, params, rng.fork("build")):
                if obj.parent is None:
                    obj.parent = root
        bpy.context.view_layer.update()
        for obj in col.all_objects:
            if obj.type == "MESH":
                points.extend(obj.matrix_world @ Vector(c) for c in obj.bound_box)
    label_rgba = (0.97, 0.95, 0.9, 1.0)
    for g in groups:
        m = by_id[g.module_id]
        _label(m.id, g.origin[0] + 0.1, g.origin[1] + 0.15, label_rgba)
        points.append(Vector((g.origin[0], g.origin[1], 0.0)))
    _ground(sheet_w, sheet_d, (0.42, 0.47, 0.38, 1.0))
    _world()
    _sun()
    width, height = _camera(points, width_px)
    path = os.path.abspath(out_png)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    engine = _setup_render(width, height, path)
    print(f"[hvkit] rendering contact sheet {width}x{height} with {engine}: {len(slots)} variants of {len(modules)} modules")
    bpy.ops.render.render(write_still=True)
    print(f"[hvkit] wrote {path}")
    return 0
