"""HelloValley kit generator framework.

Pure-Python modules (``grid``, ``color``, ``variants``, ``atlas``, ``styles``, ``module``,
``manifest``, ``cli``) never import ``bpy`` so they can be unit-tested with a plain Python
interpreter. Everything that touches Blender lives in ``hvkit.blender`` and is only imported
from inside Blender (``build.py``).
"""

GENERATOR = "hellovalley-blender"
GENERATOR_VERSION = 1
