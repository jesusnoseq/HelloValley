"""Per-style generator parameters (GDD §7.2: palettes, wall thickness, roof pitch, eave
overhang, bevel and noise amounts, seeded variation).

Style ids match ``STYLE_IDS`` in ``packages/shared/src/data/styles.ts`` (a unit test checks
this). The kit folder is named after the id: ``kits/european/``. The build plan's
``--style europe`` is accepted as an alias.

``common`` is not a town style but the kit of style-neutral modules (terrain, river banks,
bridge, dock, fountain, vegetation and generic props, M06), built into ``kits/common/`` with
its own neutral palette and atlas. The client loads it next to whichever style kit the player
uses (``COMMON_KIT_ID`` in ``packages/shared/src/assets/kit.ts``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Mapping, Tuple

from .atlas import Atlas, AtlasLayout, AtlasTile
from .color import RGBA, hex_to_linear_rgba
from .variants import DEFAULT_SEED

STYLE_IDS: Tuple[str, ...] = ("european", "mediterranean", "arabic", "japanese")
COMMON_KIT_ID = "common"
"""The style-neutral kit (M06). Not a player-selectable style."""
KIT_IDS: Tuple[str, ...] = STYLE_IDS + (COMMON_KIT_ID,)

STYLE_ALIASES: Mapping[str, str] = {
    "europe": "european",
    "eu": "european",
    "med": "mediterranean",
    "mediterranean": "mediterranean",
    "arab": "arabic",
    "japan": "japanese",
    "jp": "japanese",
    "shared": COMMON_KIT_ID,
    "neutral": COMMON_KIT_ID,
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

COMMON = StyleParams(
    id=COMMON_KIT_ID,
    english_name="Style-neutral modules",
    palette={
        # Terrain (art.md §2: soft, sunny pastels that sit under every style).
        "grass": ("#9dc27a", "#8db86c", "#aacd84"),
        "path": ("#d8c196", "#cdb185", "#e0cda6"),
        "sand": ("#efdcab", "#e6cf98"),
        "cobble": ("#bdb6a8", "#a8a194", "#cbc4b5"),
        "earth": ("#b08f6a", "#987a5b"),
        "bed": ("#8b9a8c", "#77887c"),
        "water": ("#86c0cf", "#73b1c4"),
        # Vegetation.
        "foliage": ("#8fbf6e", "#76a95d", "#a7cf7e", "#6a9c5c"),
        "conifer": ("#56876a", "#4b7a5e", "#659674"),
        "blossom": ("#f6c3d0", "#f9d6df", "#eeaabd"),
        "olive": ("#a8b590", "#93a37f", "#b9c4a2"),
        "palm": ("#82b462", "#97c46f", "#6fa257"),
        "bark": ("#7d5d47", "#6b503e", "#917059"),
        "flowers": ("#f28c8c", "#f6d36b", "#b9a2e8", "#f7f3ea", "#f2a65e", "#8fb9e8"),
        # Built things: stone, timber, metal, cloth, paper.
        "stone": ("#d3ccbd", "#bdb5a6", "#a9a194"),
        "wood": ("#c69c6d", "#b0875c", "#d8b385"),
        "darkwood": ("#7b5b45", "#5f4636"),
        "iron": ("#4a4e52", "#5b5852"),
        "fabric": ("#f7f3ea", "#e98b7d", "#8fbad8", "#f2cf7a", "#a9cf8f"),
        "paper": ("#f8f2e2", "#efe3c6", "#e6eef3"),
        "produce": ("#e0584f", "#f0a73c", "#8cc063", "#e9c46a", "#b5694a"),
        "light": ("#ffdf9e",),
    },
    tiles=(
        AtlasTile("grass", "speckle", 0.12),
        AtlasTile("dirt", "speckle", 0.10),
        AtlasTile("sand", "speckle", 0.07),
        AtlasTile("cobble", "cobble", 0.14),
        AtlasTile("bark", "streaks", 0.14),
        AtlasTile("leaves", "speckle", 0.16),
        AtlasTile("pebbles", "cobble", 0.08),
    ),
    wall_thickness_m=0.2,
    roof_pitch_deg=35.0,
    eave_overhang_m=0.1,
    bevel_width_m=0.03,
    bevel_segments=2,
    vertex_noise_m=0.006,
    colour_jitter=0.07,
)

_STYLES: Dict[str, StyleParams] = {"european": EUROPEAN, COMMON_KIT_ID: COMMON}

_PENDING = {"mediterranean": "M32", "arabic": "M33", "japanese": "M34"}


def resolve_style_id(name: str) -> str:
    key = name.strip().lower()
    key = STYLE_ALIASES.get(key, key)
    if key not in KIT_IDS:
        raise ValueError(f"unknown style {name!r}; expected one of {', '.join(KIT_IDS)} (or 'europe')")
    return key


def get_style(name: str) -> StyleParams:
    style_id = resolve_style_id(name)
    if style_id in _PENDING:
        # TODO(M32/M33/M34): add the Mediterranean, Arabic and Japanese parameters.
        raise NotImplementedError(f"style {style_id!r} arrives in {_PENDING[style_id]}")
    return _STYLES[style_id]


def available_styles() -> Tuple[str, ...]:
    return tuple(sorted(_STYLES))
