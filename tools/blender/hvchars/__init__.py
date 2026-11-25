"""Character definitions (M07): the shared chibi body, 16 animal heads with tails and optional
parts, the 9 NPC outfits and the 14 scripted animation clips. Pure Python; the Blender side
is ``hvkit.blender.characters``.
"""

from .animals import ANIMALS, ANIMAL_IDS, animal_parts  # noqa: F401
from .animations import CLIPS  # noqa: F401
from .body import body_shapes  # noqa: F401
from .outfits import NPC_LOOKS, OUTFITS, OUTFIT_IDS, outfit_parts  # noqa: F401
