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
from hvmodules.arabic import common, roofs
from hvmodules.arabic.extras import ARAB_EXTRA_IDS, FOUNTAIN_R

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KIT_MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "kits", "arabic", "kit-manifest.json")
RECIPES = os.path.join(REPO, "packages", "shared", "src", "buildings")

BUILDING_IDS = tuple(m.id for m in select_modules("european"))


def recipes():
    for name in sorted(os.listdir(RECIPES)):
        if name.endswith(".json"):
            with open(os.path.join(RECIPES, name), encoding="utf-8") as f:
                yield json.load(f)


def roof_scale(r):
    """(along, across) scale the M10 assembler gives a recipe's 2 x 2 roof."""
    w, d = r["footprint"]["w"], r["footprint"]["d"]
    along, across = (w, d) if r["roof"]["ridge"] == "x" else (d, w)
    return along / common.ROOF_W, across / common.ROOF_D


class ArabicModulesTest(unittest.TestCase):
    def setUp(self):
        self.style = get_style("arab")
        self.modules = select_modules("arabic")
        self.by_id = {m.id: m for m in self.modules}

    def test_every_european_module_has_an_arabic_twin_plus_the_extras(self):
        self.assertEqual(sorted(self.by_id), sorted(BUILDING_IDS + ARAB_EXTRA_IDS))
        for m in self.modules:
            self.assertEqual(m.variants, 3, m.id)
            self.assertEqual(m.definition_errors(), [], m.id)
            self.assertEqual(m.styles, ("arabic",), m.id)
            self.assertFalse(m.applies_to("european"), m.id)
            self.assertFalse(m.applies_to("mediterranean"), m.id)

    def test_twins_share_footprint_sockets_budget_and_fits(self):
        for mid in BUILDING_IDS:
            eu, ar = get_module(mid, "european"), get_module(mid, "arabic")
            self.assertIsNot(eu, ar)
            self.assertEqual(ar.footprint, eu.footprint, mid)
            self.assertEqual(ar.sockets, eu.sockets, mid)
            self.assertEqual(ar.tri_budget, eu.tri_budget, mid)
            self.assertEqual([t for t in ar.tags if t.startswith("fits:")], [t for t in eu.tags if t.startswith("fits:")], mid)
            self.assertIn("arabic", ar.tags)
            self.assertNotIn("europe", ar.tags)
        self.assertIs(get_module("wall.plain"), get_module("wall.plain", "european"))
        with self.assertRaises(KeyError):
            get_module("arcade", "european")

    def test_extras(self):
        other = {m.id for s in ("common", "european", "mediterranean", "interior") for m in select_modules(s)}
        self.assertFalse(other & set(ARAB_EXTRA_IDS))
        for mid in ARAB_EXTRA_IDS:
            self.assertEqual(self.by_id[mid].tri_budget, budgets.budget_for(mid), mid)
        palm = self.by_id["tree.date_palm"]
        self.assertTrue(palm.canopy and palm.trunk)
        self.assertEqual(budgets.budget_class("tree.date_palm"), "plant")
        # The courtyard fountain can stand in for the common fountain in the square.
        fountain, courtyard = get_module("fountain", "common"), self.by_id["fountain.courtyard"]
        self.assertEqual((courtyard.footprint.w, courtyard.footprint.d), (fountain.footprint.w, fountain.footprint.d))
        self.assertEqual(courtyard.sockets, fountain.sockets)
        self.assertLessEqual(FOUNTAIN_R, 0.95)

    def test_extras_match_shared(self):
        with open(os.path.join(REPO, "packages", "shared", "src", "assets", "budgets.ts"), encoding="utf-8") as f:
            src = f.read()
        ids = re.search(r"arabic: \[([^\]]*)\]", src).group(1)
        self.assertEqual(re.findall(r'"([a-z_.]+)"', ids), list(ARAB_EXTRA_IDS))

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
        tiles = [t.name for t in self.style.atlas().tiles]
        for tile in ("stucco", "zellige", "roof_tile", "paving", "timber", "leaves", "bark"):
            self.assertIn(tile, tiles)
        self.assertLessEqual(len(tiles), self.style.atlas().layout.capacity)
        for group in ("walls", "roofs", "trims", "accents", "glass", "light", "iron", "brass", "zellige", "dome", "fabric", "bark", "dates", "flowers", "spice", "water"):
            self.assertIn(group, self.style.palette)

    def test_chimney_and_dormer_reach_the_flat_deck(self):
        # The European sockets sit on the 50 degree slope, high above this kit's flat deck; the
        # chimney and the dormer must reach down to it at every recipe's roof scale.
        chimney = {mid: next(s for s in get_module(mid).sockets if s.name == "chimney").pos for mid in ("roof.gable", "roof.hip")}
        dormer = next(s for s in get_module("roof.gable").sockets if s.name == "dormer").pos
        checked = 0
        for r in recipes():
            _, across = roof_scale(r)
            mid = r["roof"]["module"]
            if r["roof"].get("chimney"):
                gap = (chimney[mid][2] - common.DECK_Z) * across
                self.assertLess(gap, common.CHIMNEY_SINK_M - 0.05, r["id"])
                checked += 1
            if r["roof"].get("dormers"):
                gap = (dormer[2] - common.DECK_Z) * across
                self.assertLess(gap, common.DORMER_SINK_M - 0.05, r["id"])
                # The kiosk's front stands behind the parapet.
                self.assertGreater(dormer[1] * across, common.PARAPET_T * across, r["id"])
                checked += 1
        self.assertGreaterEqual(checked, 6)

    def test_dome_clears_the_chimney(self):
        # roof.hip variant 0 (the dome) with a chimney: the chimney stack (0.4 m square) stays
        # outside the scaled dome drum.
        sock = next(s for s in get_module("roof.hip").sockets if s.name == "chimney").pos
        checked = 0
        for r in recipes():
            if r["roof"]["module"] == "roof.hip" and r["roof"].get("chimney") and r["roof"].get("variant", 0) % 3 == 0:
                checked += 1
                sx, sy = roof_scale(r)
                self.assertTrue(roofs.dome_clear_of(sock[0], sock[1], 0.22, sx, sy), r["id"])
        self.assertGreaterEqual(checked, 1)  # the library

    def test_parapets_and_merlons(self):
        spans = common.merlon_positions(0.0, 2.0)
        self.assertEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[-1][1], 2.0)
        for (a0, a1), (b0, _) in zip(spans, spans[1:]):
            self.assertGreater(b0, a1)
        roof_h = get_module("roof.gable").footprint.h
        self.assertLess(common.PARAPET_Z + common.MERLON_H, roof_h)
        self.assertLess(roofs.MINARET_TOP, get_module("roof.stepped_gable").footprint.h)

    def test_horseshoe_solids(self):
        x0, x1, z0, top = 0.22, 0.78, 1.0, 2.1
        r, zc, xj0, xj1, z_imp = solids.horseshoe_dims(x0, x1, top, 25.0)
        self.assertAlmostEqual(r, 0.28)
        self.assertAlmostEqual(zc, 1.82)
        self.assertGreater(xj0, x0)
        self.assertLess(xj1, x1)
        self.assertLess(z_imp, zc)
        arc = solids.horseshoe_arc(x0, x1, top, 25.0, 8, 2)
        self.assertEqual(arc[2], (x1, round(zc, 6)))
        self.assertEqual(arc[10], (x0, round(zc, 6)))
        self.assertAlmostEqual(arc[6][1], top)
        for segments, low in ((8, 2), (6, 1)):
            prof = solids.horseshoe_profile(x0, x1, z0, top, 25.0, segments, low)
            fillers = solids.horseshoe_fillers(x0, x1, z0, top, 25.0, segments, low)
            self.assertEqual(len(fillers), 4)
            # Opening + fillers = the rectangle.
            total = abs(solids.signed_area(prof)) + sum(abs(solids.signed_area(p)) for p in fillers)
            self.assertAlmostEqual(total, (x1 - x0) * (top - z0), places=5)
        with self.assertRaises(ValueError):
            solids.horseshoe_dims(0.2, 0.8, 2.0, 70.0)
        with self.assertRaises(ValueError):
            solids.horseshoe_profile(0.2, 0.8, 1.9, 2.0, 25.0)

    def test_polygons_and_domes(self):
        star = solids.star_polygon(0.5, 0.5, 0.4, 0.3, 8)
        self.assertEqual(len(star), 16)
        self.assertGreater(abs(solids.signed_area(star)), abs(solids.signed_area(solids.regular_polygon(0.5, 0.5, 0.3, 8))))
        rings = solids.dome_rings(0.4, 0.3, 5)
        self.assertEqual(rings[0], (0.0, 0.4))
        self.assertAlmostEqual(rings[-1][0], 0.3)
        self.assertTrue(all(b[1] <= a[1] for a, b in zip(rings, rings[1:])))
        onion = solids.dome_rings(0.3, 0.4, 4, onion=0.4)
        self.assertGreater(max(rad for _, rad in onion), onion[0][1] * 0.95)
        self.assertLess(onion[-1][1], 0.02)


@unittest.skipUnless(os.path.exists(KIT_MANIFEST), "arabic kit not generated")
class GeneratedKitTest(unittest.TestCase):
    """The committed kit matches the module definitions (rebuild with
    npm run assets:build -- --style arabic after changing a module)."""

    def test_manifest(self):
        with open(KIT_MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(mf.validate_manifest(manifest), [])
        self.assertEqual(manifest["style"], "arabic")
        self.assertEqual(manifest["atlas"]["file"], "atlas.webp")
        entries = {e["id"]: e for e in manifest["modules"]}
        self.assertEqual(sorted(entries), sorted(BUILDING_IDS + ARAB_EXTRA_IDS))
        for mid, e in entries.items():
            m = get_module(mid, "arabic")
            self.assertEqual(mf.budget_errors(m, e["tris"]), [], mid)
            self.assertEqual(e["sockets"], [s.to_json() for s in m.sockets], mid)
            self.assertEqual(e["footprint"], m.footprint.to_json(), mid)
            self.assertEqual(e["tags"], list(m.tags), mid)
            self.assertTrue(os.path.exists(os.path.join(os.path.dirname(KIT_MANIFEST), e["file"])), mid)
        self.assertLess(math.fsum(e["tris"][0] for e in entries.values()), 20000)


if __name__ == "__main__":
    unittest.main()
