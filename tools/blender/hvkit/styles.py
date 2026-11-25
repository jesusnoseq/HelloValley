"""Per-style generator parameters (GDD §7.2: palettes, wall thickness, roof pitch, eave
overhang, bevel and noise amounts, seeded variation).

Style ids match ``STYLE_IDS`` in ``packages/shared/src/data/styles.ts`` (a unit test checks
this). The kit folder is named after the id: ``kits/european/``. The build plan's
``--style europe`` is accepted as an alias.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Mapping, Tuple

from .atlas import Atlas, AtlasLayout, AtlasTile
from .color import RGBA, hex_to_linear_rgba
from .variants import DEFAULT_SEED

STYLE_IDS: Tuple[str, ...] = ("european", "mediterranean", "arabic", "japanese")

STYLE_ALIASES: Mapping[str, str] = {
    "europe": "european",
    "eu": "european",
    "med": "mediterranean",
    "mediterranean": "mediterranean",
    "arab": "arabic",
    "japan": "japanese",
    "jp": "japanese",
}

# Tiles every style atlas has, in this order, so shared (style-neutral) modules can always
# reference them. Styles append their own tiles after these.
COMMON_TILES: Tuple[AtlasTile, ...] = (
    AtlasTile("plain", "plain", 0.0),
    AtlasTile("plaster", "plaster", 0.08),
    AtlasTile("wood", "planks", 0.10),
    AtlasTile("stone", "cobble", 0.12),
)


@dataclass(frozen=True)
class StyleParams:
    id: str
    english_name: str
    palette: Mapping[str, Tuple[str, ...]]
    """sRGB hex swatches grouped as walls, roofs, trims, foliage, ground, accents (art.md §2.5),
    plus glass, light and iron for windows, lamps and metalwork."""
    tiles: Tuple[AtlasTile, ...] = ()
    seed: int = DEFAULT_SEED
    wall_thickness_m: float = 0.2
    roof_pitch_deg: float = 45.0
    eave_overhang_m: float = 0.25
    bevel_width_m: float = 0.03
    bevel_segments: int = 2
    vertex_noise_m: float = 0.008
    """Positional jitter for the hand-made, slightly irregular look. Keep it well under the
    bevel width so silhouettes stay clean."""
    colour_jitter: float = 0.06
    """Per-vertex brightness variation (fraction), the "subtle hand-painted" part."""
    extra: Mapping[str, float] = field(default_factory=dict)

    def atlas(self) -> Atlas:
        return Atlas(COMMON_TILES + self.tiles, AtlasLayout())

    def swatch(self, group: str, index: int = 0) -> str:
        try:
            swatches = self.palette[group]
        except KeyError:
            raise KeyError(f"style {self.id} has no palette group {group!r}") from None
        return swatches[index % len(swatches)]

    def linear(self, group: str, index: int = 0, alpha: float = 1.0) -> RGBA:
        return hex_to_linear_rgba(self.swatch(group, index), alpha)


EUROPEAN = StyleParams(
    id="european",
    english_name="Central & Northern European",
    palette={
        # Pastel plaster: cream, butter, sage, blush.
        "walls": ("#f3e9d2", "#f6e3a1", "#c9d8b6", "#f1d3c9"),
        # Brick-red clay and slate.
        "roofs": ("#b8574a", "#c96f55", "#6f7a86"),
        # Dark timbering, white window trims.
        "trims": ("#5a4033", "#f7f3ea", "#7b5b45"),
        "foliage": ("#8fb573", "#6e9b5a", "#b5cf8c"),
        "ground": ("#c9c2b4", "#a8a093", "#9dbb7d"),
        # Geranium red, shutter green, lamp brass.
        "accents": ("#d9534f", "#6f9a7a", "#d8b26e"),
        # Window panes (a cool, slightly dusky blue-grey) and warm lamp light.
        "glass": ("#8fa9b8", "#a7bcc4"),
        "light": ("#ffdf9e",),
        # Wrought iron (signs, railings, lamp posts).
        "iron": ("#3f4448", "#55524d"),
    },
    tiles=(
        AtlasTile("timber", "planks", 0.12),
        AtlasTile("roof_clay", "tiles", 0.12),
        AtlasTile("roof_slate", "tiles", 0.10),
        AtlasTile("brick", "bricks", 0.10),
        AtlasTile("cobble", "cobble", 0.14),
    ),
    wall_thickness_m=0.2,
    roof_pitch_deg=50.0,  # steep gables
    eave_overhang_m=0.25,
    bevel_width_m=0.03,
    bevel_segments=2,
    vertex_noise_m=0.006,
    colour_jitter=0.06,
)

_STYLES: Dict[str, StyleParams] = {"european": EUROPEAN}

_PENDING = {"mediterranean": "M32", "arabic": "M33", "japanese": "M34"}


def resolve_style_id(name: str) -> str:
    key = name.strip().lower()
    key = STYLE_ALIASES.get(key, key)
    if key not in STYLE_IDS:
        raise ValueError(f"unknown style {name!r}; expected one of {', '.join(STYLE_IDS)} (or 'europe')")
    return key


def get_style(name: str) -> StyleParams:
    style_id = resolve_style_id(name)
    if style_id in _PENDING:
        # TODO(M32/M33/M34): add the Mediterranean, Arabic and Japanese parameters.
        raise NotImplementedError(f"style {style_id!r} arrives in {_PENDING[style_id]}")
    return _STYLES[style_id]


def available_styles() -> Tuple[str, ...]:
    return tuple(sorted(_STYLES))
