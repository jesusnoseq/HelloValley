"""The shared chibi base body (GDD §3.1): rounded toy-like limbs, a T-shirt (``shirt`` slot:
torso and short sleeves) and trousers (``trousers``: pelvis and legs); hands, neck and feet
are ``fur``, so they take the animal's tint. Every shape follows exactly one bone (rigid
skinning; the overlapping rounded joints hide the seams).
"""

from __future__ import annotations

from hvkit.character import BONES_BY_NAME
from hvkit.charshapes import ShapeSet


def body_shapes() -> ShapeSet:
    s = ShapeSet("body")
    s.ellipsoid((0.0, 0.0, 0.335), (0.155, 0.12, 0.085), "trousers", bone="hips")
    s.ellipsoid((0.0, 0.0, 0.52), (0.17, 0.13, 0.165), "shirt", detail=3, bone="spine")
    s.cylinder((0.0, 0.0, 0.64), (0.0, 0.0, 0.72), 0.062, "fur", sides=10, bone="spine")

    def limbs(sign: float) -> None:
        side = "l" if sign > 0 else "r"

        def bone(name: str):
            b = BONES_BY_NAME[f"{name}_{side}"]
            return b.head, b.tail

        a, b = bone("upper_arm")
        s.capsule(a, b, 0.06, "shirt", bone=f"upper_arm_{side}")
        a, b = bone("forearm")
        s.capsule(a, b, 0.045, "fur", r2=0.042, bone=f"forearm_{side}")
        s.ellipsoid((sign * 0.268, 0.0, 0.385), (0.05, 0.045, 0.055), "fur", bone=f"hand_{side}")
        a, b = bone("thigh")
        s.capsule(a, b, 0.068, "trousers", bone=f"thigh_{side}")
        a, _ = bone("shin")
        s.capsule(a, (sign * 0.085, 0.0, 0.075), 0.06, "trousers", r2=0.056, bone=f"shin_{side}")
        s.ellipsoid((sign * 0.085, -0.03, 0.042), (0.06, 0.085, 0.042), "fur", bone=f"foot_{side}")

    s.mirrored(limbs)
    return s
