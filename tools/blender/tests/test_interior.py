import json
import os
import re
import unittest

import hvmodules  # noqa: F401  (registers modules)
from hvkit import budgets, grid
from hvkit import manifest as mf
from hvkit.grid import Placement
from hvkit.module import get_module, select_modules
from hvkit.styles import INTERIOR_KIT_ID, get_style
from hvkit.variants import VariantRng
from hvmodules.interior import base

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "interior", "kit-manifest.json")


def read(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
        return f.read()


def ts_ids(src, name):
    body = re.search(rf"{name} = \[([^\]]*)\]", src).group(1)
    return re.findall(r'"([a-z_.]+)"', body)


def is_panel(mid):
    return mid.startswith("floor.") or mid.startswith("iwall.")


class PlacementTest(unittest.TestCase):
    def test_sizes_footprint_and_json(self):
        p = Placement(w=3, d=1, against_wall=True)
        self.assertEqual((p.width_m, p.depth_m), (1.5, 0.5))
        fp = p.footprint(2.2)
        self.assertEqual((fp.w, fp.d, fp.h), (2, 1, 2.2))
        self.assertEqual(Placement(w=2, d=4).footprint(1.0).to_json(), {"w": 1, "d": 2, "h": 1.0})
        self.assertEqual(p.to_json(), {"cell": 0.5, "w": 3, "d": 1, "mount": "floor", "againstWall": True})
        with self.assertRaises(ValueError):
            Placement(w=0, d=1)
        with self.assertRaises(ValueError):
            Placement(w=1, d=1, mount="ceiling")

    def test_constants_match_shared(self):
        src = read("packages", "shared", "src", "assets", "kit.ts")
        self.assertEqual(float(re.search(r"export const PLACEMENT_CELL_M = ([0-9.]+);", src).group(1)), grid.PLACEMENT_CELL_M)
        mounts = re.search(r"PLACEMENT_MOUNTS = \[([^\]]*)\]", src).group(1)
        self.assertEqual(tuple(re.findall(r'"([a-z]+)"', mounts)), grid.PLACEMENT_MOUNTS)
        self.assertIn(f'INTERIOR_KIT_ID = "{INTERIOR_KIT_ID}"', src)

    def test_manifest_entry_and_validation(self):
        bed = get_module("bed")
        result = mf.VariantResult((0.0, 0.0, 0.0), (1.0, 2.0, 1.1), 600)
        entry = mf.module_entry(bed, [result] * bed.variants)
        self.assertEqual(entry["placement"], bed.placement.to_json())
        self.assertNotIn("placement", mf.module_entry(get_module("floor.wood"), [result] * 3))
        manifest = mf.build_manifest(INTERIOR_KIT_ID, [entry])
        self.assertEqual(mf.validate_manifest(manifest), [])
        for bad in ({"w": 5}, {"cell": 1.0}, {"mount": "ceiling"}, {"againstWall": "yes"}, {"d": 0}):
            broken = json.loads(json.dumps(manifest))
            broken["modules"][0]["placement"].update(bad)
            self.assertTrue(mf.validate_manifest(broken), bad)

    def test_definition_checks_the_footprint(self):
        class Wrong(base.Furniture):
            id = "wrong.piece"
            placement = Placement(w=3, d=1)
            footprint = grid.Footprint(w=1, d=1, h=1.0)

        self.assertTrue(any("footprint" in e for e in Wrong().definition_errors()))
        lo, hi = get_module("chair").nominal_bounds()
        self.assertEqual((lo, hi), ((0.0, 0.0, 0.0), (0.5, 0.5, get_module("chair").height)))


class InteriorModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("interior")
        self.modules = select_modules(INTERIOR_KIT_ID)

    def test_registered_modules_match_shared(self):
        src = read("packages", "shared", "src", "assets", "budgets.ts")
        self.assertEqual(sorted(m.id for m in self.modules), sorted(ts_ids(src, "KIT_INTERIOR_MODULE_IDS")))
        others = {m.id for m in select_modules("european")} | {m.id for m in select_modules("common")}
        self.assertFalse(others & {m.id for m in self.modules})
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.styles, (INTERIOR_KIT_ID,), m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.tri_budget, budgets.budget_for(m.id), m.id)
        self.assertEqual(budgets.budget_for("floor.tile"), budgets.TILE_BUDGET)
        self.assertEqual(budgets.budget_for("iwall.door"), budgets.WALL_BUDGET)
        self.assertEqual(budgets.budget_for("bakery.oven"), budgets.PROP_BUDGET)

    def test_every_furniture_piece_declares_a_placement(self):
        for m in self.modules:
            if is_panel(m.id):
                self.assertIsNone(m.placement, m.id)
                continue
            p = m.placement
            self.assertIsNotNone(p, m.id)
            self.assertIn("furniture", m.tags, m.id)
            fp = p.footprint(m.footprint.h)
            self.assertEqual((m.footprint.w, m.footprint.d), (fp.w, fp.d), m.id)
            if p.mount == "wall":
                self.assertFalse(p.against_wall, m.id)  # wall pieces hang on the wall instead
                self.assertIn("wall_mounted", m.tags, m.id)

    def test_sockets(self):
        for m in self.modules:
            names = {s.name: s for s in m.sockets}
            if is_panel(m.id):
                if m.id.startswith("iwall."):
                    self.assertEqual(names["face"].pos[1], base.ROOM_FACE_Y, m.id)
                continue
            if m.placement.mount in ("floor", "wall") and m.id != "painting":
                use = names["use"]
                self.assertEqual(use.pos, (m.placement.width_m / 2, 0.0, 0.0), m.id)
                self.assertEqual(use.normal, base.FRONT, m.id)
            if "counter" in m.tags:
                self.assertIn("vendor", names, m.id)
                self.assertIn("counter", names, m.id)
                self.assertGreater(names["vendor"].pos[1], names["counter"].pos[1], m.id)
        self.assertEqual(get_module("chair").sockets[1].pos[2], base.SEAT_Z)
        self.assertEqual(get_module("lamp.table").placement.mount, "surface")
        self.assertEqual(get_module("rug").placement.mount, "rug")
        self.assertTrue(all(get_module(mid).placement.mount == "wall" for mid in ("mirror", "painting")))

    def test_studio_pieces_from_the_gdd(self):
        # GDD §4.2: bed, kitchen nook, table, mirror and wardrobe (the window is iwall.window).
        for mid in ("bed", "kitchen.nook", "table", "mirror", "wardrobe", "iwall.window"):
            self.assertIn("apartment" if not is_panel(mid) else "room", get_module(mid).tags, mid)
        for mid in ("bed", "kitchen.nook", "wardrobe", "shelf", "sofa", "bakery.oven"):
            self.assertTrue(get_module(mid).placement.against_wall, mid)

    def test_variant_params_are_seeded_and_distinct(self):
        for m in self.modules:
            params = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            again = [m.variant_params(self.style, i, m.rng(self.style.id, i).fork("params")) for i in range(m.variants)]
            self.assertEqual(params, again, m.id)
            self.assertEqual(len({json.dumps(p, sort_keys=True) for p in params}), m.variants, f"{m.id} variants must differ")

    def test_palette_atlas_and_walls(self):
        tiles = [t.name for t in self.style.atlas().tiles]
        for tile in ("floorboards", "tiles", "brick", "fabric", "leaves", "straw", "wood", "stone"):
            self.assertIn(tile, tiles)
        self.assertEqual(base.IWALL_T, self.style.wall_thickness_m)
        self.assertLess(self.style.vertex_noise_m, self.style.bevel_width_m)
        x0, x1, z0, z1 = base.WINDOW
        self.assertTrue(0 < x0 < x1 < 1 and 0 < z0 < z1 < base.WALL_H)
        self.assertEqual(base.DOOR[2], 0.0)

    def test_helpers(self):
        pts = base.ellipse(0.0, 1.0, 0.2, 0.3, 8)
        self.assertEqual(len(pts), 8)
        self.assertAlmostEqual(max(z for _, z in pts), 1.3)
        arch = base.arch_profile(0.0, 1.0, 0.0, 0.6, 8)
        self.assertAlmostEqual(max(z for _, z in arch), 1.1)
        lines = base.split_lines(VariantRng(1), 0.0, 1.0, 3, 0.25)
        self.assertEqual((lines[0], lines[-1], len(lines)), (0.0, 1.0, 4))
        self.assertEqual(lines, sorted(lines))


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "interior kit not generated")
class GeneratedInteriorKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with
    npm run assets:build -- --style interior after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], INTERIOR_KIT_ID)
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(m.id for m in select_modules(INTERIOR_KIT_ID)))
        for mid, e in entries.items():
            m = get_module(mid)
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e.get("placement"), m.placement.to_json() if m.placement else None, mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)


if __name__ == "__main__":
    unittest.main()
