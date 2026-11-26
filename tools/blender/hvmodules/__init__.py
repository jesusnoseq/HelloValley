"""Kit module definitions. Importing this package registers every module."""

from . import common, europe, interior, mediterranean, arabic, japanese, test_cube  # noqa: F401

# ``mediterranean``, ``arabic`` and ``japanese`` mirror the European modules, so ``europe`` must be
# imported first.
