import json
import math
import os
import re
import unittest

import hvmodules  # noqa: F401  (registers modules)
from hvkit import manifest as mf
from hvkit.module import get_module, select_modules
from hvkit.styles import get_style
from hvmodules.europe import common, roofs

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "european", "kit-manifest.json")

# Build plan M05 module list.
EUROPE_IDS = (
    "wall.plain", "wall.window", "wall.door", "wall.shopfront", "wall.timber", "corner.outer",
    "corner.inner", "roof.gable", "roof.hip", "roof.stepped_gable", "dormer", "chimney", "balcony",
    "awning", "flowerbox", "shutters", "sign.hanging", "stair", "fence", "lamp", "bench", "tile.cobble",
)


class EuropeModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("europe")
        self.modules = select_modules("european")

    def test_every_m05_module_is_registered_with_three_variants(self):
        self.assertEqual(sorted(m.id for m in self.modules), sorted(EUROPE_IDS))
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.styles, ("european",), m.id)
            self.assertTrue(m.applies_to("european") and not m.applies_to("japanese"))

    def test_budgets_follow_the_gdd(self):
        for m in self.modules:
            self.assertEqual(m.tri_budget, common.budget_for(m.id), m.id)
        self.assertEqual(common.budget_for("wall.timber"), (150, 600))
        self.assertEqual(common.budget_for("corner.inner"), (150, 600))
        self.assertEqual(common.budget_for("lamp")[1], 2000)

    def test_budgets_match_shared(self):
        with open(os.path.join(REPO, "packages", "shared", "src", "assets", "budgets.ts"), encoding="utf-8") as f:
            src = f.read()
        for name, value in (("wall", common.WALL_BUDGET), ("tile", common.TILE_BUDGET), ("prop", common.PROP_BUDGET)):
            m = re.search(rf"{name}: \{{ min: (\d+), max: (\d+) \}}", src)
            self.assertEqual((int(m.group(1)), int(m.group(2))), value, name)
        ids = re.search(r"KIT_BUILDING_MODULE_IDS = \[([^\]]*)\]", src).group(1)
        self.assertEqual(sorted(re.findall(r'"([a-z_.]+)"', ids)), sorted(EUROPE_IDS))

    def test_variant_params_are_seeded_and_distinct(self):
        for m in self.modules:
            params = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            again = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            self.assertEqual(params, again, m.id)
            self.assertEqual(len({json.dumps(p, sort_keys=True) for p in params}), m.variants, f"{m.id} variants must differ")

    def test_walls_share_a_swatch_per_variant(self):
        # M10: one building uses one variant index, so its walls and corners must match.
        for i in range(3):
            swatches = set()
            for m in self.modules:
                if "wall" not in m.tags or m.id == "wall.timber":
                    continue
                swatches.add(m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params"))["swatch"])
            self.assertEqual(swatches, {common.WALL_SWATCH_BY_VARIANT[i]}, f"variant {i}")

    def test_constants_match_the_style(self):
        self.assertEqual(common.WALL_T, self.style.wall_thickness_m)
        self.assertEqual(common.ROOF_PITCH_DEG, self.style.roof_pitch_deg)
        self.assertEqual(common.EAVE_M, self.style.eave_overhang_m)
        for group in ("glass", "light", "iron"):
            self.assertIn(group, self.style.palette)

    def test_walls_share_the_storey_sockets(self):
        for mid in ("wall.plain", "wall.window", "wall.door", "wall.shopfront", "wall.timber"):
            m = get_module(mid)
            names = {s.name: s for s in m.sockets}
            self.assertEqual(m.footprint.to_json(), {"w": 1, "d": 1, "h": 3.0})
            for name in ("top", "left", "right", "facade"):
                self.assertIn(name, names, mid)
            self.assertEqual(names["facade"].pos, (0.5, 0.0, 0.0))

    def test_attachments_mount_on_the_facade(self):
        wall_facade = next(s for s in get_module("wall.plain").sockets if s.name == "facade")
        for mid in ("balcony", "awning", "flowerbox", "shutters", "sign.hanging"):
            m = get_module(mid)
            mount = next(s for s in m.sockets if s.name == "mount")
            # One cell forward: the attachment's back plane (y = 1) is the wall face (y = 0).
            self.assertEqual((mount.pos[0], mount.pos[1] - 1.0, mount.pos[2]), wall_facade.pos, mid)
            self.assertEqual(mount.normal, wall_facade.normal)
            self.assertTrue(any(t.startswith("fits:wall.") for t in m.tags), mid)

    def test_openings_fit_their_walls(self):
        for x0, x1, z0, z1 in (common.WINDOW, common.DOOR, common.SHOPFRONT):
            self.assertTrue(0 < x0 < x1 < 1 and 0 <= z0 < z1 < common.CORNICE_Z)
        self.assertLess(common.SHOPFRONT[3], common.FASCIA_Z[0])

    def test_stepped_gable_clears_the_roof(self):
        blocks = roofs.stepped_gable_blocks()
        run = blocks[1][0] - blocks[0][0]
        for k, (ya, yb, za, zb) in enumerate(blocks):
            # The exposed top of each step must stay above the roof surface beside it.
            exposed_end = ya + run if k < len(blocks) - 1 else (ya + yb) / 2
            self.assertGreater(zb, roofs.roof_surface_z(min(exposed_end, common.ROOF_D / 2)) + 0.05, k)

    def test_roof_surface(self):
        self.assertAlmostEqual(roofs.roof_surface_z(0.0), roofs.SLAB_UP)
        self.assertAlmostEqual(roofs.roof_surface_z(1.0), common.ROOF_RISE + roofs.SLAB_UP)
        self.assertAlmostEqual(roofs.roof_surface_z(0.5), roofs.roof_surface_z(1.5))
        self.assertAlmostEqual(common.ROOF_RISE, math.tan(math.radians(50.0)))
        self.assertAlmostEqual(roofs.hip_surface_z(1.0, 1.0), roofs.HIP_RISE)

    def test_lines_and_openings(self):
        xs = common.lines(0.0, 1.0, [0.22, 0.78], 0.34)
        self.assertEqual(xs[0], 0.0)
        self.assertEqual(xs[-1], 1.0)
        self.assertIn(0.22, xs)
        self.assertIn(0.78, xs)
        self.assertEqual(xs, sorted(set(xs)))
        cells = common.opening_cells(xs, [0, 1.0, 2.1, 3.0], common.WINDOW)
        self.assertTrue(cells)
        self.assertTrue(all(j == 1 for _, j in cells))


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "europe kit not generated")
class GeneratedKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with npm run assets:build
    after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], "european")
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(EUROPE_IDS))
        for mid, e in entries.items():
            m = get_module(mid)
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)


if __name__ == "__main__":
    unittest.main()
