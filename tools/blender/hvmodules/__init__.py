"""Kit module definitions. Importing this package registers every module."""

from . import common, europe, interior, mediterranean, arabic, test_cube  # noqa: F401

# ``mediterranean`` and ``arabic`` mirror the European modules, so ``europe`` must be imported first.
