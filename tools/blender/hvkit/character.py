"""The shared character rig (GDD §3.1), pure Python: skeleton, sockets, material slots,
animation clip structure and character-manifest.json.

Every player and NPC uses one chibi humanoid body (about 2.4 heads tall) with one skeleton.
Animal heads, tails and NPC outfit pieces are separate meshes that the client attaches to
named sockets, so one animated body serves all 16 animals.

Coordinates here are Blender space (Z up, the character faces -Y, its left is +X), metres,
with the pivot on the ground between the feet. The manifest converts to glTF space (Y up,
the character faces +Z).

Mirrored in ``packages/shared/src/assets/characters.ts`` (a Python test keeps the names
equal).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from . import GENERATOR, GENERATOR_VERSION, grid
from .grid import Vec3

CHARACTER_MANIFEST_VERSION = 1
CHARACTER_MANIFEST_FILE = "character-manifest.json"
CHARACTERS_DIR = "characters"
"""Folder under ``packages/client/public/assets/``."""
BODY_FILE = "body.glb"
FPS = 24

NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# --- skeleton ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Bone:
    name: str
    head: Vec3
    tail: Vec3
    parent: Optional[str]
    deform: bool = True


def _mirror(v: Vec3) -> Vec3:
    return (-v[0], v[1], v[2])


def _sided(name: str, head: Vec3, tail: Vec3, parent: str) -> Tuple[Bone, Bone]:
    """A left bone (+X) and its mirrored right twin. ``parent`` may end in ``_{side}``."""
    left = Bone(f"{name}_l", head, tail, parent.replace("{side}", "l"))
    right = Bone(f"{name}_r", _mirror(head), _mirror(tail), parent.replace("{side}", "r"))
    return left, right


BONES: Tuple[Bone, ...] = (
    Bone("root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.12), None, deform=False),
    Bone("hips", (0.0, 0.0, 0.30), (0.0, 0.0, 0.42), "root"),
    Bone("spine", (0.0, 0.0, 0.42), (0.0, 0.0, 0.68), "hips"),
    Bone("head", (0.0, 0.0, 0.68), (0.0, 0.0, 0.98), "spine"),
    *_sided("upper_arm", (0.17, 0.0, 0.62), (0.225, 0.0, 0.51), "spine"),
    *_sided("forearm", (0.225, 0.0, 0.51), (0.26, 0.0, 0.415), "upper_arm_{side}"),
    *_sided("hand", (0.26, 0.0, 0.415), (0.275, 0.0, 0.35), "forearm_{side}"),
    *_sided("thigh", (0.085, 0.0, 0.30), (0.085, 0.0, 0.17), "hips"),
    *_sided("shin", (0.085, 0.0, 0.17), (0.085, 0.0, 0.06), "thigh_{side}"),
    *_sided("foot", (0.085, 0.0, 0.06), (0.085, -0.09, 0.03), "shin_{side}"),
    Bone("tail", (0.0, 0.11, 0.33), (0.0, 0.2, 0.40), "hips"),
)
BONE_NAMES: Tuple[str, ...] = tuple(b.name for b in BONES)
BONES_BY_NAME: Dict[str, Bone] = {b.name: b for b in BONES}

HEIGHT_M = 1.18
"""Top of the skull (ears and hats go higher). Doors are 2.2 m, so the chibi reads small."""
HEAD_ORIGIN_Z = 0.68
"""The ``head`` socket: the neck top, where every head mesh has its origin."""
SIT_HEIGHT_M = 0.11
"""In the ``sit`` clip the pelvis rests this high above the pivot: put the pivot this far
below a seat top (the hips drop by the thigh length, 0.13 m)."""


# --- sockets -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Socket:
    """A named attachment point. Body sockets are empties parented to a bone; head sockets
    are empties inside each head GLB, relative to the head origin."""

    name: str
    pos: Vec3
    bone: Optional[str] = None


BODY_SOCKETS: Tuple[Socket, ...] = (
    Socket("head", (0.0, 0.0, HEAD_ORIGIN_Z), "head"),
    Socket("neck", (0.0, -0.10, 0.665), "spine"),
    Socket("chest", (0.0, 0.0, 0.53), "spine"),
    Socket("hips", (0.0, 0.0, 0.34), "hips"),
    Socket("tail", (0.0, 0.11, 0.33), "tail"),
    Socket("hand_l", (0.268, 0.0, 0.385), "hand_l"),
    Socket("hand_r", (-0.268, 0.0, 0.385), "hand_r"),
    Socket("foot_l", (0.085, -0.03, 0.0), "foot_l"),
    Socket("foot_r", (-0.085, -0.03, 0.0), "foot_r"),
)
BODY_SOCKET_NAMES: Tuple[str, ...] = tuple(s.name for s in BODY_SOCKETS)
HEAD_SOCKET_NAMES: Tuple[str, ...] = ("hat", "face", "ear_l", "ear_r")
"""Every head defines these (its own skull size decides where)."""
SOCKET_NODE_PREFIX = "socket_"
"""Node names are ``socket_<name>`` (three.js strips dots from node names, so no dots)."""


# --- materials -----------------------------------------------------------------------------

MATERIAL_SLOTS: Mapping[str, bool] = {
    "fur": True,
    "shirt": True,
    "trousers": True,
    "eyes": False,
    "markings": False,
    "outfit": False,
}
"""Slot name -> tintable. Tintable slots have white vertex colours (with a little hand-painted
jitter) and the client sets ``material.color``; the others carry their colours in COLOR_0.
Material extras: ``hv_slot`` (the name) and ``hv_tint``."""
BODY_SLOTS: Tuple[str, ...] = ("fur", "shirt", "trousers")
HEAD_SLOTS: Tuple[str, ...] = ("fur", "eyes")
"""Slots every head must use (markings are optional)."""


# --- animations ----------------------------------------------------------------------------

ANIMATION_NAMES: Tuple[str, ...] = (
    "idle",
    "walk",
    "run",
    "sit",
    "talk",
    "wave",
    "fish_cast",
    "fish_reel",
    "eat",
    "cheer",
    "laugh",
    "heart",
    "think",
    "clap",
)

Rot = Tuple[float, float, float]
"""Euler degrees about the armature axes (X, then Y, then Z), relative to the parent, as if
the bone were at rest: see ``hvchars.animations`` for the sign conventions."""


@dataclass(frozen=True)
class BonePose:
    rot: Rot = (0.0, 0.0, 0.0)
    loc: Vec3 = (0.0, 0.0, 0.0)
    """Armature-axis offset of the bone head (only the hips move)."""


Pose = Mapping[str, BonePose]


@dataclass(frozen=True)
class Clip:
    name: str
    frames: int
    """Length in frames at :data:`FPS`; keys run from 0 to ``frames``."""
    loop: bool
    keys: Tuple[Tuple[int, Pose], ...]
    showcase: int = 0
    """The key frame the contact sheet shows."""

    @property
    def duration(self) -> float:
        return self.frames / FPS

    def pose_at_key(self, frame: int) -> Pose:
        for f, pose in self.keys:
            if f == frame:
                return pose
        raise KeyError(f"{self.name}: no key at frame {frame}")

    def errors(self) -> List[str]:
        out: List[str] = []
        frames = [f for f, _ in self.keys]
        if frames != sorted(frames) or len(set(frames)) != len(frames):
            out.append(f"{self.name}: key frames must be increasing")
        if not frames or frames[0] != 0 or frames[-1] != self.frames:
            out.append(f"{self.name}: keys must span 0..{self.frames}")
        for _, pose in self.keys:
            unknown = sorted(set(pose) - set(BONE_NAMES))
            if unknown:
                out.append(f"{self.name}: unknown bones {unknown}")
        if self.loop and self.keys and self.keys[0][1] != self.keys[-1][1]:
            out.append(f"{self.name}: a looping clip must end where it starts")
        if self.showcase not in frames:
            out.append(f"{self.name}: showcase frame {self.showcase} is not a key")
        return out


# --- budgets -------------------------------------------------------------------------------

BODY_TRI_BUDGET = (500, 3000)
ANIMAL_TRI_BUDGET = (200, 3000)
"""Everything in one animal GLB: head, tail and optional parts."""
OUTFIT_TRI_BUDGET = (12, 1500)
"""Everything in one NPC outfit GLB."""


# --- manifest ------------------------------------------------------------------------------


@dataclass
class PartResult:
    name: str
    socket: str
    tris: int
    default: bool = True


@dataclass
class FileResult:
    id: str
    file: str
    parts: List[PartResult] = field(default_factory=list)
    sockets: Tuple[str, ...] = ()

    @property
    def tris(self) -> int:
        return sum(p.tris for p in self.parts)


def gltf(v: Vec3) -> List[float]:
    return grid.round_vec(grid.blender_to_gltf(v))


def build_manifest(
    body_tris: int,
    clips: Sequence[Clip],
    animals: Sequence[FileResult],
    outfits: Sequence[FileResult],
) -> Dict[str, Any]:
    return {
        "version": CHARACTER_MANIFEST_VERSION,
        "generator": f"{GENERATOR}/{GENERATOR_VERSION}",
        "fps": FPS,
        "height": HEIGHT_M,
        "sitHeight": SIT_HEIGHT_M,
        "slots": {name: {"tint": tint} for name, tint in MATERIAL_SLOTS.items()},
        "body": {
            "file": BODY_FILE,
            "tris": int(body_tris),
            "bones": list(BONE_NAMES),
            "slots": list(BODY_SLOTS),
            "sockets": [{"name": s.name, "bone": s.bone, "pos": gltf(s.pos)} for s in BODY_SOCKETS],
        },
        "animations": [{"name": c.name, "duration": round(c.duration, 4), "loop": c.loop} for c in clips],
        "animals": [_file_entry(a, with_sockets=True) for a in animals],
        "outfits": [_file_entry(o, with_sockets=False) for o in outfits],
    }


def _file_entry(r: FileResult, with_sockets: bool) -> Dict[str, Any]:
    entry: Dict[str, Any] = {
        "id": r.id,
        "file": r.file,
        "tris": r.tris,
        "parts": [{"name": p.name, "socket": p.socket, "default": p.default, "tris": p.tris} for p in r.parts],
    }
    if with_sockets:
        entry["sockets"] = list(r.sockets)
    return entry


def validate_manifest(m: Any, animal_ids: Sequence[str] = (), outfit_ids: Sequence[str] = ()) -> List[str]:
    """Structural and budget checks (empty = valid). ``animal_ids``/``outfit_ids``, when
    given, must match the manifest exactly."""
    errors: List[str] = []
    if not isinstance(m, dict):
        return ["manifest must be an object"]
    if m.get("version") != CHARACTER_MANIFEST_VERSION:
        errors.append(f"version must be {CHARACTER_MANIFEST_VERSION}")
    body = m.get("body") or {}
    if body.get("bones") != list(BONE_NAMES):
        errors.append("body.bones must list the shared skeleton")
    if body.get("slots") != list(BODY_SLOTS):
        errors.append(f"body.slots must be {list(BODY_SLOTS)}")
    if [s.get("name") for s in body.get("sockets", [])] != list(BODY_SOCKET_NAMES):
        errors.append("body.sockets must list the body sockets")
    errors += _budget("body", body.get("tris"), BODY_TRI_BUDGET)
    if [a.get("name") for a in m.get("animations", [])] != list(ANIMATION_NAMES):
        errors.append(f"animations must be {list(ANIMATION_NAMES)}")
    for a in m.get("animations", []):
        if not isinstance(a.get("duration"), (int, float)) or a["duration"] <= 0:
            errors.append(f"animation {a.get('name')}: duration must be > 0")
    errors += _files(m.get("animals"), "animals", animal_ids, ANIMAL_TRI_BUDGET, BODY_SOCKET_NAMES)
    errors += _files(m.get("outfits"), "outfits", outfit_ids, OUTFIT_TRI_BUDGET, BODY_SOCKET_NAMES + HEAD_SOCKET_NAMES)
    for a in m.get("animals") or []:
        if list(a.get("sockets", [])) != list(HEAD_SOCKET_NAMES):
            errors.append(f"animal {a.get('id')}: sockets must be {list(HEAD_SOCKET_NAMES)}")
        if not any(p.get("name") == "head" and p.get("socket") == "head" for p in a.get("parts", [])):
            errors.append(f"animal {a.get('id')}: needs a head part on the head socket")
    return errors


def _budget(label: str, tris: Any, budget: Tuple[int, int]) -> List[str]:
    if not isinstance(tris, int) or not budget[0] <= tris <= budget[1]:
        return [f"{label}: {tris} tris outside {budget[0]}-{budget[1]}"]
    return []


def _files(entries: Any, label: str, ids: Sequence[str], budget: Tuple[int, int], sockets: Sequence[str]) -> List[str]:
    if not isinstance(entries, list):
        return [f"{label} must be a list"]
    errors: List[str] = []
    got = [e.get("id") for e in entries]
    if ids and sorted(got) != sorted(ids):
        errors.append(f"{label}: expected {sorted(ids)}, got {sorted(got)}")
    if len(set(got)) != len(got):
        errors.append(f"{label}: duplicate ids")
    for e in entries:
        eid = e.get("id")
        if not isinstance(e.get("file"), str) or not e["file"].endswith(".glb"):
            errors.append(f"{label} {eid}: file must be a .glb")
        errors += _budget(f"{label} {eid}", e.get("tris"), budget)
        parts = e.get("parts") or []
        if not parts:
            errors.append(f"{label} {eid}: has no parts")
        names = [p.get("name") for p in parts]
        if len(set(names)) != len(names):
            errors.append(f"{label} {eid}: duplicate part names")
        for p in parts:
            if not NAME_RE.match(str(p.get("name"))):
                errors.append(f"{label} {eid}: invalid part name {p.get('name')!r}")
            if p.get("socket") not in sockets:
                errors.append(f"{label} {eid}: part {p.get('name')} uses unknown socket {p.get('socket')!r}")
        if sum(int(p.get("tris", 0)) for p in parts) != e.get("tris"):
            errors.append(f"{label} {eid}: tris must be the sum of its parts")
    return errors
