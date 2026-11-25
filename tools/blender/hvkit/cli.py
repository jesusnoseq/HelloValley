"""Command-line parsing and build planning for build.py (pure Python).

    blender --background --factory-startup --python tools/blender/build.py -- \\
        --style europe --out packages/client/public/assets/kits [--modules test.cube]
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence

from .manifest import MANIFEST_FILE
from .module import Module, select_modules
from .styles import StyleParams, get_style
from .variants import DEFAULT_SEED

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEFAULT_OUT = os.path.join("packages", "client", "public", "assets", "kits")
DEFAULT_CHARACTERS_OUT = os.path.join("packages", "client", "public", "assets", "characters")
ATLAS_FILE = "atlas.png"

MIN_BLENDER = (4, 2, 0)
"""Oldest Blender whose glTF exporter has the options we use (``export_vertex_color``)."""
TARGET_BLENDER = (5, 2, 0)
"""The LTS the framework targets (README)."""


def script_args(argv: Sequence[str]) -> List[str]:
    """Blender passes its own arguments first; ours come after ``--``."""
    argv = list(argv)
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="build.py",
        description="Generate a HelloValley style kit (GLB modules + kit-manifest.json).",
    )
    p.add_argument("--style", default="european", help="style id (european, or the alias europe)")
    p.add_argument("--out", default=DEFAULT_OUT, help="kits root; the kit goes to <out>/<style>/")
    p.add_argument(
        "--modules",
        default="",
        help="comma-separated module ids or prefix globs (wall.*); default: every non-test module",
    )
    p.add_argument("--include-tests", action="store_true", help="also build test modules")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED, help="base seed for variants")
    p.add_argument("--strict", action="store_true", help="fail on budget or bounds problems")
    p.add_argument("--no-atlas", action="store_true", help="skip writing the style atlas")
    p.add_argument("--dry-run", action="store_true", help="print the plan and exit (no Blender needed)")
    p.add_argument(
        "--characters",
        action="store_true",
        help="build the character set (body + animations, animal heads, NPC outfits) instead of a kit; "
        f"--out is then the characters folder (default {DEFAULT_CHARACTERS_OUT})",
    )
    p.add_argument(
        "--contact-sheet",
        default="",
        metavar="PNG",
        help="render every selected module and variant to this PNG instead of exporting GLBs",
    )
    return p


def parse_args(args: Sequence[str]) -> argparse.Namespace:
    return build_parser().parse_args(list(args))


@dataclass
class BuildPlan:
    style: StyleParams
    out_dir: str
    """The style's kit folder: <out>/<style id>."""
    modules: List[Module]
    seed: int = DEFAULT_SEED
    strict: bool = False
    write_atlas: bool = True
    contact_sheet: str = ""
    """When set, render a contact sheet PNG to this path instead of exporting the kit."""

    @property
    def manifest_path(self) -> str:
        return os.path.join(self.out_dir, MANIFEST_FILE)

    @property
    def atlas_path(self) -> str:
        return os.path.join(self.out_dir, ATLAS_FILE)

    def describe(self) -> str:
        target = f"contact sheet {self.contact_sheet}" if self.contact_sheet else self.out_dir
        lines = [f"style {self.style.id} -> {target}"]
        for m in self.modules:
            lines.append(f"  {m.id:<24} {m.variants} variants  -> {m.file_name}")
        if not self.modules:
            lines.append("  (no modules selected)")
        return "\n".join(lines)


def make_plan(ns: argparse.Namespace, root: str = REPO_ROOT) -> BuildPlan:
    style = get_style(ns.style)
    only: Optional[List[str]] = [s.strip() for s in ns.modules.split(",") if s.strip()] or None
    modules = select_modules(style.id, only=only, include_tests=ns.include_tests)
    out = ns.out if os.path.isabs(ns.out) else os.path.join(root, ns.out)
    return BuildPlan(
        style=style,
        out_dir=os.path.normpath(os.path.join(out, style.id)),
        modules=modules,
        seed=ns.seed,
        strict=ns.strict,
        write_atlas=not ns.no_atlas,
        contact_sheet=_abs(ns.contact_sheet, root) if ns.contact_sheet else "",
    )


@dataclass
class CharacterPlan:
    """``--characters``: the shared body, the 16 animals and the 9 NPC outfits (M07)."""

    out_dir: str
    strict: bool = False
    contact_sheet: str = ""
    seed: int = DEFAULT_SEED

    @property
    def manifest_path(self) -> str:
        from .character import CHARACTER_MANIFEST_FILE

        return os.path.join(self.out_dir, CHARACTER_MANIFEST_FILE)

    def describe(self) -> str:
        from hvchars import ANIMAL_IDS, OUTFIT_IDS
        from hvchars.animations import CLIPS

        target = f"contact sheet {self.contact_sheet}" if self.contact_sheet else self.out_dir
        return "\n".join(
            [
                f"characters -> {target}",
                f"  body.glb                 {len(CLIPS)} animations: {', '.join(c.name for c in CLIPS)}",
                f"  animal.*.glb             {len(ANIMAL_IDS)} animals: {', '.join(ANIMAL_IDS)}",
                f"  outfit.*.glb             {len(OUTFIT_IDS)} NPC outfits: {', '.join(OUTFIT_IDS)}",
            ]
        )


def make_character_plan(ns: argparse.Namespace, root: str = REPO_ROOT) -> CharacterPlan:
    out = DEFAULT_CHARACTERS_OUT if os.path.normpath(ns.out) == os.path.normpath(DEFAULT_OUT) else ns.out
    return CharacterPlan(
        out_dir=_abs(out, root),
        strict=ns.strict,
        contact_sheet=_abs(ns.contact_sheet, root) if ns.contact_sheet else "",
        seed=ns.seed,
    )


def _abs(path: str, root: str) -> str:
    return os.path.normpath(path if os.path.isabs(path) else os.path.join(root, path))


def version_ok(version: Sequence[int]) -> bool:
    return tuple(version[:3]) >= MIN_BLENDER
