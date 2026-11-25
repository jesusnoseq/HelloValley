"""Builds the character set inside Blender (M07) and renders its contact sheet.

Output (``packages/client/public/assets/characters/``):

- ``body.glb``: the skinned chibi body (fur, shirt and trousers slots), the shared armature,
  one empty per body socket (``socket_<name>``, parented to its bone, extras ``hv_socket``)
  and the 14 clips as glTF animations.
- ``animal.<id>.glb``: a root ``animal_<id>`` (extras ``hv_animal``) whose children are the
  head, tail and optional parts (extras ``hv_part``, ``hv_socket``, ``hv_default``), each
  with its origin at the socket it attaches to; the head holds the head sockets.
- ``outfit.<npc>.glb``: a root ``outfit_<npc>`` (extras ``hv_outfit``) with one child per
  piece, attached the same way.
- ``character-manifest.json`` (``hvkit.character``).
"""

from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional, Tuple

import bpy
from mathutils import Matrix, Vector

from hvchars import ANIMAL_IDS, OUTFIT_IDS, animal_parts, body_shapes, outfit_parts
from hvchars.animals import animal_file
from hvchars.animations import CLIPS, get_clip
from hvchars.outfits import NPC_LOOKS, SWATCH_HEX, FUR_HEX, fur_hex
from .. import character as ch
from ..charshapes import Part
from ..cli import CharacterPlan, TARGET_BLENDER, version_ok
from ..color import RGBA, hex_to_linear_rgba
from ..variants import VariantRng
from . import charmesh, contact, export, materials, rig, scene

STYLE_KEY = "characters"


def _rng(kind: str, ident: str, seed: int) -> VariantRng:
    return VariantRng.for_variant(STYLE_KEY, f"{kind}.{ident}", 0, seed)


def _part_object(part: Part, collection, rng: VariantRng, tints=None, tint_key: str = "") -> "bpy.types.Object":
    obj = charmesh.build_object(part.shapes, collection, rng.fork(part.name), name=part.name, tints=tints, tint_key=tint_key)
    obj["hv_part"] = part.name
    obj["hv_socket"] = part.socket
    obj["hv_default"] = part.default
    return obj


def _head_sockets(head: "bpy.types.Object", sockets: Dict[str, Tuple[float, float, float]], collection) -> Dict[str, "bpy.types.Object"]:
    out = {}
    for name in ch.HEAD_SOCKET_NAMES:
        e = bpy.data.objects.new(f"{ch.SOCKET_NODE_PREFIX}{name}", None)
        e.empty_display_size = 0.04
        collection.objects.link(e)
        e.parent = head
        e.location = Vector(sockets[name])
        e["hv_socket"] = name
        out[name] = e
    return out


# --- building ------------------------------------------------------------------------------


def build_body(collection, seed: int, tints: Optional[Dict[str, RGBA]] = None, tint_key: str = "") -> Tuple["bpy.types.Object", "bpy.types.Object", Dict[str, "bpy.types.Object"]]:
    arm = rig.build_armature(collection)
    sockets = rig.socket_empties(arm, collection)
    body = charmesh.build_object(body_shapes(), collection, _rng("body", "body", seed), name="body", skinned=True, tints=tints, tint_key=tint_key)
    rig.skin(body, arm)
    return arm, body, sockets


def build_animal(animal_id: str, collection, seed: int, tints=None, tint_key: str = "", show_optional: bool = False):
    """The parts of one animal. Returns (root, [(part, object)], head sockets)."""
    spec = animal_parts(animal_id)
    rng = _rng("animal", animal_id, seed)
    root = scene.new_empty(f"animal_{animal_id}", collection)
    root["hv_animal"] = animal_id
    objects: List[Tuple[Part, "bpy.types.Object"]] = []
    head_sockets: Dict[str, "bpy.types.Object"] = {}
    for part in spec.parts:
        obj = _part_object(part, collection, rng, tints, tint_key)
        obj.parent = root
        objects.append((part, obj))
        if part.name == "head":
            head_sockets = _head_sockets(obj, spec.sockets, collection)
    return root, objects, head_sockets


def build_outfit(npc_id: str, collection, seed: int):
    rng = _rng("outfit", npc_id, seed)
    root = scene.new_empty(f"outfit_{npc_id}", collection)
    root["hv_outfit"] = npc_id
    objects = []
    for part in outfit_parts(npc_id):
        obj = _part_object(part, collection, rng)
        obj.parent = root
        objects.append((part, obj))
    return root, objects


def _check_parts(label: str, objects, required_slots=()) -> List[str]:
    problems = []
    for part, obj in objects:
        slots = [m.get("hv_slot") for m in obj.data.materials]
        if any(s is None for s in slots):
            problems.append(f"{label}/{part.name}: a material has no hv_slot")
    if required_slots:
        head = next((o for p, o in objects if p.name == "head"), None)
        got = [m.get("hv_slot") for m in head.data.materials] if head else []
        for slot in required_slots:
            if slot not in got:
                problems.append(f"{label}: the head has no {slot!r} slot")
    return problems


# --- export --------------------------------------------------------------------------------


def run(plan: CharacterPlan) -> int:
    version = tuple(bpy.app.version)
    if not version_ok(version):
        print(f"[hvkit] Blender {bpy.app.version_string} is too old; use {'.'.join(map(str, TARGET_BLENDER))} LTS")
        return 2
    os.makedirs(plan.out_dir, exist_ok=True)
    scene.reset_scene()
    sc = bpy.context.scene
    sc.render.fps = ch.FPS
    sc.frame_start = 0
    problems: List[str] = []
    for c in CLIPS:
        problems += c.errors()

    col = scene.new_collection("body")
    arm, body, sockets = build_body(col, plan.seed)
    rig.bake_clips(arm, CLIPS)
    sc.frame_end = max(c.frames for c in CLIPS)
    bpy.context.view_layer.update()
    body_tris = export.count_tris([body])
    print(f"[hvkit] body: {body_tris} tris, {len(CLIPS)} clips, {len(sockets)} sockets")
    if sorted(m.get("hv_slot") for m in body.data.materials) != sorted(ch.BODY_SLOTS):
        problems.append(f"body slots are {[m.get('hv_slot') for m in body.data.materials]}, expected {list(ch.BODY_SLOTS)}")
    export.export_glb(os.path.join(plan.out_dir, ch.BODY_FILE), [arm, body, *sockets.values()], export.CHARACTER_BODY_OPTIONS)
    scene.remove_collection(col)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    animals: List[ch.FileResult] = []
    for animal_id in ANIMAL_IDS:
        col = scene.new_collection(animal_id)
        root, objects, head_sockets = build_animal(animal_id, col, plan.seed)
        bpy.context.view_layer.update()
        result = ch.FileResult(animal_id, animal_file(animal_id), sockets=ch.HEAD_SOCKET_NAMES)
        for part, obj in objects:
            result.parts.append(ch.PartResult(part.name, part.socket, export.count_tris([obj]), part.default))
        problems += _check_parts(animal_id, objects, ch.HEAD_SLOTS)
        everything = [root, *(o for _, o in objects), *head_sockets.values()]
        export.export_glb(os.path.join(plan.out_dir, result.file), everything, export.CHARACTER_PART_OPTIONS)
        print(f"[hvkit] {result.file}: {result.tris} tris, parts {[p.name for p in result.parts]}")
        animals.append(result)
        scene.remove_collection(col)

    outfits: List[ch.FileResult] = []
    for npc_id in OUTFIT_IDS:
        col = scene.new_collection(npc_id)
        root, objects = build_outfit(npc_id, col, plan.seed)
        bpy.context.view_layer.update()
        result = ch.FileResult(npc_id, f"outfit.{npc_id}.glb")
        for part, obj in objects:
            result.parts.append(ch.PartResult(part.name, part.socket, export.count_tris([obj]), part.default))
        problems += _check_parts(npc_id, objects)
        export.export_glb(os.path.join(plan.out_dir, result.file), [root, *(o for _, o in objects)], export.CHARACTER_PART_OPTIONS)
        print(f"[hvkit] {result.file}: {result.tris} tris, pieces {[p.name for p in result.parts]}")
        outfits.append(result)
        scene.remove_collection(col)

    manifest = ch.build_manifest(body_tris, CLIPS, animals, outfits)
    errors = ch.validate_manifest(manifest, ANIMAL_IDS, OUTFIT_IDS)
    with open(plan.manifest_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"[hvkit] wrote {plan.manifest_path}")
    problems += errors
    if problems:
        print("[hvkit] problems:\n  " + "\n  ".join(problems))
        if plan.strict or errors:
            return 1
    return 0


# --- contact sheet -------------------------------------------------------------------------

SPACING_X = 0.95
ROW_DEPTH = 3.4
TURN_DEG = 28.0
"""Each character turns a little to its left so poses read in three quarters."""
DEFAULT_SHIRTS = ("sky", "coral", "mint", "butter", "lavender", "peach", "sage", "blush")
DEFAULT_TROUSERS = ("navy", "sand", "charcoal", "moss", "terracotta", "periwinkle", "cream", "lilac")


def _attach(obj: "bpy.types.Object", socket: "bpy.types.Object") -> None:
    obj.parent = socket
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = Vector()


def _character(
    label: str,
    pos: Tuple[float, float],
    animal_id: str,
    fur: str,
    shirt: str,
    trousers: str,
    pose: ch.Pose,
    seed: int,
    npc: Optional[str] = None,
    parts: Optional[Dict[str, bool]] = None,
) -> None:
    col = scene.new_collection(label)
    tints = {"fur": hex_to_linear_rgba(fur), "shirt": hex_to_linear_rgba(SWATCH_HEX[shirt]), "trousers": hex_to_linear_rgba(SWATCH_HEX[trousers])}
    key = label
    arm, body, sockets = build_body(col, seed, tints, key)
    arm.location = (pos[0], pos[1], 0.0)
    arm.rotation_euler = (0.0, 0.0, math.radians(TURN_DEG))
    _, objects, head_sockets = build_animal(animal_id, col, seed, tints, key)
    for part, obj in objects:
        visible = (parts or {}).get(part.name, part.default)
        if not visible:
            scene.remove_objects([obj])
            continue
        _attach(obj, sockets[part.socket])
    if npc:
        _, pieces = build_outfit(npc, col, seed)
        for part, obj in pieces:
            _attach(obj, head_sockets.get(part.socket) or sockets[part.socket])
    rig.apply_pose(arm, pose)


def _label(text: str, x: float, y: float, rgba, size: float = 0.12) -> None:
    """A text label standing up towards the camera, centred on ``x``."""
    curve = bpy.data.curves.new(f"label.{text}", type="FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    curve.extrude = 0.003
    obj = bpy.data.objects.new(f"label.{text}", curve)
    obj.location = (x, y, 0.01)
    obj.rotation_euler = (math.radians(62.0), 0.0, 0.0)
    curve.materials.append(materials.flat_material("hv_char_label", rgba, roughness=1.0))
    bpy.context.scene.collection.objects.link(obj)


def render(plan: CharacterPlan, width_px: int = 1800) -> int:
    """Rows: the 16 animals, the 9 NPCs in their outfits, the 14 clips (each at its showcase
    key), and the optional parts."""
    scene.reset_scene()
    seed = plan.seed
    rows: List[List[Tuple[str, dict]]] = []
    animals = []
    for i, animal_id in enumerate(ANIMAL_IDS):
        animals.append((animal_id, dict(animal_id=animal_id, fur=FUR_HEX[animal_id][0], shirt=DEFAULT_SHIRTS[i % 8], trousers=DEFAULT_TROUSERS[(i * 3) % 8], pose=get_clip("idle").pose_at_key(0))))
    rows += [animals[:8], animals[8:]]
    npcs = []
    for npc_id, look in NPC_LOOKS.items():
        npcs.append((npc_id, dict(animal_id=look.animal, fur=fur_hex(look), shirt=look.shirt, trousers=look.trousers, pose=get_clip("idle").pose_at_key(0), npc=npc_id)))
    rows.append(npcs)
    clips = []
    for i, c in enumerate(CLIPS):
        animal_id = ANIMAL_IDS[(i * 5) % len(ANIMAL_IDS)]
        clips.append((c.name, dict(animal_id=animal_id, fur=FUR_HEX[animal_id][1 % len(FUR_HEX[animal_id])], shirt=DEFAULT_SHIRTS[(i + 3) % 8], trousers=DEFAULT_TROUSERS[i % 8], pose=c.pose_at_key(c.showcase))))
    rows += [clips[:7], clips[7:]]
    idle = get_clip("idle").pose_at_key(0)
    options = [
        ("rabbit floppy", dict(animal_id="rabbit", fur=FUR_HEX["rabbit"][2], shirt="mint", trousers="navy", pose=idle, parts={"ears_upright": False, "ears_floppy": True})),
        ("cat tabby", dict(animal_id="cat", fur=FUR_HEX["cat"][0], shirt="cream", trousers="moss", pose=idle, parts={"tabby": True})),
        ("capybara orange", dict(animal_id="capybara", fur=FUR_HEX["capybara"][0], shirt="sage", trousers="sand", pose=idle, parts={"orange": True})),
        ("penguin flippers", dict(animal_id="penguin", fur=FUR_HEX["penguin"][1], shirt="sky", trousers="navy", pose=idle, parts={"flipper_l": True, "flipper_r": True})),
        ("deer no antlers", dict(animal_id="deer", fur=FUR_HEX["deer"][0], shirt="peach", trousers="charcoal", pose=idle, parts={"antlers": False})),
    ]
    rows.append(options)

    points: List[Vector] = []
    label_rgba = (0.2, 0.19, 0.17, 1.0)
    width = max(len(r) for r in rows) * SPACING_X
    for r, row in enumerate(rows):
        y = (len(rows) - 1 - r) * ROW_DEPTH
        for c, (label, spec) in enumerate(row):
            x = c * SPACING_X + SPACING_X / 2
            _character(f"{r}.{c}.{label}", (x, y), seed=seed, **spec)
            _label(label, x, y - 0.55, label_rgba)
            points += [Vector((x - 0.45, y - 0.7, 0.0)), Vector((x + 0.45, y + 0.4, 1.45))]
    bpy.context.view_layer.update()
    contact._ground(width, len(rows) * ROW_DEPTH, (0.62, 0.66, 0.56, 1.0))
    contact._world()
    contact._sun()
    w, h = contact._camera(points, width_px, pitch_deg=28.0, yaw_deg=0.0)
    path = os.path.abspath(plan.contact_sheet)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    engine = contact._setup_render(w, h, path)
    print(f"[hvkit] rendering character sheet {w}x{h} with {engine}")
    bpy.ops.render.render(write_still=True)
    print(f"[hvkit] wrote {path}")
    return 0
