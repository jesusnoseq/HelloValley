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
from hvmodules.common import water
from hvmodules.japanese import common, roofs
from hvmodules.japanese.extras import JAP_EXTRA_IDS, LanternStone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "japanese", "kit-manifest.json")
RECIPES = os.path.join(REPO, "packages", "shared", "src", "buildings")

BUILDING_IDS = tuple(m.id for m in select_modules("european"))


def recipes():
    for name in sorted(os.listdir(RECIPES)):
        if name.endswith(".json"):
            with open(os.path.join(RECIPES, name), encoding="utf-8") as f:
                yield json.load(f)


def across_scale(r):
    """Scale the M10 assembler gives a recipe's 2 x 2 roof across the ridge (also vertically)."""
    w, d = r["footprint"]["w"], r["footprint"]["d"]
    return (d if r["roof"]["ridge"] == "x" else w) / common.ROOF_D


class JapaneseModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("jp")
        self.modules = select_modules("japanese")
        self.by_id = {m.id: m for m in self.modules}

    def test_every_european_module_has_a_japanese_twin_plus_the_extras(self):
        self.assertEqual(sorted(self.by_id), sorted(BUILDING_IDS + JAP_EXTRA_IDS))
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.styles, ("japanese",), m.id)
            for other in ("european", "mediterranean", "arabic"):
                self.assertFalse(m.applies_to(other), m.id)

    def test_twins_share_footprint_sockets_budget_and_fits(self):
        for mid in BUILDING_IDS:
            eu, jp = get_module(mid, "european"), get_module(mid, "japanese")
            self.assertIsNot(eu, jp)
            self.assertEqual(jp.footprint, eu.footprint, mid)
            self.assertEqual(jp.sockets, eu.sockets, mid)
            self.assertEqual(jp.tri_budget, eu.tri_budget, mid)
            self.assertEqual([t for t in jp.tags if t.startswith("fits:")], [t for t in eu.tags if t.startswith("fits:")], mid)
            self.assertIn("japanese", jp.tags)
            self.assertNotIn("europe", jp.tags)
        self.assertIs(get_module("wall.plain"), get_module("wall.plain", "european"))
        with self.assertRaises(KeyError):
            get_module("lantern.stone", "european")

    def test_extras(self):
        other = {m.id for s in ("common", "european", "mediterranean", "arabic", "interior") for m in select_modules(s)}
        self.assertFalse(other & set(JAP_EXTRA_IDS))
        for mid in JAP_EXTRA_IDS:
            self.assertEqual(self.by_id[mid].tri_budget, budgets.budget_for(mid), mid)
        for mid in ("tree.pine", "tree.maple"):
            tree = self.by_id[mid]
            self.assertTrue(tree.canopy and tree.trunk, mid)
            self.assertEqual(budgets.budget_class(mid), "plant")
            self.assertEqual((tree.footprint.w, tree.footprint.d), (2, 2), mid)
        # The wooden bridge can stand in for the stone bridge over the river.
        stone, wooden = get_module("bridge.stone", "common"), self.by_id["bridge.wooden"]
        self.assertEqual((wooden.footprint.w, wooden.footprint.d), (stone.footprint.w, stone.footprint.d))
        self.assertEqual(wooden.sockets, stone.sockets)
        self.assertEqual(wooden.sink_m, stone.sink_m)
        self.assertIn("walkable", wooden.tags)
        # The stone lantern stays inside its walking blocker (props.ts: 0.15..0.85).
        self.assertLessEqual(0.5 + LanternStone.REACH, 0.85)
        self.assertEqual(water.deck_z(0.0), water.deck_z(water.BRIDGE_D))

    def test_extras_match_shared(self):
        with open(os.path.join(REPO, "packages", "shared", "src", "assets", "budgets.ts"), encoding="utf-8") as f:
            src = f.read()
        ids = re.search(r"japanese: \[([^\]]*)\]", src).group(1)
        self.assertEqual(re.findall(r'"([a-z_.]+)"', ids), list(JAP_EXTRA_IDS))

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
        tiles = [t.name for t in self.style.atlas().tiles]
        for tile in ("shikkui", "timber", "kawara", "paving", "gravel", "bamboo", "leaves", "bark"):
            self.assertIn(tile, tiles)
        self.assertLessEqual(len(tiles), self.style.atlas().layout.capacity)
        for group in ("walls", "roofs", "trims", "foliage", "ground", "accents", "glass", "light", "iron", "stone", "bamboo", "rope", "fabric", "maple", "pine", "bark", "flowers", "lacquer"):
            self.assertIn(group, self.style.palette)

    def test_curved_slope(self):
        # Through the wall top's outer edge, up to the mean pitch at the ridge, concave.
        self.assertAlmostEqual(common.roof_under(0.0), 0.0)
        self.assertAlmostEqual(common.roof_under(common.HALF), math.tan(math.radians(common.ROOF_PITCH_DEG)))
        slopes = [common.roof_under(u + 0.1) - common.roof_under(u) for u in (-0.4, 0.0, 0.4, 0.8)]
        self.assertEqual(slopes, sorted(slopes))
        self.assertAlmostEqual(common.roof_surface_z(0.4), common.roof_surface_z(common.ROOF_D - 0.4))
        cols = roofs.tile_columns(0.0, 2.0)
        self.assertEqual(len(cols), 10)

    def test_chimney_and_dormer_reach_the_roof(self):
        # The European sockets sit higher than this kit's curved roof; the chimney and the dormer
        # must reach down to it at every recipe's roof scale.
        gable_chimney = next(s for s in get_module("roof.gable").sockets if s.name == "chimney").pos
        hip_chimney = next(s for s in get_module("roof.hip").sockets if s.name == "chimney").pos
        dormer = next(s for s in get_module("roof.gable").sockets if s.name == "dormer").pos
        checked = 0
        for r in recipes():
            scale = across_scale(r)
            mid = r["roof"]["module"]
            if r["roof"].get("chimney"):
                sock = gable_chimney if mid == "roof.gable" else hip_chimney
                if mid == "roof.gable":
                    surface = common.roof_surface_z(sock[1])
                else:
                    edge = min(sock[0], common.ROOF_W - sock[0], sock[1], common.ROOF_D - sock[1])
                    surface = common.roof_under(edge) + common.SLAB_UP
                self.assertGreater(sock[2], surface - 0.05, r["id"])
                self.assertLess((sock[2] - surface) * scale, common.CHIMNEY_SINK_M - 0.05, r["id"])
                checked += 1
            if r["roof"].get("dormers"):
                self.assertLess((dormer[2] - common.roof_surface_z(dormer[1])) * scale, common.DORMER_SINK_M - 0.03, r["id"])
                checked += 1
        self.assertGreaterEqual(checked, 6)

    def test_curved_hip_solid(self):
        # A pyramid (the apex welds into one point) and a ridged roof: closed, outward-facing.
        for k in (1.0, 0.6):
            verts, faces = roofs.curved_hip(roofs.HIP_US, k)
            self.assertTrue(faces)
            for f in faces:
                self.assertEqual(len(set(f)), len(f))
            top = max(v[2] for v in verts)
            self.assertAlmostEqual(top, common.roof_under(common.HALF) + common.SLAB_UP, places=5)
            lo = min(v[2] for v in verts)
            self.assertGreater(lo, -0.45)
        ring = roofs.hip_ring(-common.EAVE_M, 1.0, common.CORNER_LIFT)
        self.assertGreater(ring[0][2], ring[1][2])  # the corners turn up
        rows = roofs.hip_tile_rows(1.0, common.HALF)
        self.assertTrue(rows)
        for face, s, reach in rows:
            self.assertLessEqual(reach, common.HALF)
        prof = roofs.gable_wall_profile()
        self.assertGreater(abs(solids.signed_area(prof)), 0.5)
        self.assertLess(max(z for _, z in prof), common.RIDGE_Z)


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "japanese kit not generated")
class GeneratedKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with
    npm run assets:build -- --style japanese after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], "japanese")
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(BUILDING_IDS + JAP_EXTRA_IDS))
        for mid, e in entries.items():
            m = get_module(mid, "japanese")
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)
        self.assertLess(math.fsum(e["tris"][0] for e in entries.values()), 20000)


if __name__ == "__main__":
    unittest.main()
