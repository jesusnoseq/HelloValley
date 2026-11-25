"""Colour helpers. Palettes are written as sRGB hex; Blender float colour attributes and glTF
COLOR_0 are linear, so convert before painting vertices."""

from __future__ import annotations

from typing import Tuple

RGBA = Tuple[float, float, float, float]


def hex_to_srgb(value: str) -> Tuple[float, float, float]:
    s = value.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) != 6:
        raise ValueError(f"expected #rgb or #rrggbb, got {value!r}")
    try:
        r, g, b = (int(s[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        raise ValueError(f"invalid hex colour {value!r}") from None
    return (r, g, b)


def srgb_to_linear(c: float) -> float:
    c = min(max(c, 0.0), 1.0)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = min(max(c, 0.0), 1.0)
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_linear_rgba(value: str, alpha: float = 1.0) -> RGBA:
    r, g, b = hex_to_srgb(value)
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def scale_brightness(rgba: RGBA, factor: float) -> RGBA:
    """Multiply RGB (linear) by ``factor`` and clamp to [0, 1]; alpha is kept."""
    r, g, b, a = rgba
    return (
        min(max(r * factor, 0.0), 1.0),
        min(max(g * factor, 0.0), 1.0),
        min(max(b * factor, 0.0), 1.0),
        a,
    )
