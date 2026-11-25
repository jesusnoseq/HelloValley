"""The Module base class and registry.

A module is one semantic kit piece (``wall.plain``, ``roof.gable``...). Every style's module
for a given id has the same footprint and sockets, so style-agnostic building recipes work
in all styles (GDD §7.2). Subclasses declare metadata as class attributes and implement:

- :meth:`Module.variant_params` (pure, testable): the seeded choices for one variant.
- :meth:`Module.build` (Blender only): create the objects for one variant.

Subclasses import ``bpy`` and ``hvkit.blender`` *inside* ``build`` so the class itself stays
importable without Blender.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Sequence, Tuple, Type

from . import grid
from .grid import EPSILON, Footprint, Placement, Vec3
from .variants import DEFAULT_SEED, DEFAULT_VARIANTS, VariantRng

if TYPE_CHECKING:  # pragma: no cover
    from .styles import StyleParams

MODULE_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$")
SOCKET_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
SOCKET_KINDS = ("stack", "attach", "edge", "prop")
CANOPY_PART = "canopy"
"""``hv_part`` extras value of a canopy mesh (``KIT_CANOPY_PART`` in packages/shared)."""
CANOPY_MATERIAL = "canopy"
"""BuildContext material key of the canopy slot (extras ``hv_atlas`` + ``hv_canopy``)."""
"""stack: another storey/roof sits here; attach: wall-mounted parts (signs, flowerboxes);
edge: neighbour modules snap side by side; prop: free props (lamps, benches)."""


@dataclass(frozen=True)
class Socket:
    """A named attachment point, authored in Blender space (Z up, front at -Y)."""

    name: str
    kind: str
    pos: Vec3
    normal: Vec3 = (0.0, 0.0, 1.0)

    def to_json(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "pos": grid.round_vec(grid.blender_to_gltf(self.pos)),
            "normal": grid.round_vec(grid.blender_to_gltf(self.normal)),
        }


class Module:
    id: str = ""
    footprint: Footprint = Footprint()
    sockets: Tuple[Socket, ...] = ()
    variants: int = DEFAULT_VARIANTS
    styles: Optional[Tuple[str, ...]] = None
    """Kit ids this module is generated for (a style id, or ``common`` for the style-neutral
    kit); ``None`` = every kit (test modules)."""
    tags: Tuple[str, ...] = ()
    test: bool = False
    """Test modules are built only when asked for (``--modules`` or ``--include-tests``)."""
    tri_budget: Optional[Tuple[int, int]] = None
    """(min, max) triangles per variant, checked after export (GDD §7.2 budgets)."""
    max_overhang_m: float = 0.0
    """How far geometry may stick out past the footprint box (eaves, awnings)."""
    sink_m: float = 0.0
    """How far geometry may go below the pivot (river beds, bridge footings, dock posts). The
    pivot stays at ground level; the footprint box starts at ``z = -sink_m``."""
    canopy: bool = False
    """The module has a wind-swayed canopy: meshes whose ``hv_part`` is ``canopy`` use only the
    ``canopy`` material and no other mesh uses it (checked after every build)."""
    trunk: bool = False
    """With ``canopy``: the module also needs at least one non-canopy mesh (a tree trunk)."""
    placement: Optional[Placement] = None
    """Furniture (M08): the footprint on the 0.5 m placement grid, written to the manifest.
    The geometry must then stay inside the placement box, not just the 1 m footprint."""

    # --- metadata ------------------------------------------------------------------------

    @property
    def file_name(self) -> str:
        return f"{self.id}.glb"

    def applies_to(self, style_id: str) -> bool:
        return self.styles is None or style_id in self.styles

    def rng(self, style_id: str, variant: int, base_seed: int = DEFAULT_SEED) -> VariantRng:
        return VariantRng.for_variant(style_id, self.id, variant, base_seed)

    def nominal_bounds(self) -> Tuple[Vec3, Vec3]:
        """Blender-space footprint box (pivot at the origin), extended down by ``sink_m``. For
        furniture it is the placement box (``placement.width_m`` x ``placement.depth_m``)."""
        lo, hi = grid.footprint_bounds_blender(self.footprint)
        if self.placement is not None:
            hi = (self.placement.width_m, self.placement.depth_m, hi[2])
        return (lo[0], lo[1], lo[2] - self.sink_m), hi

    def definition_errors(self) -> List[str]:
        """Static checks on the declaration (no Blender needed)."""
        errors: List[str] = []
        label = self.id or type(self).__name__
        if not MODULE_ID_RE.match(self.id):
            errors.append(f"{label}: id must be dotted lowercase (e.g. wall.plain)")
        if self.variants < 1:
            errors.append(f"{label}: needs at least one variant")
        if self.tri_budget is not None:
            lo, hi = self.tri_budget
            if lo < 0 or hi < lo:
                errors.append(f"{label}: invalid tri budget {self.tri_budget}")
        if self.sink_m < 0:
            errors.append(f"{label}: sink_m must be >= 0")
        if self.trunk and not self.canopy:
            errors.append(f"{label}: trunk needs canopy")
        if self.canopy and "canopy" not in self.tags:
            errors.append(f"{label}: canopy modules need the 'canopy' tag")
        if self.placement is not None:
            expected = self.placement.footprint(self.footprint.h)
            if (self.footprint.w, self.footprint.d) != (expected.w, expected.d):
                errors.append(f"{label}: footprint must be {expected.w}x{expected.d} cells to hold its placement")
        names = [s.name for s in self.sockets]
        if len(set(names)) != len(names):
            errors.append(f"{label}: socket names must be unique")
        lo, hi = self.nominal_bounds()
        slack = self.max_overhang_m + EPSILON
        for s in self.sockets:
            if not SOCKET_NAME_RE.match(s.name):
                errors.append(f"{label}: invalid socket name {s.name!r}")
            if s.kind not in SOCKET_KINDS:
                errors.append(f"{label}: socket {s.name} has unknown kind {s.kind!r}")
            if any(s.pos[i] < lo[i] - slack or s.pos[i] > hi[i] + slack for i in range(3)):
                errors.append(f"{label}: socket {s.name} lies outside the footprint")
            length = sum(c * c for c in s.normal) ** 0.5
            if abs(length - 1.0) > 1e-3:
                errors.append(f"{label}: socket {s.name} normal must be unit length")
        return errors

    def bounds_errors(self, lo: Sequence[float], hi: Sequence[float]) -> List[str]:
        """Check exported Blender-space bounds against the footprint and pivot."""
        errors: List[str] = []
        nlo, nhi = self.nominal_bounds()
        slack = self.max_overhang_m + EPSILON
        for axis, name in enumerate("xyz"):
            if lo[axis] < nlo[axis] - slack:
                errors.append(f"{self.id}: geometry starts at {name}={lo[axis]:.4f}, before the pivot")
            if hi[axis] > nhi[axis] + slack:
                errors.append(f"{self.id}: geometry ends at {name}={hi[axis]:.4f}, past the footprint")
        return errors

    def part_errors(self, parts: Sequence[Tuple[str, Sequence[str]]]) -> List[str]:
        """Check one built variant's meshes, given as ``(hv_part, material keys)`` pairs:
        canopy modules keep the canopy in its own mesh and material slot (M06) so the client
        can sway it in a vertex shader; no other module uses the canopy material."""
        errors: List[str] = []
        canopy = [mats for part, mats in parts if part == CANOPY_PART]
        others = [mats for part, mats in parts if part != CANOPY_PART]
        if self.canopy and not canopy:
            errors.append(f"{self.id}: no '{CANOPY_PART}' mesh")
        if not self.canopy and canopy:
            errors.append(f"{self.id}: has a '{CANOPY_PART}' mesh but is not a canopy module")
        for mats in canopy:
            if list(mats) != [CANOPY_MATERIAL]:
                errors.append(f"{self.id}: canopy mesh must use only the {CANOPY_MATERIAL!r} material, has {list(mats)}")
        for mats in others:
            if CANOPY_MATERIAL in mats:
                errors.append(f"{self.id}: the {CANOPY_MATERIAL!r} material is used outside the canopy mesh")
        if self.trunk and not others:
            errors.append(f"{self.id}: no trunk mesh next to the canopy")
        return errors

    # --- generation ----------------------------------------------------------------------

    def variant_params(self, style: "StyleParams", variant: int, rng: VariantRng) -> Dict[str, Any]:
        """Seeded choices for one variant (sizes, swatches, toggles). Pure: override and test."""
        return {}

    def build(self, ctx: Any, variant: int, params: Dict[str, Any], rng: VariantRng) -> List[Any]:
        """Create the Blender objects for one variant and return them. Blender only."""
        raise NotImplementedError(f"{type(self).__name__}.build")


# --- registry ------------------------------------------------------------------------------

_REGISTRY: Dict[str, Module] = {}


def register(cls: Type[Module]) -> Type[Module]:
    """Class decorator: instantiate and register a module. Ids must be unique."""
    instance = cls()
    errors = instance.definition_errors()
    if errors:
        raise ValueError("; ".join(errors))
    if instance.id in _REGISTRY and type(_REGISTRY[instance.id]) is not cls:
        raise ValueError(f"duplicate module id {instance.id!r}")
    _REGISTRY[instance.id] = instance
    return cls


def all_modules() -> List[Module]:
    return [_REGISTRY[k] for k in sorted(_REGISTRY)]


def get_module(module_id: str) -> Module:
    try:
        return _REGISTRY[module_id]
    except KeyError:
        raise KeyError(f"unknown module {module_id!r}") from None


def select_modules(
    style_id: str, only: Optional[Iterable[str]] = None, include_tests: bool = False
) -> List[Module]:
    """Modules to build for a style. ``only`` (ids or ``prefix.*`` globs) overrides the test
    filter, so ``--modules test.cube`` builds the test cube."""
    candidates = [m for m in all_modules() if m.applies_to(style_id)]
    if only:
        patterns = list(only)
        unknown = [
            p for p in patterns if not p.endswith(".*") and p not in {m.id for m in all_modules()}
        ]
        if unknown:
            raise KeyError(f"unknown module(s): {', '.join(unknown)}")

        def wanted(mid: str) -> bool:
            return any(mid == p or (p.endswith(".*") and mid.startswith(p[:-1])) for p in patterns)

        return [m for m in candidates if wanted(m.id)]
    return [m for m in candidates if include_tests or not m.test]
