import unittest

from hvkit import grid
from hvkit.color import hex_to_linear_rgba, hex_to_srgb, linear_to_srgb, scale_brightness, srgb_to_linear
from hvkit.grid import Footprint
from hvkit.variants import VariantRng, variant_seed


class GridTest(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(grid.CELL_M, 1.0)
        self.assertEqual(grid.STOREY_M, 3.0)

    def test_footprint(self):
        fp = Footprint(w=3, d=2)
        self.assertEqual((fp.width_m, fp.depth_m, fp.height_m), (3.0, 2.0, 3.0))
        self.assertEqual(fp.storeys, 1.0)
        self.assertEqual(fp.to_json(), {"w": 3, "d": 2, "h": 3.0})
        with self.assertRaises(ValueError):
            Footprint(w=0)
        with self.assertRaises(ValueError):
            Footprint(h=-1)

    def test_axis_conversion_round_trips(self):
        for v in [(1, 2, 3), (-0.5, 0.25, 7), (0, 0, 0)]:
            self.assertEqual(grid.gltf_to_blender(grid.blender_to_gltf(v)), tuple(float(c) for c in v))
        # Blender up (Z) becomes glTF up (Y); Blender back (+Y) becomes glTF -Z.
        self.assertEqual(grid.blender_to_gltf((0, 0, 1)), (0.0, 1.0, 0.0))
        self.assertEqual(grid.blender_to_gltf((0, 1, 0)), (0.0, 0.0, -1.0))

    def test_bounds_conversion_keeps_pivot_front(self):
        lo, hi = grid.blender_bounds_to_gltf((0, 0, 0), (2, 1, 3))
        self.assertEqual(lo, (0.0, 0.0, -1.0))
        self.assertEqual(hi, (2.0, 3.0, 0.0))

    def test_bounds_helpers(self):
        self.assertEqual(grid.bounds_of([(0, 5, 1), (2, -1, 3)]), ((0, -1, 1), (2, 5, 3)))
        self.assertEqual(grid.union_bounds([((0, 0, 0), (1, 1, 1)), ((-1, 0, 0), (0.5, 2, 1))]), ((-1, 0, 0), (1, 2, 1)))
        with self.assertRaises(ValueError):
            grid.bounds_of([])

    def test_snap_and_rounding(self):
        self.assertEqual(grid.snap(2.4), 2.0)
        self.assertEqual(grid.snap(4.6, grid.STOREY_M), 6.0)
        self.assertTrue(grid.is_on_grid(3.00001))
        self.assertFalse(grid.is_on_grid(3.01))
        self.assertEqual(grid.round_float(-0.00001), 0.0)
        self.assertEqual(str(grid.round_float(-0.0)), "0.0")
        self.assertEqual(grid.pivot_offset((0.00001, -0.25, 0)), (0.0, -0.25, 0.0))
        with self.assertRaises(ValueError):
            grid.snap(1, 0)


class ColorTest(unittest.TestCase):
    def test_hex(self):
        self.assertEqual(hex_to_srgb("#fff"), (1.0, 1.0, 1.0))
        self.assertAlmostEqual(hex_to_srgb("#804000")[0], 128 / 255)
        for bad in ("#12", "zzzzzz", "#1234567"):
            with self.assertRaises(ValueError):
                hex_to_srgb(bad)

    def test_linear_round_trip(self):
        for c in (0.0, 0.02, 0.2, 0.5, 0.9, 1.0):
            self.assertAlmostEqual(linear_to_srgb(srgb_to_linear(c)), c, places=6)
        self.assertAlmostEqual(srgb_to_linear(0.5), 0.21404, places=4)
        r, g, b, a = hex_to_linear_rgba("#ffffff", 0.5)
        self.assertEqual((r, g, b, a), (1.0, 1.0, 1.0, 0.5))

    def test_scale_brightness_clamps(self):
        self.assertEqual(scale_brightness((0.6, 0.2, 0.0, 1.0), 2.0), (1.0, 0.4, 0.0, 1.0))


class VariantTest(unittest.TestCase):
    def test_seed_is_stable_across_runs_and_machines(self):
        # SHA-256 based, so this never changes; if it does, every kit would regenerate.
        self.assertEqual(variant_seed("european", "test.cube", 0), 424814049444917951)
        self.assertAlmostEqual(VariantRng.for_variant("european", "test.cube", 0).random(), 0.027470556485347353)

    def test_seeds_differ_per_key(self):
        seeds = {
            variant_seed("european", "test.cube", 0),
            variant_seed("european", "test.cube", 1),
            variant_seed("european", "wall.plain", 0),
            variant_seed("japanese", "test.cube", 0),
            variant_seed("european", "test.cube", 0, base_seed=1),
        }
        self.assertEqual(len(seeds), 5)
        with self.assertRaises(ValueError):
            variant_seed("european", "x", -1)

    def test_same_seed_same_stream(self):
        a = VariantRng.for_variant("european", "wall.plain", 2)
        b = VariantRng.for_variant("european", "wall.plain", 2)
        self.assertEqual([a.random() for _ in range(5)], [b.random() for _ in range(5)])

    def test_fork_is_independent_of_parent_draws(self):
        a = VariantRng(7)
        b = VariantRng(7)
        b.random()
        b.random()
        self.assertEqual(a.fork("roof").random(), b.fork("roof").random())
        self.assertNotEqual(a.fork("roof").random(), a.fork("wall").random())

    def test_helpers(self):
        r = VariantRng(1)
        for _ in range(100):
            self.assertLessEqual(abs(r.jitter(0.1)), 0.1)
            self.assertIn(r.randint(1, 3), (1, 2, 3))
            self.assertIn(r.choice("abc"), "abc")
        self.assertEqual(r.weighted(["x", "y"], [1, 0]), "x")
        self.assertFalse(VariantRng(1).chance(0.0))
        with self.assertRaises(ValueError):
            r.choice([])
        with self.assertRaises(ValueError):
            r.weighted(["x"], [1, 2])


if __name__ == "__main__":
    unittest.main()
