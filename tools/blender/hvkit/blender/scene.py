"""Scene setup and cleanup."""

from __future__ import annotations

from typing import Iterable

import bpy


def reset_scene() -> None:
    """Start from an empty factory scene in metric metres."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def new_collection(name: str) -> "bpy.types.Collection":
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def new_empty(name: str, collection: "bpy.types.Collection") -> "bpy.types.Object":
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.25
    collection.objects.link(obj)
    return obj


def remove_objects(objects: Iterable["bpy.types.Object"]) -> None:
    """Delete objects and the meshes only they used, so names are free for the next module."""
    meshes = []
    for obj in list(objects):
        if obj.type == "MESH" and obj.data is not None:
            meshes.append(obj.data)
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def remove_collection(col: "bpy.types.Collection") -> None:
    remove_objects(list(col.all_objects))
    bpy.data.collections.remove(col)


def hierarchy(root: "bpy.types.Object") -> list:
    """``root`` and all its descendants."""
    out = [root]
    for child in root.children_recursive:
        out.append(child)
    return out
