"""Kit module definitions. Importing this package registers every module."""

from . import common, europe, interior, mediterranean, test_cube  # noqa: F401

# ``mediterranean`` mirrors the European modules, so it must be imported after ``europe``.
