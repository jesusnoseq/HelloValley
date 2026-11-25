import os
import struct
import tempfile
import unittest
import zlib

from hvkit.atlas import Atlas, AtlasLayout, AtlasTile, _PeriodicNoise, render_atlas, tile_value, write_png
from hvkit.shaping import dominant_axis, grid_safe_jitter, painted_colour, project_face_uvs
from hvkit.variants import VariantRng


class AtlasLayoutTest(unittest.TestCase):
    def test_tile_rects_are_inset_and_ordered(self):
        layout = AtlasLayout(size=512, columns=4, gutter=4)
        self.assertEqual(layout.tile_px, 128)
        self.assertEqual(layout.capacity, 16)
        u0, v0, u1, v1 = layout.tile_uv_rect(0)  # top-left tile
        self.assertAlmostEqual(u0, 4 / 512)
        self.assertAlmostEqual(u1, 124 / 512)
        self.assertAlmostEqual(v1, 1 - 4 / 512)
        self.assertAlmostEqual(v0, 1 - 124 / 512)
        # Tile 5 = second row, second column.
        self.assertEqual(layout.tile_origin_px(5), (128, 128))
        with self.assertRaises(IndexError):
            layout.tile_uv_rect(16)

    def test_map_uv_clamps_into_the_tile(self):
        layout = AtlasLayout()
        rect = layout.tile_uv_rect(3)
        self.assertEqual(layout.map_uv(3, 0, 0), (rect[0], rect[1]))
        self.assertEqual(layout.map_uv(3, 2, -1), (rect[2], rect[1]))

    def test_invalid_layouts(self):
        with self.assertRaises(ValueError):
            AtlasLayout(size=500, columns=3)
        with self.assertRaises(ValueError):
            AtlasLayout(size=64, columns=4, gutter=8)
        with self.assertRaises(ValueError):
            AtlasTile("x", "zigzag")

    def test_atlas_names(self):
        atlas = Atlas([AtlasTile("a"), AtlasTile("b", "planks")], AtlasLayout(size=64, columns=2, gutter=2))
        self.assertEqual(atlas.index("b"), 1)
        self.assertEqual(set(atlas.tile_manifest()), {"a", "b"})
        with self.assertRaises(KeyError):
            atlas.index("c")
        with self.assertRaises(ValueError):
            Atlas([AtlasTile("a"), AtlasTile("a")])
        with self.assertRaises(ValueError):
            Atlas([AtlasTile(f"t{i}") for i in range(5)], AtlasLayout(size=64, columns=2, gutter=2))


class AtlasPaintTest(unittest.TestCase):
    def test_noise_tiles_seamlessly(self):
        rng = VariantRng(3)
        octaves = [_PeriodicNoise(rng, 4), _PeriodicNoise(rng, 8)]
        tile = AtlasTile("p", "plaster", 0.1)
        for y in (0.1, 0.37, 0.8):
            left = tile_value(tile, octaves, 0.0, y)
            right = tile_value(tile, octaves, 1.0 - 1e-9, y)
            self.assertAlmostEqual(left, right, places=5)

    def test_render_is_deterministic_subtle_and_sized(self):
        layout = AtlasLayout(size=32, columns=2, gutter=2)
        atlas = Atlas([AtlasTile("plain", "plain", 0), AtlasTile("wood", "planks", 0.1), AtlasTile("brick", "bricks", 0.1)], layout)
        a = render_atlas(atlas, seed=5)
        self.assertEqual(len(a), 32 * 32 * 4)
        self.assertEqual(a, render_atlas(atlas, seed=5))
        self.assertNotEqual(a, render_atlas(atlas, seed=6))
        values = a[0::4]
        self.assertTrue(all(0.0 <= v <= 1.0 for v in values))
        # Low contrast: nothing darker than ~1 - 2.5 * strength.
        self.assertGreater(min(values), 0.7)

    def test_write_png(self):
        size = 8
        pixels = [0.5, 0.5, 0.5, 1.0] * (size * size)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a.png")
            write_png(path, size, pixels)
            with open(path, "rb") as f:
                data = f.read()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        width, height = struct.unpack(">II", data[16:24])
        self.assertEqual((width, height), (size, size))
        idat_len = struct.unpack(">I", data[33:37])[0]
        raw = zlib.decompress(data[41 : 41 + idat_len])
        self.assertEqual(len(raw), size * (1 + size * 3))
        self.assertEqual(raw[1], 128)
        with self.assertRaises(ValueError):
            write_png(path, size, pixels[:-4])


class ShapingTest(unittest.TestCase):
    def test_dominant_axis(self):
        self.assertEqual(dominant_axis((0, 0, 1)), 2)
        self.assertEqual(dominant_axis((-0.9, 0.1, 0.2)), 0)
        self.assertEqual(dominant_axis((0.1, -1, 0)), 1)

    def test_face_uvs_stay_in_rect_and_keep_density(self):
        rect = (0.25, 0.5, 0.5, 0.75)
        # A 0.5 m x 0.5 m front face (looking along -Y): X -> U, Z -> V.
        pts = [(0, 0, 0), (0.5, 0, 0), (0.5, 0, 0.5), (0, 0, 0.5)]
        uvs = project_face_uvs(pts, (0, -1, 0), rect)
        self.assertEqual(uvs[0], (0.25, 0.5))
        self.assertAlmostEqual(uvs[2][0], 0.375)  # half a tile for half a metre
        self.assertAlmostEqual(uvs[2][1], 0.625)
        # A 3 m face stretches but never leaves the rect.
        big = [(0, 0, 0), (3, 0, 0), (3, 0, 3), (0, 0, 3)]
        for u, v in project_face_uvs(big, (0, -1, 0), rect):
            self.assertTrue(0.25 <= u <= 0.5 and 0.5 <= v <= 0.75)
        self.assertEqual(project_face_uvs([], (0, 0, 1), rect), [])

    def test_jitter_keeps_boundary_vertices_on_the_grid(self):
        rng = VariantRng(9)
        lo, hi = (0.0, 0.0, 0.0), (1.0, 1.0, 3.0)
        corner = grid_safe_jitter((0.0, 1.0, 3.0), 0.05, rng, lo, hi)
        self.assertEqual(corner, (0.0, 0.0, 0.0))
        edge = grid_safe_jitter((0.0, 0.5, 1.5), 0.05, rng, lo, hi)
        self.assertEqual(edge[0], 0.0)
        self.assertTrue(any(c != 0 for c in edge[1:]))
        self.assertEqual(grid_safe_jitter((0.5, 0.5, 0.5), 0.0, rng), (0.0, 0.0, 0.0))

    def test_jitter_never_leaves_the_box(self):
        rng = VariantRng(11)
        lo, hi = (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
        for _ in range(200):
            p = (0.001, 0.999, 0.5)
            off = grid_safe_jitter(p, 0.05, rng, lo, hi)
            q = [p[i] + off[i] for i in range(3)]
            self.assertTrue(all(lo[i] <= q[i] <= hi[i] for i in range(3)))

    def test_painted_colour(self):
        rng = VariantRng(2)
        base = (0.5, 0.5, 0.5, 1.0)
        for _ in range(50):
            r, g, b, a = painted_colour(base, 0.1, rng)
            self.assertTrue(0.45 <= r <= 0.55 and r == g == b and a == 1.0)


if __name__ == "__main__":
    unittest.main()
