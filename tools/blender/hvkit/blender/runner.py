"""Builds a kit inside Blender: atlas, one GLB per module (every variant inside it) and
kit-manifest.json.

GLB layout: each variant is a top-level empty named ``v<index>`` whose extras hold
``hv_module``, ``hv_variant`` and ``hv_style``; its children are the variant's meshes. All
variants share the module pivot (bottom-left-front corner at the origin); the client picks
one variant per placed instance.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List

import bpy

from .. import manifest as mf
from ..atlas import render_atlas, write_png
from ..cli import BuildPlan, TARGET_BLENDER, version_ok
from ..module import Module
from ..styles import StyleParams
from ..variants import VariantRng
from . import export, materials, scene
from .shapes import MeshBuilder, Paint


class BuildContext:
    """What a module's ``build`` gets: style parameters, atlas, materials and builders."""

    def __init__(self, style: StyleParams, atlas_image, collection, seed: int) -> None:
        self.style = style
        self.atlas = style.atlas()
        self.atlas_image = atlas_image
        self.collection = collection
        self.seed = seed
        self._materials: Dict[str, "bpy.types.Material"] = {}

    def material(self, key: str = "atlas") -> "bpy.types.Material":
        if key not in self._materials:
            if key != "atlas":
                raise KeyError(f"unknown material key {key!r}")  # TODO(M05): glass, emissive lamps
            self._materials[key] = materials.atlas_material(f"hv_{self.style.id}_atlas", self.atlas_image)
        return self._materials[key]

    def paint(self, group: str, index: int = 0, tile: str = "plaster", material: str = "atlas") -> Paint:
        return Paint(color=self.style.linear(group, index), tile=tile, material=material)

    def builder(self, module: Module, variant: int, rng: VariantRng, part: str = "mesh") -> MeshBuilder:
        return MeshBuilder(self, f"{module.id}.v{variant}.{part}", rng, bounds=module.nominal_bounds())


def _write_atlas(plan: BuildPlan) -> "bpy.types.Image | None":
    if not plan.write_atlas and os.path.exists(plan.atlas_path):
        return materials.load_atlas_image(plan.atlas_path)
    if not plan.write_atlas:
        return None
    atlas = plan.style.atlas()
    print(f"[hvkit] painting atlas {atlas.layout.size}px ({len(atlas.tiles)} tiles)")
    write_png(plan.atlas_path, atlas.layout.size, render_atlas(atlas, plan.style.seed))
    return materials.load_atlas_image(plan.atlas_path)


def _build_module(ctx: BuildContext, module: Module, plan: BuildPlan) -> tuple:
    col = scene.new_collection(module.id)
    ctx.collection = col
    roots = []
    results: List[mf.VariantResult] = []
    problems: List[str] = []
    try:
        for i in range(module.variants):
            rng = module.rng(plan.style.id, i, plan.seed)
            params = module.variant_params(plan.style, i, rng.fork("params"))
            root = scene.new_empty(f"v{i}", col)
            root["hv_module"] = module.id
            root["hv_variant"] = i
            root["hv_style"] = plan.style.id
            objects = module.build(ctx, i, params, rng.fork("build"))
            for obj in objects:
                if obj.parent is None:
                    obj.parent = root
            bpy.context.view_layer.update()
            meshes = [o for o in scene.hierarchy(root) if o.type == "MESH"]
            if not meshes:
                raise RuntimeError(f"{module.id} v{i}: build() produced no mesh")
            lo, hi = export.world_bounds(meshes)
            tris = export.count_tris(meshes)
            results.append(mf.VariantResult(lo, hi, tris))
            problems += module.bounds_errors(lo, hi)
            roots.append(root)
        problems += mf.budget_errors(module, [r.tris for r in results])
        everything = [o for r in roots for o in scene.hierarchy(r)]
        export.export_glb(os.path.join(plan.out_dir, module.file_name), everything)
    finally:
        scene.remove_collection(col)
    return mf.module_entry(module, results), problems


def run(plan: BuildPlan) -> int:
    version = tuple(bpy.app.version)
    if not version_ok(version):
        print(f"[hvkit] Blender {bpy.app.version_string} is too old; use {'.'.join(map(str, TARGET_BLENDER))} LTS")
        return 2
    if version[:2] != TARGET_BLENDER[:2]:
        print(f"[hvkit] note: targeting Blender {TARGET_BLENDER[0]}.{TARGET_BLENDER[1]} LTS, running {bpy.app.version_string}")
    if not plan.modules:
        print("[hvkit] no modules selected; nothing to do (test modules need --modules or --include-tests)")
        return 1

    os.makedirs(plan.out_dir, exist_ok=True)
    scene.reset_scene()
    atlas_image = _write_atlas(plan)
    ctx = BuildContext(plan.style, atlas_image, None, plan.seed)

    entries = []
    problems: List[str] = []
    for module in plan.modules:
        print(f"[hvkit] {module.id}: {module.variants} variants")
        entry, issues = _build_module(ctx, module, plan)
        entries.append(entry)
        problems += issues
        print(f"[hvkit]   tris {entry['tris']}  bounds {entry['bounds']['min']} .. {entry['bounds']['max']}")

    atlas = ctx.atlas
    atlas_json = mf.atlas_entry(os.path.basename(plan.atlas_path), atlas.layout.size, {t.name: atlas.uv_rect(t.name) for t in atlas.tiles}) if atlas_image else None
    fresh = mf.build_manifest(plan.style.id, entries, atlas_json)
    existing = None
    if os.path.exists(plan.manifest_path):
        with open(plan.manifest_path, encoding="utf-8") as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                existing = None
    merged = mf.merge_manifest(existing, fresh)
    errors = mf.validate_manifest(merged)
    if errors:
        print("[hvkit] manifest is invalid:\n  " + "\n  ".join(errors))
        return 1
    with open(plan.manifest_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(mf.dumps(merged))
    print(f"[hvkit] wrote {plan.manifest_path} ({len(merged['modules'])} modules)")

    if problems:
        print("[hvkit] problems:\n  " + "\n  ".join(problems))
        if plan.strict:
            return 1
    return 0
