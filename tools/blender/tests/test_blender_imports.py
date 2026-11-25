"""Import the Blender-only package against stand-in bpy/bmesh/mathutils modules.

This cannot check behaviour (Blender is needed for that, see README), but it catches syntax
errors, bad relative imports and names that are missing at import time when Blender is not
installed.
"""

import importlib
import sys
import unittest
from unittest import mock

BLENDER_MODULES = ("bpy", "bmesh", "mathutils")
HVKIT_BLENDER = ("hvkit.blender.scene", "hvkit.blender.materials", "hvkit.blender.shapes", "hvkit.blender.export", "hvkit.blender.runner")


class BlenderImportTest(unittest.TestCase):
    def test_blender_modules_import(self):
        real = {name: sys.modules.get(name) for name in BLENDER_MODULES + HVKIT_BLENDER}
        try:
            for name in BLENDER_MODULES:
                sys.modules[name] = mock.MagicMock(name=name)
            for name in HVKIT_BLENDER:
                sys.modules.pop(name, None)
                importlib.import_module(name)
            runner = sys.modules["hvkit.blender.runner"]
            self.assertTrue(callable(runner.run))
            export = sys.modules["hvkit.blender.export"]
            self.assertEqual(export.GLTF_OPTIONS["export_format"], "GLB")
            self.assertEqual(export.GLTF_OPTIONS["export_vertex_color"], "ACTIVE")
        finally:
            for name, module in real.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module


if __name__ == "__main__":
    unittest.main()
