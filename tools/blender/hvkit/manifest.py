"""kit-manifest.json building and validation (pure Python).

The format is mirrored by the zod schema in ``packages/shared/src/assets/kit.ts``; the client
validates every manifest it loads with it. All coordinates in the manifest are glTF space
(metres, Y up, the module front at z = 0 looking towards +Z).

    {
      "version": 1,
      "generator": "hellovalley-blender/1",
      "style": "european",
      "grid": {"cell": 1.0, "storey": 3.0},
      "atlas": {"file": "atlas.png", "size": 512, "tiles": {"plaster": [u0, v0, u1, v1]}},
      "modules": [
        {"id": "test.cube", "file": "test.cube.glb",
         "footprint": {"w": 1, "d": 1, "h": 1.0},
         "variants": 3,
         "bounds": {"min": [0, 0, -1], "max": [1, 1, 0]},
         "sockets": [{"name": "top", "kind": "stack", "pos": [...], "normal": [...]}],
         "tris": [12, 12, 12],
         "tags": ["test"]}
      ]
    }
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import GENERATOR, GENERATOR_VERSION, grid
from .module import MODULE_ID_RE, SOCKET_KINDS, Module

MANIFEST_VERSION = 1
MANIFEST_FILE = "kit-manifest.json"
FILE_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*\.(glb|png|webp|ktx2)$")


@dataclass(frozen=True)
class VariantResult:
    """What the exporter measured for one variant, in Blender space."""

    bounds_min: Tuple[float, float, float]
    bounds_max: Tuple[float, float, float]
    tris: int


def module_entry(module: Module, results: Sequence[VariantResult], file: Optional[str] = None) -> Dict[str, Any]:
    if len(results) != module.variants:
        raise ValueError(f"{module.id}: expected {module.variants} variant results, got {len(results)}")
    lo, hi = grid.union_bounds((r.bounds_min, r.bounds_max) for r in results)
    glo, ghi = grid.blender_bounds_to_gltf(lo, hi)
    return {
        "id": module.id,
        "file": file or module.file_name,
        "footprint": module.footprint.to_json(),
        "variants": module.variants,
        "bounds": {"min": grid.round_vec(glo), "max": grid.round_vec(ghi)},
        "sockets": [s.to_json() for s in module.sockets],
        "tris": [int(r.tris) for r in results],
        "tags": list(module.tags),
    }


def atlas_entry(file: str, size: int, tiles_blender_uv: Dict[str, Sequence[float]]) -> Dict[str, Any]:
    """Atlas tile rects converted from Blender UVs (v up) to glTF UVs (v down)."""
    tiles = {}
    for name, (u0, v0, u1, v1) in sorted(tiles_blender_uv.items()):
        tiles[name] = [round(u0, 6), round(1.0 - v1, 6), round(u1, 6), round(1.0 - v0, 6)]
    return {"file": file, "size": int(size), "tiles": tiles}


def build_manifest(style_id: str, entries: Sequence[Dict[str, Any]], atlas: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "version": MANIFEST_VERSION,
        "generator": f"{GENERATOR}/{GENERATOR_VERSION}",
        "style": style_id,
        "grid": {"cell": grid.CELL_M, "storey": grid.STOREY_M},
        "atlas": atlas,
        "modules": sorted(entries, key=lambda e: e["id"]),
    }


def merge_manifest(existing: Optional[Dict[str, Any]], fresh: Dict[str, Any]) -> Dict[str, Any]:
    """Keep modules from a previous build that this (partial, ``--modules``) build did not
    regenerate."""
    if not existing or existing.get("style") != fresh["style"]:
        return fresh
    rebuilt = {e["id"] for e in fresh["modules"]}
    kept = [e for e in existing.get("modules", []) if e.get("id") not in rebuilt]
    merged = dict(fresh)
    merged["modules"] = sorted(kept + list(fresh["modules"]), key=lambda e: e["id"])
    if merged.get("atlas") is None:
        merged["atlas"] = existing.get("atlas")
    return merged


def dumps(manifest: Dict[str, Any]) -> str:
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"


def _is_vec3(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 3 and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in v)


def validate_manifest(m: Any) -> List[str]:
    """Structural validation; returns a list of problems (empty = valid)."""
    errors: List[str] = []
    if not isinstance(m, dict):
        return ["manifest must be an object"]
    if m.get("version") != MANIFEST_VERSION:
        errors.append(f"version must be {MANIFEST_VERSION}")
    if not isinstance(m.get("style"), str) or not m["style"]:
        errors.append("style must be a non-empty string")
    g = m.get("grid")
    if not isinstance(g, dict) or g.get("cell") != grid.CELL_M or g.get("storey") != grid.STOREY_M:
        errors.append(f"grid must be {{cell: {grid.CELL_M}, storey: {grid.STOREY_M}}}")
    atlas = m.get("atlas")
    if atlas is not None:
        if not isinstance(atlas, dict) or not FILE_RE.match(str(atlas.get("file", ""))):
            errors.append("atlas.file must be a png/webp/ktx2 file name")
        elif not isinstance(atlas.get("size"), int) or atlas["size"] <= 0:
            errors.append("atlas.size must be a positive integer")
        else:
            for name, rect in (atlas.get("tiles") or {}).items():
                ok = isinstance(rect, list) and len(rect) == 4 and all(isinstance(c, (int, float)) for c in rect)
                if not ok or not (0 <= rect[0] < rect[2] <= 1 and 0 <= rect[1] < rect[3] <= 1):
                    errors.append(f"atlas tile {name} has an invalid rect")
    modules = m.get("modules")
    if not isinstance(modules, list):
        return errors + ["modules must be a list"]
    seen = set()
    for i, e in enumerate(modules):
        label = f"modules[{i}]"
        if not isinstance(e, dict):
            errors.append(f"{label} must be an object")
            continue
        mid = e.get("id")
        if not isinstance(mid, str) or not MODULE_ID_RE.match(mid):
            errors.append(f"{label}: invalid id {mid!r}")
        else:
            label = mid
            if mid in seen:
                errors.append(f"{mid}: duplicate id")
            seen.add(mid)
        if not isinstance(e.get("file"), str) or not FILE_RE.match(e["file"]) or not e["file"].endswith(".glb"):
            errors.append(f"{label}: file must be a .glb name")
        fp = e.get("footprint")
        if not isinstance(fp, dict) or not all(isinstance(fp.get(k), int) and fp[k] >= 1 for k in ("w", "d")):
            errors.append(f"{label}: footprint needs integer w, d >= 1")
        elif not isinstance(fp.get("h"), (int, float)) or isinstance(fp.get("h"), bool) or fp["h"] < 0:
            errors.append(f"{label}: footprint.h must be >= 0")
        variants = e.get("variants")
        if not isinstance(variants, int) or isinstance(variants, bool) or variants < 1:
            errors.append(f"{label}: variants must be a positive integer")
        tris = e.get("tris")
        if not isinstance(tris, list) or not all(isinstance(t, int) and t >= 0 for t in tris):
            errors.append(f"{label}: tris must be a list of non-negative integers")
        elif isinstance(variants, int) and len(tris) != variants:
            errors.append(f"{label}: tris needs one count per variant")
        b = e.get("bounds")
        if not isinstance(b, dict) or not _is_vec3(b.get("min")) or not _is_vec3(b.get("max")):
            errors.append(f"{label}: bounds needs min and max vec3")
        elif any(lo > hi for lo, hi in zip(b["min"], b["max"])):
            errors.append(f"{label}: bounds min > max")
        sockets = e.get("sockets")
        if not isinstance(sockets, list):
            errors.append(f"{label}: sockets must be a list")
        else:
            names = set()
            for s in sockets:
                if not isinstance(s, dict) or not isinstance(s.get("name"), str):
                    errors.append(f"{label}: socket without a name")
                    continue
                if s["name"] in names:
                    errors.append(f"{label}: duplicate socket {s['name']}")
                names.add(s["name"])
                if s.get("kind") not in SOCKET_KINDS:
                    errors.append(f"{label}: socket {s['name']} has an unknown kind")
                if not _is_vec3(s.get("pos")) or not _is_vec3(s.get("normal")):
                    errors.append(f"{label}: socket {s['name']} needs pos and normal vec3")
        if not isinstance(e.get("tags", []), list):
            errors.append(f"{label}: tags must be a list")
    return errors


def budget_errors(module: Module, tris: Sequence[int]) -> List[str]:
    if module.tri_budget is None:
        return []
    lo, hi = module.tri_budget
    return [
        f"{module.id} v{i}: {t} tris outside the budget {lo}-{hi}"
        for i, t in enumerate(tris)
        if not lo <= t <= hi
    ]
