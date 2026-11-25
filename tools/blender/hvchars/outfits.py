"""NPC looks and outfits (build plan M07, art.md §5.2 outfits).

Each NPC is one of the 16 animals with a fur tint, shirt and trouser swatches (the source of
truth is ``look`` in packages/shared/src/data/npcs.ts; ``NPC_LOOKS`` mirrors it for the
contact sheet and a test keeps the two equal) and a unique outfit: rigid pieces in the
fixed-colour ``outfit`` slot, each authored relative to the body or head socket it attaches
to (Blender axes, Z up, the character faces -Y).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from hvkit.charshapes import Part, ShapeSet


@dataclass(frozen=True)
class NpcLook:
    animal: str
    fur_tint: str
    shirt: str
    trousers: str


NPC_LOOKS: Dict[str, NpcLook] = {
    "shopkeeper": NpcLook("raccoon", "grey", "butter", "navy"),
    "baker": NpcLook("bear", "honey", "peach", "cream"),
    "barista": NpcLook("cat", "black", "cream", "charcoal"),
    "farmer": NpcLook("dog", "red", "terracotta", "periwinkle"),
    "mayor": NpcLook("penguin", "black", "cream", "navy"),
    "librarian": NpcLook("owl", "tawny", "lavender", "charcoal"),
    "doctor": NpcLook("koala", "grey", "sky", "navy"),
    "gossip": NpcLook("rabbit", "snow", "blush", "lilac"),
    "elder": NpcLook("capybara", "tawny", "sand", "moss"),
}

# Hex copies of the swatches the looks use (packages/shared/src/data/palette.ts) and of the
# fur tints, for the contact sheet; a test checks them against the TypeScript files.
SWATCH_HEX: Dict[str, str] = {
    "cream": "#f6efdc",
    "butter": "#f8e3a1",
    "peach": "#f7c6a3",
    "coral": "#f2a08f",
    "blush": "#f2b8c6",
    "lilac": "#d9c2e6",
    "lavender": "#bfb4e3",
    "periwinkle": "#a9b8ea",
    "sky": "#aed6ef",
    "mint": "#b5e5cf",
    "sage": "#b9cba5",
    "moss": "#93a676",
    "sand": "#dcc7a1",
    "terracotta": "#cf8a6e",
    "charcoal": "#55565c",
    "navy": "#4a5878",
}
FUR_HEX: Dict[str, Tuple[str, ...]] = {
    "fox": ("#c8693a", "#d98b4a", "#a9a7a3", "#ece8e0"),
    "rabbit": ("#f3f0ea", "#8a6a55", "#cfb08a", "#9c9a98"),
    "cat": ("#d4874a", "#3a3634", "#8e8c8a", "#eadcc2"),
    "dog": ("#c97a45", "#a5774f", "#4a3a30", "#eee0c6"),
    "bear": ("#7a5236", "#b4824e", "#3b3532", "#efeae0"),
    "red_panda": ("#b8562e", "#9c4a2c", "#c9733f"),
    "raccoon": ("#8a8682", "#8c7865", "#b8b2aa"),
    "hedgehog": ("#8b6b4e", "#b07a4f", "#d8c7ac"),
    "otter": ("#6b4a33", "#8a5e3d", "#7c6a5c"),
    "capybara": ("#a77c52", "#8e6342", "#c09b6e"),
    "koala": ("#a4a2a0", "#8a8886", "#9a8878"),
    "penguin": ("#2f3336", "#4b5660", "#9da3a8"),
    "owl": ("#9a6c44", "#d8b788", "#f0ede6", "#8f8a84"),
    "frog": ("#7fa75a", "#6b8b4a", "#a6c46a", "#8a8f4e"),
    "sheep": ("#f2efe8", "#e6dac4", "#a9a6a2", "#3d3936"),
    "deer": ("#b98556", "#93603b", "#a8764a"),
}
FUR_TINT_IDS: Dict[str, Tuple[str, ...]] = {
    "raccoon": ("grey", "brownish", "pale"),
    "bear": ("brown", "honey", "black", "polar"),
    "cat": ("ginger", "black", "grey", "cream"),
    "dog": ("red", "sesame", "black_tan", "cream"),
    "penguin": ("black", "slate", "chick_grey"),
    "owl": ("tawny", "barn", "snowy", "grey"),
    "koala": ("grey", "ash", "brownish"),
    "rabbit": ("snow", "cocoa", "sandy", "grey"),
    "capybara": ("tawny", "chestnut", "sand"),
}
"""Tint ids of the NPC animals (the order matches ``FUR_HEX``)."""


def fur_hex(look: NpcLook) -> str:
    return FUR_HEX[look.animal][FUR_TINT_IDS[look.animal].index(look.fur_tint)]


GOLD = "#e7c25b"
WOOD = "#9b7451"


class Outfit:
    def __init__(self, npc: str) -> None:
        self.npc = npc
        self.parts: List[Part] = []

    def piece(self, name: str, socket: str) -> ShapeSet:
        s = ShapeSet(f"{self.npc}.{name}")
        self.parts.append(Part(name, socket, s))
        return s


# Torso, relative to the chest socket (0, 0, 0.53): an ellipsoid centred 1 cm lower with
# radii (0.17, 0.13, 0.165). Pelvis, relative to the hips socket (0, 0, 0.34): centre
# (0, 0, -0.005), radii (0.155, 0.12, 0.085).


def _shell(s: ShapeSet, colour: str, buttons: Optional[str] = GOLD) -> None:
    """A vest/coat shell over the T-shirt torso, with buttons down the front."""
    s.ellipsoid((0.0, 0.0, -0.02), (0.18, 0.14, 0.152), "outfit", colour, detail=3)
    if buttons:
        for z in (0.05, 0.0, -0.05, -0.1):
            y = -0.14 * (1.0 - ((z + 0.02) / 0.152) ** 2) ** 0.5
            s.ellipsoid((0.0, y - 0.004, z), (0.012, 0.006, 0.012), "outfit", buttons, detail=1)


def _straps(s: ShapeSet, colour: str, r: float = 0.012) -> None:
    for sign in (1.0, -1.0):
        s.chain([(sign * 0.07, -0.135, 0.04), (sign * 0.1, -0.08, 0.15), (sign * 0.1, 0.06, 0.15), (sign * 0.08, 0.135, 0.03)], r, "outfit", colour, detail=2)


def _front_panel(s: ShapeSet, colour: str, z: float, half_w: float, half_h: float, y: float) -> None:
    s.box((0.0, y, z), (half_w, 0.012, half_h), "outfit", colour)


def shopkeeper() -> Outfit:
    o = Outfit("shopkeeper")
    _shell(o.piece("waistcoat", "chest"), "#8c4a4a")
    bow = o.piece("bow_tie", "neck")
    for sign in (1.0, -1.0):
        bow.ellipsoid((sign * 0.035, -0.012, 0.0), (0.035, 0.014, 0.024), "outfit", "#d2534a", rot=(0.0, 0.0, 0.0))
    bow.ellipsoid((0.0, -0.02, 0.0), 0.014, "outfit", "#a8403a", detail=1)
    tape = o.piece("measuring_tape", "neck")
    for sign in (1.0, -1.0):
        tape.chain([(sign * 0.075, 0.03, 0.01), (sign * 0.08, -0.03, -0.04), (sign * 0.07, -0.05, -0.16)], 0.01, "outfit", "#f2d36b", detail=2)
    return o


def baker() -> Outfit:
    o = Outfit("baker")
    bib = o.piece("apron_bib", "chest")
    _front_panel(bib, "#fbf8f1", -0.05, 0.09, 0.08, -0.137)
    _straps(bib, "#fbf8f1")
    for x, z in ((0.03, -0.03), (-0.05, -0.08), (0.06, -0.1)):
        bib.ellipsoid((x, -0.151, z), (0.014, 0.003, 0.01), "outfit", "#ffffff", detail=1)
    skirt = o.piece("apron_skirt", "hips")
    _front_panel(skirt, "#fbf8f1", -0.07, 0.15, 0.12, -0.128)
    skirt.box((0.07, -0.142, -0.09), (0.04, 0.004, 0.035), "outfit", "#f2c5b0", bevel=0)
    skirt.torus((0.0, 0.0, 0.04), 0.162, 0.014, "outfit", "#fbf8f1", stretch=0.8)
    scarf = o.piece("headscarf", "hat")
    scarf.ellipsoid((0.0, 0.02, -0.07), (0.235, 0.225, 0.11), "outfit", "#f2a08f", detail=3)
    for sign in (1.0, -1.0):
        scarf.ellipsoid((sign * 0.04, 0.215, -0.11), (0.04, 0.02, 0.03), "outfit", "#e98b7d")
    pin = o.piece("rolling_pin", "hand_r")
    pin.cylinder((0.0, -0.13, -0.01), (0.0, 0.1, -0.01), 0.024, "outfit", "#d8b385", sides=10)
    for y0, y1 in ((-0.19, -0.13), (0.1, 0.16)):
        pin.cylinder((0.0, y0, -0.01), (0.0, y1, -0.01), 0.01, "outfit", WOOD, sides=6)
    return o


def barista() -> Outfit:
    o = Outfit("barista")
    apron = o.piece("apron", "hips")
    _front_panel(apron, "#2f2c2e", -0.1, 0.15, 0.15, -0.128)
    apron.torus((0.0, 0.0, 0.04), 0.162, 0.014, "outfit", "#2f2c2e", stretch=0.8)
    beret = o.piece("beret", "hat")
    beret.ellipsoid((0.03, 0.0, 0.0), (0.2, 0.19, 0.055), "outfit", "#7a3b48", rot=(0.0, -12.0, 0.0), detail=3)
    beret.cylinder((0.03, 0.0, 0.04), (0.03, 0.0, 0.075), 0.012, "outfit", "#6a3240", sides=6)
    return o


def farmer() -> Outfit:
    o = Outfit("farmer")
    bib = o.piece("overalls_bib", "chest")
    _front_panel(bib, "#a9b8ea", -0.07, 0.1, 0.08, -0.137)
    _straps(bib, "#a9b8ea", r=0.014)
    for sign in (1.0, -1.0):
        bib.ellipsoid((sign * 0.07, -0.152, 0.0), 0.012, "outfit", GOLD, detail=1)
    hat = o.piece("straw_hat", "hat")
    hat.cylinder((0.0, 0.0, -0.015), (0.0, 0.0, 0.0), 0.3, "outfit", "#e8cf8a", sides=16)
    hat.cylinder((0.0, 0.0, 0.0), (0.0, 0.0, 0.11), 0.15, "outfit", "#e8cf8a", r_top=0.13, sides=14)
    hat.cylinder((0.0, 0.0, 0.0), (0.0, 0.0, 0.035), 0.153, "outfit", "#b8574a", sides=14)
    for side, sign in (("l", 1.0), ("r", -1.0)):
        boot = o.piece(f"boot_{side}", f"foot_{side}")
        boot.ellipsoid((0.0, 0.0, 0.045), (0.067, 0.093, 0.05), "outfit", "#5e7d5b")
        boot.cylinder((0.0, 0.01, 0.03), (0.0, 0.01, 0.135), 0.07, "outfit", "#5e7d5b", r_top=0.072, sides=10)
    return o


def mayor() -> Outfit:
    o = Outfit("mayor")
    sash = o.piece("sash", "chest")
    sash.torus((0.0, 0.0, -0.01), 0.172, 0.02, "outfit", "#c8473f", rot=(0.0, 50.0, 0.0), stretch=0.82, detail=3)
    sash.ellipsoid((-0.06, -0.148, 0.03), (0.032, 0.012, 0.032), "outfit", GOLD)
    sash.ellipsoid((-0.06, -0.158, 0.03), (0.014, 0.006, 0.014), "outfit", "#c8473f", detail=1)
    hat = o.piece("top_hat", "hat")
    hat.cylinder((0.0, 0.0, -0.01), (0.0, 0.0, 0.006), 0.19, "outfit", "#2f2d33", sides=16)
    hat.cylinder((0.0, 0.0, 0.0), (0.0, 0.0, 0.22), 0.125, "outfit", "#2f2d33", sides=14)
    hat.cylinder((0.0, 0.0, 0.01), (0.0, 0.0, 0.045), 0.128, "outfit", "#c8473f", sides=14)
    return o


def librarian() -> Outfit:
    o = Outfit("librarian")
    glasses = o.piece("glasses", "face")
    frame = "#5a4636"
    for sign in (1.0, -1.0):
        glasses.torus((sign * 0.095, -0.025, 0.0), 0.058, 0.007, "outfit", frame, rot=(90.0, 0.0, 0.0))
        glasses.capsule((sign * 0.153, -0.02, 0.005), (sign * 0.21, 0.09, 0.01), 0.006, "outfit", frame, detail=2)
    glasses.capsule((-0.04, -0.03, 0.01), (0.04, -0.03, 0.01), 0.006, "outfit", frame, detail=2)
    _shell(o.piece("cardigan", "chest"), "#a8b894", buttons="#f6efdc")
    book = o.piece("book", "hand_l")
    book.box((0.01, -0.01, -0.02), (0.025, 0.065, 0.085), "outfit", "#b8574a")
    book.box((0.012, -0.012, -0.02), (0.02, 0.06, 0.087), "outfit", "#f6efdc", bevel=0)
    return o


def doctor() -> Outfit:
    o = Outfit("doctor")
    _shell(o.piece("coat", "chest"), "#f4f4f0", buttons="#c9ccd1")
    tails = o.piece("coat_tails", "hips")
    tails.cylinder((0.0, 0.0, -0.15), (0.0, 0.0, 0.08), 0.2, "outfit", "#f4f4f0", r_top=0.165, squash=0.8, sides=14)
    steth = o.piece("stethoscope", "neck")
    for sign in (1.0, -1.0):
        steth.chain([(sign * 0.065, 0.07, 0.01), (sign * 0.07, 0.0, -0.02), (sign * 0.045, -0.035, -0.08), (0.0, -0.045, -0.12)], 0.009, "outfit", "#3d4247", detail=2)
    steth.cylinder((0.0, -0.045, -0.13), (0.0, -0.06, -0.13), 0.024, "outfit", "#c9ccd1", sides=10)
    board = o.piece("clipboard", "hand_l")
    board.box((0.015, -0.02, 0.0), (0.008, 0.075, 0.095), "outfit", "#a47c55", bevel=0)
    board.box((0.024, -0.02, -0.005), (0.002, 0.065, 0.08), "outfit", "#fbfbf8", bevel=0)
    return o


def gossip() -> Outfit:
    o = Outfit("gossip")
    shawl = o.piece("shawl", "chest")
    shawl.cylinder((0.0, 0.0, 0.06), (0.0, 0.0, 0.16), 0.215, "outfit", "#e98b7d", r_top=0.12, squash=0.82, sides=16)
    shawl.cylinder((0.0, 0.0, 0.055), (0.0, 0.0, 0.075), 0.218, "outfit", "#f2cf7a", r_top=0.2, squash=0.82, sides=16)
    for x in (-0.12, -0.06, 0.0, 0.06, 0.12):
        shawl.ellipsoid((x, -0.17, 0.045), 0.014, "outfit", "#f2cf7a", detail=1)
    for side in ("l", "r"):
        ring = o.piece(f"earring_{side}", f"ear_{side}")
        ring.torus((0.0, 0.0, -0.04), 0.025, 0.006, "outfit", GOLD, rot=(90.0, 0.0, 0.0))
        ring.ellipsoid((0.0, 0.0, -0.07), 0.016, "outfit", "#5fb8b0", detail=1)
    return o


def elder() -> Outfit:
    o = Outfit("elder")
    hat = o.piece("fishing_hat", "hat")
    hat.cylinder((0.0, 0.0, -0.06), (0.0, 0.0, -0.03), 0.28, "outfit", "#8a9a6b", r_top=0.2, sides=16)
    hat.cylinder((0.0, 0.0, -0.03), (0.0, 0.0, 0.08), 0.2, "outfit", "#8a9a6b", r_top=0.16, sides=14)
    hat.cylinder((0.0, 0.0, -0.03), (0.0, 0.0, 0.0), 0.202, "outfit", "#6f7d55", sides=14)
    hat.ellipsoid((0.17, -0.08, -0.01), 0.016, "outfit", "#d2534a", detail=1)
    _shell(o.piece("woolly_vest", "chest"), "#b07c5c", buttons="#6b503e")
    stick = o.piece("walking_stick", "hand_r")
    stick.cylinder((0.0, -0.02, -0.385), (0.0, -0.02, 0.05), 0.018, "outfit", WOOD, sides=8)
    stick.chain([(0.0, -0.02, 0.05), (0.0, -0.05, 0.09), (0.0, -0.09, 0.07)], 0.02, "outfit", WOOD, detail=2)
    return o


OUTFITS: Dict[str, Callable[[], Outfit]] = {
    "shopkeeper": shopkeeper,
    "baker": baker,
    "barista": barista,
    "farmer": farmer,
    "mayor": mayor,
    "librarian": librarian,
    "doctor": doctor,
    "gossip": gossip,
    "elder": elder,
}
OUTFIT_IDS: Tuple[str, ...] = tuple(OUTFITS)


def outfit_parts(npc_id: str) -> List[Part]:
    try:
        return OUTFITS[npc_id]().parts
    except KeyError:
        raise KeyError(f"unknown NPC outfit {npc_id!r}") from None


def outfit_file(npc_id: str) -> str:
    return f"outfit.{npc_id}.glb"
