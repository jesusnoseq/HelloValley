import copy
import json
import os
import re
import unittest

import hvmodules  # noqa: F401  (registers modules)
from hvkit import cli, grid
from hvkit import manifest as mf
from hvkit.color import hex_to_srgb
from hvkit.grid import Footprint
from hvkit.module import Module, Socket, get_module, register, select_modules
from hvkit.styles import COMMON_TILES, STYLE_IDS, available_styles, get_style, resolve_style_id
from hvkit.variants import VariantRng

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FIXTURES = os.path.join(REPO, "packages", "client", "test", "fixtures")
SYNTHETIC_MANIFEST = os.path.join(FIXTURES, "kits-synthetic", "european", "kit-manifest.json")
BLENDER_MANIFEST = os.path.join(FIXTURES, "kits", "european", "kit-manifest.json")


def read(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
        return f.read()


class StylesTest(unittest.TestCase):
    def test_aliases(self):
        self.assertEqual(resolve_style_id("europe"), "european")
        self.assertEqual(resolve_style_id(" European "), "european")
        with self.assertRaises(ValueError):
            resolve_style_id("martian")

    def test_later_styles_are_marked_pending(self):
        for style in ("japanese",):
            with self.assertRaises(NotImplementedError):
                get_style(style)
        self.assertEqual(available_styles(), ("arabic", "common", "european", "interior", "mediterranean"))
        self.assertEqual(get_style("med").id, "mediterranean")
        self.assertEqual(get_style("arab").id, "arabic")

    def test_european_palette_and_atlas(self):
        style = get_style("europe")
        for group in ("walls", "roofs", "trims", "foliage", "ground", "accents"):
            self.assertGreater(len(style.palette[group]), 0)
            for swatch in style.palette[group]:
                hex_to_srgb(swatch)
        atlas = style.atlas()
        names = [t.name for t in atlas.tiles]
        self.assertEqual(names[: len(COMMON_TILES)], [t.name for t in COMMON_TILES])
        self.assertIn("timber", names)
        self.assertLess(style.vertex_noise_m, style.bevel_width_m)
        self.assertEqual(style.swatch("walls", 5), style.palette["walls"][1])
        with self.assertRaises(KeyError):
            style.swatch("sky")


class ModuleTest(unittest.TestCase):
    def test_test_cube_is_registered_and_valid(self):
        cube = get_module("test.cube")
        self.assertEqual(cube.definition_errors(), [])
        self.assertEqual(cube.file_name, "test.cube.glb")
        self.assertTrue(cube.applies_to("japanese"))

    def test_test_cube_variants_are_seeded(self):
        cube = get_module("test.cube")
        style = get_style("european")
        params = [cube.variant_params(style, i, cube.rng(style.id, i).fork("params")) for i in range(cube.variants)]
        again = [cube.variant_params(style, i, cube.rng(style.id, i).fork("params")) for i in range(cube.variants)]
        self.assertEqual(params, again)
        self.assertEqual([p["swatch"] for p in params], [0, 1, 2])
        for p in params:
            self.assertTrue(0.03 <= p["radius"] <= 0.08)
            self.assertIn(p["tile"], [t.name for t in style.atlas().tiles])

    def test_selection(self):
        default = [m.id for m in select_modules("european")]
        self.assertNotIn("test.cube", default)  # test modules are opt-in
        self.assertIn("wall.plain", default)
        self.assertIn("test.cube", [m.id for m in select_modules("european", include_tests=True)])
        self.assertEqual([m.id for m in select_modules("european", only=["test.cube"])], ["test.cube"])
        self.assertEqual([m.id for m in select_modules("european", only=["test.*"])], ["test.cube"])
        with self.assertRaises(KeyError):
            select_modules("european", only=["wall.nope"])

    def test_definition_errors(self):
        class Bad(Module):
            id = "Bad Id"
            footprint = Footprint(1, 1, 1.0)
            sockets = (
                Socket("top", "stack", (0.5, 0.5, 2.0)),
                Socket("top", "glue", (0.5, 0.5, 1.0), (0, 0, 2)),
            )
            variants = 0
            tri_budget = (10, 5)

        errors = " | ".join(Bad().definition_errors())
        for needle in ("dotted lowercase", "at least one variant", "tri budget", "unique", "outside the footprint", "unknown kind", "unit length"):
            self.assertIn(needle, errors)
        with self.assertRaises(ValueError):
            register(Bad)

    def test_bounds_errors(self):
        cube = get_module("test.cube")
        self.assertEqual(cube.bounds_errors((0, 0, 0), (1, 1, 1)), [])
        errors = cube.bounds_errors((-0.1, 0, 0), (1, 1.2, 1))
        self.assertEqual(len(errors), 2)

        class Eaves(Module):
            id = "roof.test"
            footprint = Footprint(1, 1)
            max_overhang_m = 0.3

        self.assertEqual(Eaves().bounds_errors((-0.25, -0.25, 0), (1.25, 1.25, 3.2)), [])


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.cube = get_module("test.cube")
        self.results = [mf.VariantResult((0, 0, 0), (1, 1, 1), 12) for _ in range(3)]

    def test_entry_matches_blender_fixture(self):
        """The committed Blender output for test.cube (client loader fixture) matches what the
        manifest code produces for the module, apart from the measured triangle counts."""
        with open(BLENDER_MANIFEST, encoding="utf-8") as f:
            fixture = json.load(f)
        self.assertEqual(mf.validate_manifest(fixture), [])
        entry = fixture["modules"][0]
        results = [mf.VariantResult((0, 0, 0), (1, 1, 1), t) for t in entry["tris"]]
        self.assertEqual(entry, mf.module_entry(self.cube, results))
        self.assertEqual(mf.budget_errors(self.cube, entry["tris"]), [])
        self.assertEqual(fixture["generator"], "hellovalley-blender/1")
        self.assertEqual(fixture["atlas"]["file"], "atlas.webp")

    def test_entry_matches_synthetic_fixture(self):
        """tools/fixtures/make-test-kit.mjs writes the same entry without Blender."""
        with open(SYNTHETIC_MANIFEST, encoding="utf-8") as f:
            fixture = json.load(f)
        self.assertEqual(mf.validate_manifest(fixture), [])
        self.assertEqual(fixture["modules"][0], mf.module_entry(self.cube, self.results))
        built = mf.build_manifest("european", [mf.module_entry(self.cube, self.results)])
        for key in ("version", "style", "grid", "atlas"):
            self.assertEqual(built[key], fixture[key])

    def test_entry_is_gltf_space(self):
        entry = mf.module_entry(self.cube, self.results)
        self.assertEqual(entry["bounds"], {"min": [0.0, 0.0, -1.0], "max": [1.0, 1.0, 0.0]})
        top = next(s for s in entry["sockets"] if s["name"] == "top")
        self.assertEqual(top["pos"], [0.5, 1.0, -0.5])
        self.assertEqual(top["normal"], [0.0, 1.0, 0.0])
        with self.assertRaises(ValueError):
            mf.module_entry(self.cube, self.results[:2])

    def test_manifest_is_sorted_and_stable(self):
        a = dict(mf.module_entry(self.cube, self.results), id="b.mod", file="b.mod.glb")
        b = dict(mf.module_entry(self.cube, self.results), id="a.mod", file="a.mod.glb")
        m = mf.build_manifest("european", [a, b])
        self.assertEqual([e["id"] for e in m["modules"]], ["a.mod", "b.mod"])
        self.assertEqual(mf.dumps(m), mf.dumps(copy.deepcopy(m)))
        self.assertTrue(mf.dumps(m).endswith("}\n"))
        self.assertEqual(mf.validate_manifest(m), [])

    def test_atlas_entry_flips_v(self):
        atlas = get_style("european").atlas()
        entry = mf.atlas_entry("atlas.png", 512, {t.name: atlas.uv_rect(t.name) for t in atlas.tiles})
        u0, v0, u1, v1 = entry["tiles"]["plain"]  # tile 0, top-left in the image
        self.assertAlmostEqual(v0, 4 / 512, places=6)
        self.assertTrue(u0 < u1 and v0 < v1)
        m = mf.build_manifest("european", [mf.module_entry(self.cube, self.results)], entry)
        self.assertEqual(mf.validate_manifest(m), [])

    def test_validation_catches_problems(self):
        good = mf.build_manifest("european", [mf.module_entry(self.cube, self.results)])
        cases = {
            "version": lambda m: m.update(version=2),
            "grid": lambda m: m.update(grid={"cell": 2, "storey": 3}),
            "invalid id": lambda m: m["modules"][0].update(id="Wall"),
            "file": lambda m: m["modules"][0].update(file="x.fbx"),
            "tris needs": lambda m: m["modules"][0].update(tris=[1]),
            "min > max": lambda m: m["modules"][0]["bounds"].update(min=[2, 0, 0]),
            "duplicate id": lambda m: m["modules"].append(copy.deepcopy(m["modules"][0])),
            "duplicate socket": lambda m: m["modules"][0]["sockets"].append(copy.deepcopy(m["modules"][0]["sockets"][0])),
            "footprint": lambda m: m["modules"][0].update(footprint={"w": 0, "d": 1, "h": 1}),
            "atlas": lambda m: m.update(atlas={"file": "a.bmp", "size": 1, "tiles": {}}),
        }
        for needle, mutate in cases.items():
            m = copy.deepcopy(good)
            mutate(m)
            errors = " | ".join(mf.validate_manifest(m))
            self.assertIn(needle, errors, needle)
        self.assertEqual(mf.validate_manifest([]), ["manifest must be an object"])

    def test_merge_keeps_modules_not_rebuilt(self):
        entry = mf.module_entry(self.cube, self.results)
        other = dict(entry, id="wall.plain", file="wall.plain.glb")
        old = mf.build_manifest("european", [other, entry], {"file": "atlas.png", "size": 512, "tiles": {}})
        fresh = mf.build_manifest("european", [dict(entry, tris=[20, 20, 20])])
        merged = mf.merge_manifest(old, fresh)
        self.assertEqual([e["id"] for e in merged["modules"]], ["test.cube", "wall.plain"])
        self.assertEqual(merged["modules"][0]["tris"], [20, 20, 20])
        self.assertEqual(merged["atlas"]["file"], "atlas.png")
        self.assertIs(mf.merge_manifest(dict(old, style="japanese"), fresh), fresh)
        self.assertIs(mf.merge_manifest(None, fresh), fresh)

    def test_budget(self):
        self.assertEqual(mf.budget_errors(self.cube, [12, 600]), [])
        self.assertEqual(len(mf.budget_errors(self.cube, [11, 601, 100])), 2)


class CliTest(unittest.TestCase):
    def test_script_args(self):
        self.assertEqual(cli.script_args(["blender", "--background", "--python", "b.py", "--", "--style", "europe"]), ["--style", "europe"])
        self.assertEqual(cli.script_args(["blender"]), [])

    def test_plan(self):
        ns = cli.parse_args(["--style", "europe", "--out", "packages/client/public/assets/kits", "--modules", "test.cube"])
        plan = cli.make_plan(ns, root=REPO)
        self.assertEqual(plan.out_dir, os.path.join(REPO, "packages", "client", "public", "assets", "kits", "european"))
        self.assertEqual([m.id for m in plan.modules], ["test.cube"])
        self.assertTrue(plan.manifest_path.endswith("kit-manifest.json"))
        self.assertIn("test.cube", plan.describe())
        full = cli.make_plan(cli.parse_args([]), root=REPO)
        self.assertEqual(len(full.modules), 22)
        self.assertEqual(full.contact_sheet, "")
        empty = cli.BuildPlan(style=get_style("european"), out_dir="kits", modules=[])
        self.assertIn("no modules", empty.describe())
        sheet = cli.make_plan(cli.parse_args(["--contact-sheet", "docs/x.png"]), root=REPO)
        self.assertEqual(sheet.contact_sheet, os.path.join(REPO, "docs", "x.png"))
        self.assertIn("contact sheet", sheet.describe())

    def test_versions(self):
        self.assertTrue(cli.version_ok((5, 2, 3)))
        self.assertTrue(cli.version_ok((4, 2, 0)))
        self.assertFalse(cli.version_ok((4, 1, 9)))

    def test_build_dry_run_without_blender(self):
        import contextlib
        import io

        import build  # tools/blender/build.py

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(build.main(["build.py", "--", "--dry-run", "--modules", "test.cube"]), 0)
            self.assertEqual(build.main(["build.py", "--", "--style", "japanese", "--dry-run"]), 2)
        self.assertIn("test.cube.glb", out.getvalue())
        self.assertIn("M34", out.getvalue())


class SharedSyncTest(unittest.TestCase):
    """The Python generator and packages/shared must agree on ids and constants."""

    def test_style_ids(self):
        src = read("packages", "shared", "src", "data", "styles.ts")
        ids = re.search(r"STYLE_IDS = \[([^\]]*)\]", src).group(1)
        self.assertEqual(tuple(re.findall(r'"([a-z]+)"', ids)), STYLE_IDS)

    def test_grid_and_manifest_constants(self):
        src = read("packages", "shared", "src", "assets", "kit.ts")

        def const(name):
            return float(re.search(rf"export const {name} = ([0-9.]+);", src).group(1))

        self.assertEqual(const("CELL_M"), grid.CELL_M)
        self.assertEqual(const("STOREY_M"), grid.STOREY_M)
        self.assertEqual(const("KIT_MANIFEST_VERSION"), mf.MANIFEST_VERSION)
        self.assertIn(f'"{mf.MANIFEST_FILE}"', src)
        kinds = re.search(r"SOCKET_KINDS = \[([^\]]*)\]", src).group(1)
        from hvkit.module import SOCKET_KINDS

        self.assertEqual(tuple(re.findall(r'"([a-z]+)"', kinds)), SOCKET_KINDS)


if __name__ == "__main__":
    unittest.main()
