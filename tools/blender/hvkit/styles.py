"""Per-style generator parameters (GDD §7.2: palettes, wall thickness, roof pitch, eave
overhang, bevel and noise amounts, seeded variation).

Style ids match ``STYLE_IDS`` in ``packages/shared/src/data/styles.ts`` (a unit test checks
this). The kit folder is named after the id: ``kits/european/``. The build plan's
``--style europe`` is accepted as an alias.

``common`` is not a town style but the kit of style-neutral modules (terrain, river banks,
bridge, dock, fountain, vegetation and generic props, M06), built into ``kits/common/`` with
its own neutral palette and atlas. The client loads it next to whichever style kit the player
uses (``COMMON_KIT_ID`` in ``packages/shared/src/assets/kit.ts``).

``interior`` is the interior and furniture kit (M08): room floor and wall panels, apartment
furniture and shop interiors, built into ``kits/interior/`` with a warm indoor palette
(``INTERIOR_KIT_ID``). Interiors are style-neutral: every town style uses the same kit.
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
INTERIOR_KIT_ID = "interior"
"""The interior and furniture kit (M08). Not a player-selectable style."""
KIT_IDS: Tuple[str, ...] = STYLE_IDS + (COMMON_KIT_ID, INTERIOR_KIT_ID)

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
    "interiors": INTERIOR_KIT_ID,
    "furniture": INTERIOR_KIT_ID,
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

MEDITERRANEAN = StyleParams(
    id="mediterranean",
    english_name="Mediterranean",
    palette={
        # Whitewash, ochre, apricot and warm cream stucco (art.md §2.2).
        "walls": ("#f7f4ec", "#e8c07a", "#efcaa6", "#f3e6cc"),
        # Terracotta: warm, sunny and faded.
        "roofs": ("#c96a40", "#da8552", "#b65a3a"),
        # White trims, weathered wood, sandstone.
        "trims": ("#faf8f2", "#8a6a4f", "#dac7a3"),
        "foliage": ("#8fae6b", "#6f9658", "#a9c07f", "#5e8c4c"),
        # Sun-bleached paving, warm flagstones, sand.
        "ground": ("#e8dfcc", "#cdbfa5", "#ead8b2"),
        # Shutter blue, sage, bougainvillea magenta, lemon yellow, tile teal.
        "accents": ("#4f86b8", "#87a98c", "#d6468e", "#f2d24b", "#5aa3a6"),
        "glass": ("#86a8bd", "#a2bccb"),
        "light": ("#ffdf9e",),
        "iron": ("#3c3f44", "#4f4b46"),
        # Plants: bougainvillea bracts, citrus, bark, terracotta pots.
        "blossom": ("#d6468e", "#e86aa8", "#c23b80", "#f2f0ea"),
        "citrus": ("#f2d24b", "#f5b942"),
        "bark": ("#7d5d47", "#8f6c52", "#6b503e"),
        "pot": ("#c7744a", "#d98a5c", "#b9633f"),
        # Painted ceramic tiles (azulejos): white ground, cobalt and teal.
        "ceramic": ("#f4f1e8", "#3f6fa8", "#5aa3a6", "#e3b04f"),
        # Geraniums, pinks, white jasmine, lavender; grapes on the pergola vines.
        "flowers": ("#e2574c", "#f08aa0", "#f7f3ea", "#b07ad0"),
        "grapes": ("#6d4a8c", "#7d5a9c"),
    },
    tiles=(
        AtlasTile("stucco", "plaster", 0.12),
        AtlasTile("timber", "planks", 0.12),
        AtlasTile("roof_clay", "tiles", 0.12),
        AtlasTile("terracotta", "tiles", 0.08),
        AtlasTile("paving", "cobble", 0.10),
        AtlasTile("leaves", "speckle", 0.16),
        AtlasTile("bark", "streaks", 0.14),
    ),
    wall_thickness_m=0.2,
    roof_pitch_deg=25.0,  # low terracotta roofs
    eave_overhang_m=0.2,
    bevel_width_m=0.035,
    bevel_segments=2,
    vertex_noise_m=0.007,
    colour_jitter=0.05,
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

INTERIOR = StyleParams(
    id=INTERIOR_KIT_ID,
    english_name="Interiors and furniture",
    palette={
        # Room surfaces: soft plaster and wallpaper pastels, wainscot and skirting.
        "walls": ("#f4ead6", "#f3d9cf", "#d7e3c8", "#d5e2ec"),
        "wainscot": ("#e9dcc4", "#c9d8c1", "#c8d6e3", "#ead1c4"),
        "trim": ("#f7f2e8", "#d9c4a5"),
        # Woods: light oak, honey, warm pine; walnut for dark accents.
        "wood": ("#d8b48a", "#c79a6b", "#e2c39b"),
        "darkwood": ("#7b5b45", "#5f4636", "#8c6a50"),
        # Painted furniture (cottage pastels).
        "paint": ("#a9cdbd", "#f2d68f", "#a9c4e0", "#eab6b0", "#f7f2e8"),
        # Upholstery, quilts, cushions, curtains and rugs.
        "fabric": ("#e98b7d", "#7fb6b0", "#f2c46d", "#b6a4d8", "#f7efe0", "#8fb0d8"),
        "floor": ("#c9a27a", "#b48d66", "#d6b48c"),
        "tiles": ("#efe6d4", "#d98e6b", "#a9c4b4", "#9fb2c7"),
        "stone": ("#cfc7b8", "#b9b0a1", "#a59d90"),
        "brick": ("#c26b55", "#ad5c49", "#d0876c"),
        "ceramic": ("#f8f5ee", "#e8eef0", "#d97f5f"),
        "metal": ("#4a4e52", "#8e9599", "#c9a45c"),
        "glass": ("#a9c7d2", "#c4d8de"),
        "light": ("#ffdf9e",),
        "fire": ("#ff9a4a",),
        "foliage": ("#86b86a", "#6ea35c", "#9fca7c", "#5d9162"),
        "pot": ("#d27f5e", "#e8e0d2", "#7fa7b8"),
        "books": ("#c8574d", "#4f7fa8", "#e2b04a", "#6f9a68", "#8a6fa8", "#e88b72", "#3f5d74"),
        "paper": ("#f8f2e2", "#efe3c6", "#e6eef3"),
        "bread": ("#d9964f", "#c27a3c", "#e8b874"),
        "food": ("#e0584f", "#f0a73c", "#8cc063", "#f6d6e0", "#7a4a35"),
        "hay": ("#e8c96a", "#d9b453", "#f0d98a"),
        "frame": ("#c9a45c", "#7b5b45", "#f7f2e8"),
        "art": ("#9cc6e0", "#a9cf8f", "#f2c46d", "#e98b7d", "#f6d6e0"),
    },
    tiles=(
        AtlasTile("floorboards", "planks", 0.10),
        AtlasTile("tiles", "tiles", 0.10),
        AtlasTile("brick", "bricks", 0.10),
        AtlasTile("fabric", "speckle", 0.06),
        AtlasTile("leaves", "speckle", 0.14),
        AtlasTile("straw", "streaks", 0.16),
    ),
    wall_thickness_m=0.1,
    roof_pitch_deg=35.0,
    eave_overhang_m=0.0,
    bevel_width_m=0.02,
    bevel_segments=2,
    vertex_noise_m=0.004,
    colour_jitter=0.05,
)

_STYLES: Dict[str, StyleParams] = {
    "european": EUROPEAN,
    "mediterranean": MEDITERRANEAN,
    COMMON_KIT_ID: COMMON,
    INTERIOR_KIT_ID: INTERIOR,
}

_PENDING = {"arabic": "M33", "japanese": "M34"}


def resolve_style_id(name: str) -> str:
    key = name.strip().lower()
    key = STYLE_ALIASES.get(key, key)
    if key not in KIT_IDS:
        raise ValueError(f"unknown style {name!r}; expected one of {', '.join(KIT_IDS)} (or 'europe')")
    return key


def get_style(name: str) -> StyleParams:
    style_id = resolve_style_id(name)
    if style_id in _PENDING:
        # TODO(M33/M34): add the Arabic and Japanese parameters.
        raise NotImplementedError(f"style {style_id!r} arrives in {_PENDING[style_id]}")
    return _STYLES[style_id]


def available_styles() -> Tuple[str, ...]:
    return tuple(sorted(_STYLES))
