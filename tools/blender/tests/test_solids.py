import math
import unittest
from collections import Counter

from hvkit import solids
from hvkit.contact import GAP_M, layout
from hvkit.module import get_module

import hvmodules  # noqa: F401  (registers modules)


def edge_counts(faces):
    edges = Counter()
    for f in faces:
        for a, b in zip(f, list(f[1:]) + [f[0]]):
            edges[(min(a, b), max(a, b))] += 1
    return edges


def assert_closed(test, solid):
    """Every edge is shared by exactly two faces, with opposite directions (consistent
    winding)."""
    verts, faces = solid
    test.assertTrue(all(c == 2 for c in edge_counts(faces).values()))
    directed = Counter()
    for f in faces:
        for a, b in zip(f, list(f[1:]) + [f[0]]):
            directed[(a, b)] += 1
    test.assertTrue(all(c == 1 for c in directed.values()), "faces must be wound consistently")


def signed_volume(solid):
    verts, faces = solid
    vol = 0.0
    for f in faces:
        a = verts[f[0]]
        for i in range(1, len(f) - 1):
            b, c = verts[f[i]], verts[f[i + 1]]
            vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
    return vol


def outward(test, solid):
    """Every face normal points away from the solid's centroid side (convex solids)."""
    verts, faces = solid
    centre = solids.centroid(verts)
    for f in faces:
        n = solids.face_normal(verts, f)
        c = solids.centroid([verts[i] for i in f])
        d = [c[i] - centre[i] for i in range(3)]
        test.assertGreater(sum(n[i] * d[i] for i in range(3)), 0.0)


class PrismTest(unittest.TestCase):
    def test_box_is_closed_and_outward(self):
        box = solids.box((0, 0, 0), (1, 2, 3))
        assert_closed(self, box)
        outward(self, box)
        self.assertAlmostEqual(signed_volume(box), 6.0)
        self.assertEqual(solids.tri_count(box[1]), 12)

    def test_prism_any_axis_and_winding(self):
        tri = [(0.0, 0.0), (2.0, 0.0), (1.0, 1.0)]
        for axis in ("x", "y", "z"):
            for profile in (tri, list(reversed(tri))):
                p = solids.prism(profile, axis, 0.0, 3.0)
                assert_closed(self, p)
                outward(self, p)
                self.assertAlmostEqual(signed_volume(p), 3.0)

    def test_slices_add_rings(self):
        p = solids.prism([(0, 0), (1, 0), (1, 1), (0, 1)], "z", 0.0, 3.0, slices=3)
        assert_closed(self, p)
        self.assertEqual(len(p[0]), 16)
        self.assertAlmostEqual(signed_volume(p), 3.0)

    def test_concave_l_profile(self):
        l = [(0, 0), (1, 0), (1, 0.2), (0.2, 0.2), (0.2, 1), (0, 1)]
        p = solids.prism(l, "z", 0.0, 3.0)
        assert_closed(self, p)
        self.assertAlmostEqual(signed_volume(p), 3.0 * (0.2 + 0.8 * 0.2))

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            solids.prism([(0, 0), (1, 0)], "z", 0, 1)
        with self.assertRaises(ValueError):
            solids.prism([(0, 0), (1, 0), (2, 0)], "z", 0, 1)
        with self.assertRaises(ValueError):
            solids.prism([(0, 0), (1, 0), (1, 1)], "z", 1, 1)


class PanelTest(unittest.TestCase):
    def test_window_panel_is_a_closed_ring(self):
        xs, zs = [0, 0.2, 0.8, 1], [0, 1, 2, 3]
        p = solids.grid_panel(xs, zs, [(1, 1)], 0.0, 0.2)
        assert_closed(self, p)
        self.assertAlmostEqual(signed_volume(p), (3.0 - 0.6) * 0.2)

    def test_door_touching_the_ground(self):
        p = solids.grid_panel([0, 0.2, 0.8, 1], [0, 2.2, 3], [(1, 0)], 0.0, 0.2)
        assert_closed(self, p)
        self.assertAlmostEqual(signed_volume(p), (3.0 - 0.6 * 2.2) * 0.2)

    def test_errors(self):
        with self.assertRaises(ValueError):
            solids.grid_panel([0, 1], [0, 1], [(1, 0)], 0, 1)
        with self.assertRaises(ValueError):
            solids.grid_panel([0, 1], [0, 1], [(0, 0)], 0, 1)
        with self.assertRaises(ValueError):
            solids.grid_panel([1, 0], [0, 1], [], 0, 1)

    def test_swap_yz_keeps_it_closed_and_outward(self):
        g = [0, 0.5, 1]
        slab = solids.swap_yz(solids.grid_panel(g, g, [], 0.0, 0.06))
        assert_closed(self, slab)
        self.assertAlmostEqual(signed_volume(slab), 0.06)
        self.assertEqual(max(v[2] for v in slab[0]), 0.06)


class ShapesTest(unittest.TestCase):
    def test_beam_and_clipping(self):
        b = solids.beam((0, 0), (1, 1), 0.1, 0.0, 0.05)
        assert_closed(self, b)
        self.assertAlmostEqual(signed_volume(b), math.sqrt(2) * 0.1 * 0.05, places=6)
        clipped = solids.clip_beam_profile((0, 0), (1, 1), 0.1, (0.0, 0.0), (1.0, 1.0))
        for u, v in clipped:
            self.assertTrue(-1e-9 <= u <= 1 + 1e-9 and -1e-9 <= v <= 1 + 1e-9)
        self.assertGreaterEqual(len(clipped), 4)
        with self.assertRaises(ValueError):
            solids.beam_profile((0, 0), (0, 0), 0.1)

    def test_hip_roof(self):
        pyramid = solids.hip_roof(0, 2, 0, 2, 0, 1)
        assert_closed(self, pyramid)
        self.assertEqual(len(pyramid[0]), 5)
        self.assertAlmostEqual(signed_volume(pyramid), 4.0 / 3.0)
        ridged = solids.hip_roof(0, 3, 0, 2, 0, 1)
        assert_closed(self, ridged)
        self.assertEqual(len(ridged[0]), 6)
        pavilion = solids.hip_roof(0, 2, 0, 2, 0, 1, ridge=0.5)
        assert_closed(self, pavilion)
        frustum = solids.hip_roof(0, 2, 0, 2, 0, 1, top_scale=0.5)
        assert_closed(self, frustum)
        self.assertAlmostEqual(signed_volume(frustum), (4 + 1 + 2) / 3.0)
        with self.assertRaises(ValueError):
            solids.hip_roof(0, 2, 0, 2, 0, 1, top_scale=1.0)

    def test_stepped_gable_steps(self):
        blocks = solids.stepped_gable_steps(0.0, 2.0, 0.0, 2.0, 3)
        self.assertEqual(len(blocks), 4)
        for (a0, a1, az0, az1), (b0, b1, bz0, _) in zip(blocks, blocks[1:]):
            self.assertLess(a0, b0)
            self.assertGreater(a1, b1)
            self.assertAlmostEqual(az1, bz0)
        self.assertAlmostEqual(blocks[-1][3], 2.0)
        self.assertAlmostEqual(blocks[-1][1] - blocks[-1][0], 2.0 / 7)

    def test_seam_planes(self):
        bounds = ((0, 0, 0), (1, 1, 3))
        self.assertEqual(solids.seam_planes(("x", "z+"), bounds), [(0, 0.0), (0, 1.0), (2, 3.0)])
        self.assertEqual(solids.seam_planes((1,), bounds), [(1, 0.0), (1, 1.0)])
        self.assertEqual(solids.seam_planes(("y-",), bounds), [(1, 0.0)])
        with self.assertRaises(ValueError):
            solids.seam_planes(("w",), bounds)

    def test_transforms(self):
        b = solids.translate(solids.box((0, 0, 0), (1, 1, 1)), (1, 2, 3))
        self.assertEqual(min(v[0] for v in b[0]), 1)
        r = solids.rotate_z(solids.box((0, 0, 0), (1, 1, 1)), math.pi / 2)
        self.assertAlmostEqual(min(v[0] for v in r[0]), -1.0)
        assert_closed(self, r)


class ContactLayoutTest(unittest.TestCase):
    def test_every_variant_gets_a_separate_slot(self):
        modules = [get_module(i) for i in ("wall.plain", "roof.gable", "bench", "lamp", "tile.cobble")]
        slots, groups, (w, d) = layout(modules, columns=2, height_gap=0.5)
        self.assertEqual(len(slots), sum(m.variants for m in modules))
        self.assertEqual([g.module_id for g in groups], [m.id for m in modules])
        boxes = []
        for s in slots:
            m = get_module(s.module_id)
            lo = (s.pivot[0] - m.max_overhang_m, s.pivot[1] - m.max_overhang_m)
            hi = (s.pivot[0] + m.footprint.width_m + m.max_overhang_m, s.pivot[1] + m.footprint.depth_m + m.max_overhang_m)
            self.assertTrue(0 <= lo[0] and hi[0] <= w + 1e-9 and 0 <= lo[1] and hi[1] <= d + 1e-9)
            boxes.append((lo, hi))
        for i, (alo, ahi) in enumerate(boxes):
            for blo, bhi in boxes[i + 1 :]:
                overlap = alo[0] < bhi[0] and blo[0] < ahi[0] and alo[1] < bhi[1] and blo[1] < ahi[1]
                self.assertFalse(overlap)
        self.assertGreater(GAP_M, 0)
        with self.assertRaises(ValueError):
            layout(modules, columns=0)
        self.assertEqual(layout([]), ([], [], (0.0, 0.0)))


if __name__ == "__main__":
    unittest.main()
