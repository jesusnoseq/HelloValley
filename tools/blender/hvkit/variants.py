"""Seeded variation. A variant's random stream depends only on (style, module id, variant
index, base seed), so regenerating a kit is reproducible on any machine and adding a module
never changes the others."""

from __future__ import annotations

import hashlib
import random
from typing import Sequence, Tuple, TypeVar

T = TypeVar("T")

DEFAULT_VARIANTS = 3
DEFAULT_SEED = 20261125


def variant_seed(style: str, module_id: str, index: int, base_seed: int = DEFAULT_SEED) -> int:
    """A stable 64-bit seed. Uses SHA-256, not ``hash()``, which is salted per process."""
    if index < 0:
        raise ValueError("variant index must be >= 0")
    key = f"{base_seed}|{style}|{module_id}|{index}".encode("utf-8")
    return int.from_bytes(hashlib.sha256(key).digest()[:8], "big")


class VariantRng:
    """Small wrapper over ``random.Random`` with the helpers generators need."""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self._r = random.Random(seed)

    @classmethod
    def for_variant(
        cls, style: str, module_id: str, index: int, base_seed: int = DEFAULT_SEED
    ) -> "VariantRng":
        return cls(variant_seed(style, module_id, index, base_seed))

    def random(self) -> float:
        return self._r.random()

    def uniform(self, lo: float, hi: float) -> float:
        return self._r.uniform(lo, hi)

    def jitter(self, amount: float) -> float:
        """A value in [-amount, amount]."""
        return self._r.uniform(-amount, amount)

    def jitter3(self, amount: float) -> Tuple[float, float, float]:
        return (self.jitter(amount), self.jitter(amount), self.jitter(amount))

    def randint(self, lo: int, hi: int) -> int:
        """Inclusive on both ends, like ``random.randint``."""
        return self._r.randint(lo, hi)

    def chance(self, p: float) -> bool:
        return self._r.random() < p

    def choice(self, items: Sequence[T]) -> T:
        if not items:
            raise ValueError("choice from an empty sequence")
        return items[self._r.randrange(len(items))]

    def weighted(self, items: Sequence[T], weights: Sequence[float]) -> T:
        if len(items) != len(weights) or not items:
            raise ValueError("items and weights must be non-empty and the same length")
        return self._r.choices(list(items), weights=list(weights), k=1)[0]

    def fork(self, label: str) -> "VariantRng":
        """An independent child stream, so adding draws in one part of a generator does not
        shift the numbers another part sees."""
        key = f"{self.seed}|{label}".encode("utf-8")
        return VariantRng(int.from_bytes(hashlib.sha256(key).digest()[:8], "big"))
