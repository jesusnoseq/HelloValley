"""The shared armature, its socket empties, rigid skinning and the scripted clips (M07)."""

from __future__ import annotations

import math
from typing import Dict, Iterable, Optional

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

from ..character import BODY_SOCKETS, BONES, SOCKET_NODE_PREFIX, BonePose, Clip, Pose


def build_armature(collection: "bpy.types.Collection", name: str = "rig") -> "bpy.types.Object":
    data = bpy.data.armatures.new(f"{name}_data")
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit = data.edit_bones
    for b in BONES:
        eb = edit.new(b.name)
        eb.head = Vector(b.head)
        eb.tail = Vector(b.tail)
        eb.roll = 0.0
        eb.use_deform = b.deform
    for b in BONES:
        if b.parent:
            edit[b.name].parent = edit[b.parent]
            edit[b.name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    obj["hv_character"] = "body"
    return obj


def socket_empties(arm: "bpy.types.Object", collection: "bpy.types.Collection") -> Dict[str, "bpy.types.Object"]:
    """One empty per body socket, parented to its bone, placed at the socket at rest with no
    rotation (so pieces authored in character axes attach as they were modelled)."""
    clear_pose(arm)
    out: Dict[str, "bpy.types.Object"] = {}
    for s in BODY_SOCKETS:
        e = bpy.data.objects.new(f"{SOCKET_NODE_PREFIX}{s.name}", None)
        e.empty_display_size = 0.05
        collection.objects.link(e)
        e.parent = arm
        e.parent_type = "BONE"
        e.parent_bone = s.bone
        bpy.context.view_layer.update()
        e.matrix_world = Matrix.Translation(Vector(s.pos))
        e["hv_socket"] = s.name
        out[s.name] = e
    bpy.context.view_layer.update()
    return out


def skin(mesh: "bpy.types.Object", arm: "bpy.types.Object") -> None:
    mesh.parent = arm
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def clear_pose(arm: "bpy.types.Object") -> None:
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
        pb.scale = Vector((1.0, 1.0, 1.0))
    bpy.context.view_layer.update()


def _local(arm: "bpy.types.Object", name: str, bp: BonePose):
    rest = arm.data.bones[name].matrix_local.to_3x3()
    inv = rest.inverted()
    rot = Euler(tuple(math.radians(a) for a in bp.rot), "XYZ").to_matrix()
    return (inv @ rot @ rest).to_quaternion(), inv @ Vector(bp.loc)


def apply_pose(arm: "bpy.types.Object", pose: Pose, previous: Optional[Dict[str, Quaternion]] = None) -> Dict[str, Quaternion]:
    """Set the pose bones from an armature-axis pose. ``previous`` keeps quaternion signs
    continuous between keys so interpolation takes the short way round."""
    out: Dict[str, Quaternion] = {}
    for name, bp in pose.items():
        pb = arm.pose.bones[name]
        q, loc = _local(arm, name, bp)
        if previous and name in previous and previous[name].dot(q) < 0.0:
            q.negate()
        pb.rotation_quaternion = q
        pb.location = loc
        out[name] = q.copy()
    bpy.context.view_layer.update()
    return out


def bake_clips(arm: "bpy.types.Object", clips: Iterable[Clip]) -> None:
    """One action per clip, keyed on every bone at every clip key, each pushed onto its own
    NLA track named after the clip (the glTF exporter's NLA_TRACKS mode writes one
    animation per track)."""
    ad = arm.animation_data_create()
    for c in clips:
        action = bpy.data.actions.new(c.name)
        action.use_fake_user = True
        ad.action = action
        previous: Dict[str, Quaternion] = {}
        for frame, pose in c.keys:
            previous = apply_pose(arm, pose, previous)
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
                pb.keyframe_insert("location", frame=frame, group=pb.name)
        ad.action = None
        track = ad.nla_tracks.new()
        track.name = c.name
        track.strips.new(c.name, 0, action)
        track.mute = True
    clear_pose(arm)
