import json
import math
import os
import re
import unittest

import hvmodules  # noqa: F401  (registers modules)
from hvkit import budgets, solids
from hvkit import manifest as mf
from hvkit.module import get_module, select_modules
from hvkit.styles import get_style
from hvmodules.mediterranean import common, roofs
from hvmodules.mediterranean.plants import MED_EXTRA_IDS

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "mediterranean", "kit-manifest.json")

BUILDING_IDS = tuple(m.id for m in select_modules("european"))


class MediterraneanModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("med")
        self.modules = select_modules("mediterranean")
        self.by_id = {m.id: m for m in self.modules}

    def test_every_european_module_has_a_mediterranean_twin_plus_the_extras(self):
        self.assertEqual(sorted(self.by_id), sorted(BUILDING_IDS + MED_EXTRA_IDS))
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.styles, ("mediterranean",), m.id)
            self.assertFalse(m.applies_to("european"), m.id)

    def test_twins_share_footprint_sockets_budget_and_fits(self):
        for mid in BUILDING_IDS:
            eu, med = get_module(mid, "european"), get_module(mid, "mediterranean")
            self.assertIsNot(eu, med)
            self.assertEqual(med.footprint, eu.footprint, mid)
            self.assertEqual(med.sockets, eu.sockets, mid)
            self.assertEqual(med.tri_budget, eu.tri_budget, mid)
            self.assertEqual([t for t in med.tags if t.startswith("fits:")], [t for t in eu.tags if t.startswith("fits:")], mid)
            self.assertIn("mediterranean", med.tags)
            self.assertNotIn("europe", med.tags)
        # Without a style, get_module keeps returning the European module (M05 callers).
        self.assertIs(get_module("wall.plain"), get_module("wall.plain", "european"))
        with self.assertRaises(KeyError):
            get_module("pergola", "european")

    def test_extras_do_not_overlap_the_common_kit(self):
        common_ids = {m.id for m in select_modules("common")}
        self.assertFalse(common_ids & set(self.by_id))
        for mid in MED_EXTRA_IDS:
            self.assertEqual(self.by_id[mid].tri_budget, budgets.budget_for(mid), mid)
        self.assertEqual(budgets.budget_class("bougainvillea"), "plant")
        self.assertEqual(budgets.budget_class("tree.lemon"), "plant")
        self.assertEqual(budgets.budget_class("pergola"), "prop")
        for mid in ("pergola", "bougainvillea", "tree.lemon"):
            self.assertTrue(self.by_id[mid].canopy and self.by_id[mid].trunk, mid)

    def test_extras_match_shared(self):
        with open(os.path.join(REPO, "packages", "shared", "src", "assets", "budgets.ts"), encoding="utf-8") as f:
            src = f.read()
        ids = re.search(r"mediterranean: \[([^\]]*)\]", src).group(1)
        self.assertEqual(re.findall(r'"([a-z_.]+)"', ids), list(MED_EXTRA_IDS))

    def test_variant_params_are_seeded_and_distinct(self):
        for m in self.modules:
            params = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            again = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            self.assertEqual(params, again, m.id)
            self.assertEqual(len({json.dumps(p, sort_keys=True) for p in params}), m.variants, f"{m.id} variants must differ")

    def test_walls_share_a_swatch_per_variant(self):
        for i in range(3):
            swatches = set()
            for m in self.modules:
                if not ({"wall", "corner"} & set(m.tags)):
                    continue
                swatches.add(m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params"))["swatch"])
            self.assertEqual(swatches, {common.WALL_SWATCH_BY_VARIANT[i]}, f"variant {i}")

    def test_constants_match_the_style(self):
        self.assertEqual(common.WALL_T, self.style.wall_thickness_m)
        self.assertEqual(common.ROOF_PITCH_DEG, self.style.roof_pitch_deg)
        self.assertEqual(common.EAVE_M, self.style.eave_overhang_m)
        self.assertLess(common.ROOF_PITCH_DEG, get_style("european").roof_pitch_deg)
        tiles = [t.name for t in self.style.atlas().tiles]
        for tile in ("stucco", "roof_clay", "terracotta", "paving", "timber", "leaves", "bark"):
            self.assertIn(tile, tiles)
        for group in ("walls", "roofs", "trims", "accents", "glass", "light", "iron", "blossom", "citrus", "pot", "ceramic", "flowers"):
            self.assertIn(group, self.style.palette)

    def test_chimney_and_dormer_reach_the_low_roof(self):
        # The European sockets sit higher than this kit's roof surface; the chimney and the
        # dormer must reach down to it at the largest roof scale (depth across the ridge / 2) of
        # any building recipe with a chimney or dormers.
        from hvmodules.europe import roofs as eu_roofs

        recipes_dir = os.path.join(REPO, "packages", "shared", "src", "buildings")
        worst = 1.0
        for name in os.listdir(recipes_dir):
            if not name.endswith(".json"):
                continue
            with open(os.path.join(recipes_dir, name), encoding="utf-8") as f:
                r = json.load(f)
            if r["roof"].get("chimney") or r["roof"].get("dormers"):
                across = r["footprint"]["d"] if r["roof"]["ridge"] == "x" else r["footprint"]["w"]
                worst = max(worst, across / common.ROOF_D)
        self.assertGreaterEqual(worst, 2.0)

        gable_chimney = next(s for s in get_module("roof.gable").sockets if s.name == "chimney").pos
        hip_chimney = next(s for s in get_module("roof.hip").sockets if s.name == "chimney").pos
        dormer = next(s for s in get_module("roof.gable").sockets if s.name == "dormer").pos
        hip_rise = common.HALF + common.EAVE_M
        for scale in (1.0, worst):
            gap = (gable_chimney[2] - common.roof_surface_z(gable_chimney[1])) * scale
            self.assertLess(gap, common.CHIMNEY_SINK_M, scale)
            edge = min(hip_chimney[0] + common.EAVE_M, common.ROOF_W + common.EAVE_M - hip_chimney[0], hip_chimney[1] + common.EAVE_M, common.ROOF_D + common.EAVE_M - hip_chimney[1])
            hip_z = roofs.HIP_BASE_Z + edge / hip_rise * (roofs.HIP_RISE - roofs.HIP_BASE_Z)
            self.assertLess((hip_chimney[2] - hip_z) * scale, common.CHIMNEY_SINK_M, scale)
            self.assertLess((dormer[2] - common.roof_surface_z(dormer[1])) * scale, common.DORMER_SINK_M + 0.05, scale)
        self.assertGreater(gable_chimney[2], common.roof_surface_z(gable_chimney[1]))
        self.assertAlmostEqual(eu_roofs.roof_surface_z(dormer[1]), dormer[2])

    def test_gables_clear_the_roof(self):
        for name, prof in roofs.gable_profiles().items():
            self.assertEqual(common.gable_clearance(prof), [], name)
            self.assertGreater(abs(solids.signed_area(prof)), 0.5, name)
        blocks = roofs.parapet_blocks()
        run = blocks[1][0] - blocks[0][0]
        for k, (ya, yb, za, zb) in enumerate(blocks):
            exposed_end = ya + run if k < len(blocks) - 1 else (ya + yb) / 2
            self.assertGreater(zb, common.roof_surface_z(min(exposed_end, common.HALF)) + 0.05, k)
        self.assertLess(roofs.BELL_CROWN, get_module("roof.stepped_gable").footprint.h)

    def test_roof_surface_and_tiles(self):
        self.assertAlmostEqual(common.roof_surface_z(0.0), common.SLAB_UP)
        self.assertAlmostEqual(common.roof_surface_z(1.0), common.RIDGE_Z)
        self.assertAlmostEqual(common.ROOF_RISE, math.tan(math.radians(25.0)))
        cols = roofs.tile_columns(0.0, 2.0)
        self.assertEqual(len(cols), 10)
        self.assertTrue(all(0.0 < c < 2.0 for c in cols))
        ribs = roofs.hip_rib_lengths(-0.2, 2.2, -0.2, 2.2)
        self.assertTrue(ribs)
        for x, run in ribs:
            self.assertLessEqual(run, min(x + 0.2, 2.2 - x))

    def test_arch_solids(self):
        arc = solids.arc_points(0.2, 0.8, 1.9, 0.3, 8)
        self.assertEqual(arc[0], (0.2, 1.9))
        self.assertEqual(arc[-1], (0.8, 1.9))
        self.assertAlmostEqual(arc[4][1], 2.2)
        prof = solids.arched_profile(0.2, 0.8, 0.0, 1.9, 0.3, 8)
        self.assertGreater(solids.signed_area(prof), 0)
        left, right = solids.arch_spandrels(0.2, 0.8, 1.9, 0.3, 8)
        hole = 0.6 * 2.2
        # Opening + spandrels = the rectangle.
        self.assertAlmostEqual(abs(solids.signed_area(prof)) + abs(solids.signed_area(left)) + abs(solids.signed_area(right)), hole, places=6)
        ring = solids.arch_ring(0.2, 0.8, 1.9, 0.3, 0.07, 8)
        self.assertGreater(abs(solids.signed_area(ring)), 0.0)
        with self.assertRaises(ValueError):
            solids.arc_points(0.2, 0.8, 1.9, 0.3, 7)


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "mediterranean kit not generated")
class GeneratedKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with
    npm run assets:build -- --style mediterranean after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], "mediterranean")
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(BUILDING_IDS + MED_EXTRA_IDS))
        for mid, e in entries.items():
            m = get_module(mid, "mediterranean")
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)


if __name__ == "__main__":
    unittest.main()
