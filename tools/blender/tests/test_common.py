import json
import math
import os
import re
import unittest

import hvmodules  # noqa: F401  (registers modules)
from hvkit import budgets, solids
from hvkit import manifest as mf
from hvkit.atlas import render_atlas
from hvkit.module import CANOPY_MATERIAL, CANOPY_PART, get_module, select_modules
from hvkit.styles import COMMON_KIT_ID, INTERIOR_KIT_ID, KIT_IDS, STYLE_IDS, get_style
from hvmodules.common import base, ground, vegetation, water

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "common", "kit-manifest.json")


def read(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
        return f.read()


def ts_ids(src, name):
    body = re.search(rf"{name} = \[([^\]]*)\]", src).group(1)
    return re.findall(r'"([a-z_.]+)"', body)


class CommonModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("common")
        self.modules = select_modules(COMMON_KIT_ID)

    def test_registered_modules_match_shared(self):
        ids = ts_ids(read("packages", "shared", "src", "assets", "budgets.ts"), "KIT_COMMON_MODULE_IDS")
        self.assertEqual(sorted(m.id for m in self.modules), sorted(ids))
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.styles, ("common",), m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.tri_budget, budgets.budget_for(m.id), m.id)
        # The common kit and the style kits do not overlap.
        europe = {m.id for m in select_modules("european")}
        self.assertFalse(europe & {m.id for m in self.modules})

    def test_kit_ids_match_shared(self):
        src = read("packages", "shared", "src", "assets", "kit.ts")
        self.assertIn(f'COMMON_KIT_ID = "{COMMON_KIT_ID}"', src)
        self.assertEqual(KIT_IDS, STYLE_IDS + (COMMON_KIT_ID, INTERIOR_KIT_ID))
        self.assertIn(f'KIT_CANOPY_PART = "{CANOPY_PART}"', src)

    def test_budgets_match_shared(self):
        src = read("packages", "shared", "src", "assets", "budgets.ts")
        for name, value in budgets.BUDGETS.items():
            m = re.search(rf"{name}: \{{ min: (\d+), max: (\d+) \}}", src)
            self.assertEqual((int(m.group(1)), int(m.group(2))), value, name)
        for family, cls in budgets._FAMILY_CLASS.items():
            self.assertRegex(src, rf'{family}: "{cls}"')
        self.assertEqual(budgets.budget_for("terrain.path.edge"), budgets.TILE_BUDGET)
        self.assertEqual(budgets.budget_for("tree.palm"), budgets.PLANT_BUDGET)
        self.assertEqual(budgets.budget_for("market_stall"), budgets.PROP_BUDGET)

    def test_variant_params_are_seeded_and_distinct(self):
        for m in self.modules:
            params = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            again = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            self.assertEqual(params, again, m.id)
            self.assertEqual(len({json.dumps(p, sort_keys=True) for p in params}), m.variants, f"{m.id} variants must differ")

    def test_palette_and_atlas(self):
        tiles = [t.name for t in self.style.atlas().tiles]
        for tile in ("grass", "dirt", "sand", "cobble", "bark", "leaves", "wood", "stone"):
            self.assertIn(tile, tiles)
        pixels = render_atlas(self.style.atlas(), self.style.seed)
        self.assertTrue(all(0.0 <= v <= 1.0 for v in pixels[::97]))

    def test_trees_split_trunk_and_canopy(self):
        trees = [m for m in self.modules if m.id.startswith("tree.")]
        self.assertEqual(len(trees), 6)
        for m in trees:
            self.assertTrue(m.canopy and m.trunk, m.id)
            self.assertIn("canopy", m.tags)
        for mid in ("bush", "flowers"):
            self.assertTrue(get_module(mid).canopy)
            self.assertFalse(get_module(mid).trunk)
        for m in self.modules:
            if not m.canopy:
                self.assertNotIn("canopy", m.tags, m.id)

    def test_part_errors(self):
        tree = get_module("tree.deciduous")
        ok = [("trunk", ["atlas"]), (CANOPY_PART, [CANOPY_MATERIAL])]
        self.assertEqual(tree.part_errors(ok), [])
        self.assertTrue(tree.part_errors([("", ["atlas", CANOPY_MATERIAL])]))  # merged into one mesh
        self.assertTrue(tree.part_errors([(CANOPY_PART, [CANOPY_MATERIAL])]))  # no trunk
        self.assertTrue(tree.part_errors([("trunk", ["atlas"]), (CANOPY_PART, ["atlas"])]))  # wrong slot
        self.assertEqual(get_module("bush").part_errors([(CANOPY_PART, [CANOPY_MATERIAL])]), [])
        self.assertTrue(get_module("rock").part_errors([(CANOPY_PART, [CANOPY_MATERIAL])]))
        self.assertEqual(get_module("rock").part_errors([("", ["atlas"])]), [])

    def test_canopy_blobs_stay_inside_the_footprint(self):
        for m in self.modules:
            if not m.id.startswith("tree."):
                continue
            lo, hi = m.nominal_bounds()
            slack = m.max_overhang_m + 1e-6
            for i in range(m.variants):
                params = m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params"))
                for blob in params.get("blobs", []):
                    blo, bhi = vegetation.blob_extent(blob)
                    for axis in range(3):
                        self.assertGreaterEqual(blo[axis], lo[axis] - slack, f"{m.id} v{i}")
                        self.assertLessEqual(bhi[axis], hi[axis] + slack, f"{m.id} v{i}")


class TerrainTest(unittest.TestCase):
    def test_regions_meet_the_cell_sides_at_their_midpoints(self):
        for kind in ground.EDGE_KINDS:
            for wobble, k in ((0.0, 1), (0.06, 1), (0.05, 2)):
                feature, grass = ground.regions(kind, wobble, k)
                self.assertGreater(solids.signed_area(feature), 0, kind)
                self.assertGreater(solids.signed_area(grass), 0, kind)
                self.assertAlmostEqual(solids.signed_area(feature) + solids.signed_area(grass), 1.0, places=6)
                on_sides = {p for p in feature if p in grass and (p[0] in (0.0, 1.0) or p[1] in (0.0, 1.0))}
                for x, y in on_sides:
                    self.assertTrue((x, y) in ((0.5, 0.0), (0.0, 0.5), (1.0, 0.5), (0.5, 1.0)), (kind, x, y))
                self.assertEqual(len(on_sides), 2, kind)
        feature, grass = ground.regions("full")
        self.assertIsNone(grass)
        self.assertAlmostEqual(solids.signed_area(feature), 1.0)

    def test_edge_sides(self):
        # edge: the feature fills the front half; outer: a quarter disc at the front-left corner;
        # inner: everything but a quarter disc of grass at the back-right corner.
        def inside(kind, p):
            return base.point_in_polygon(p, ground.regions(kind)[0])

        self.assertTrue(inside("edge", (0.5, 0.2)) and not inside("edge", (0.5, 0.8)))
        self.assertTrue(inside("outer", (0.1, 0.1)) and not inside("outer", (0.6, 0.6)))
        self.assertTrue(inside("inner", (0.4, 0.4)) and not inside("inner", (0.9, 0.9)))

    def test_ground_heights(self):
        self.assertGreater(base.GROUND_Z, base.PATH_Z)
        self.assertGreater(base.GROUND_Z, base.SAND_Z)
        self.assertGreater(base.WATER_Z, base.BED_Z)
        self.assertGreaterEqual(base.SINK_M, -base.BED_Z)


class BankTest(unittest.TestCase):
    """Bank pieces share their seams: along every cell side the height profile is either all
    land, all bed, or the straight-bank profile, so neighbours meet without gaps."""

    def profile(self, mid, side):
        m = get_module(mid)
        cells = water.BANK_KINDS[m.kind][0]
        lines = water.bank_lines(cells)
        if side == "front":
            pts = [(t, 0.0) for t in lines]
        elif side == "back":
            pts = [(t, float(cells)) for t in lines]
        elif side == "left":
            pts = [(0.0, t) for t in lines]
        else:
            pts = [(float(cells), t) for t in lines]
        return [round(m.height(x, y), 6) for x, y in pts]

    def test_bank_height(self):
        self.assertAlmostEqual(water.bank_height(1.0), base.GROUND_Z)
        self.assertAlmostEqual(water.bank_height(-1.0), base.BED_Z)
        self.assertLess(water.bank_height(0.0), base.GROUND_Z)
        self.assertGreater(water.bank_height(0.0), base.WATER_Z)  # the shoreline is above water

    def test_seams_match_the_straight_profile(self):
        unit = water.bank_lines(1)
        straight = [round(water.bank_height(y - 0.5), 6) for y in unit]
        land = [round(base.GROUND_Z, 6)] * len(unit)
        bed = [round(base.BED_Z, 6)] * len(unit)
        allowed = {tuple(straight), tuple(reversed(straight)), tuple(land), tuple(bed)}
        for mid in water.BANK_IDS:
            cells = water.BANK_KINDS[get_module(mid).kind][0]
            n = len(unit) - 1
            for side in ("front", "back", "left", "right"):
                full = self.profile(mid, side)
                for c in range(cells):
                    chunk = tuple(full[c * n : (c + 1) * n + 1])
                    self.assertIn(chunk, allowed, f"{mid} {side} cell {c}")

    def test_bridge_profile(self):
        prof = water.bridge_profile()
        self.assertGreater(abs(solids.signed_area(prof)), 0)
        self.assertAlmostEqual(water.deck_z(0.0), base.GROUND_Z)
        self.assertAlmostEqual(water.deck_z(water.BRIDGE_D), base.GROUND_Z)
        self.assertGreater(water.deck_z(water.BRIDGE_D / 2), water.arch_z(water.BRIDGE_D / 2) + 0.05)
        self.assertGreater(water.arch_z(water.BRIDGE_D / 2), base.WATER_Z + 0.4)
        self.assertGreaterEqual(min(z for _, z in prof), -base.SINK_M)


class SolidsTest(unittest.TestCase):
    def test_tube_and_leaf(self):
        verts, faces = solids.tube([(0, 0, 0), (0, 0, 1), (0.2, 0, 2)], [0.2, 0.15, 0.1], sides=6)
        self.assertEqual(len(verts), 18)
        self.assertEqual(solids.tri_count(faces), 2 * 6 * 2 + 2 * 4)
        self.assertAlmostEqual(math.hypot(verts[0][0], verts[0][1]), 0.2)
        verts, faces = solids.leaf([(0, 0, 0), (1, 0, 0.2), (2, 0, 0)], [0.1, 0.3, 0.05], 0.02)
        self.assertEqual(len(verts), 12)
        self.assertEqual(len(faces), 2 * 4 + 2)
        with self.assertRaises(ValueError):
            solids.tube([(0, 0, 0)], [0.1])

    def test_heightfield(self):
        verts, faces, cells = solids.heightfield([0, 0.5, 1], [0, 0.5, 1], lambda x, y: x + y)
        self.assertEqual(len(verts), 9)
        self.assertEqual(len(faces), 8)
        self.assertEqual(len(cells), 9)
        _, kept, _ = solids.heightfield([0, 0.5, 1], [0, 0.5, 1], lambda x, y: 0.0, keep=lambda i, j: i == 0)
        self.assertEqual(len(kept), 4)


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "common kit not generated")
class GeneratedCommonKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with
    npm run assets:build -- --style common after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], "common")
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(m.id for m in select_modules(COMMON_KIT_ID)))
        for mid, e in entries.items():
            m = get_module(mid)
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)


if __name__ == "__main__":
    unittest.main()
