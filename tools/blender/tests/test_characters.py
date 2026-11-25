"""Character generator (M07): rig, clips, animals, outfits and NPC looks, checked without
Blender and against the TypeScript mirrors and the committed manifest."""

import json
import math
import os
import re
import unittest

from hvchars import ANIMAL_IDS, NPC_LOOKS, OUTFIT_IDS, animal_parts, body_shapes, outfit_parts
from hvchars.animations import CLIPS, arm, get_clip, leg
from hvchars.outfits import FUR_HEX, FUR_TINT_IDS, SWATCH_HEX
from hvkit import character as ch
from hvkit import cli
from hvkit.charshapes import ShapeSet

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MANIFEST = os.path.join(REPO, "packages", "client", "public", "assets", "characters", ch.CHARACTER_MANIFEST_FILE)


def read(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
        return f.read()


def ts_list(src, name):
    body = re.search(rf"{name} = \[([^\]]*)\]", src).group(1)
    return re.findall(r'"([a-z_]+)"', body)


class RigTest(unittest.TestCase):
    def test_skeleton_is_a_tree_rooted_at_root(self):
        names = set(ch.BONE_NAMES)
        self.assertEqual(len(names), len(ch.BONES))
        for b in ch.BONES:
            self.assertTrue(b.parent is None or b.parent in names, b.name)
            self.assertGreater(math.dist(b.head, b.tail), 0.01, b.name)
        self.assertEqual([b.name for b in ch.BONES if b.parent is None], ["root"])
        for b in ch.BONES:  # left/right pairs mirror each other
            if b.name.endswith("_l"):
                r = ch.BONES_BY_NAME[b.name[:-2] + "_r"]
                self.assertEqual(r.head, (-b.head[0], b.head[1], b.head[2]))

    def test_sockets_sit_on_their_bones(self):
        for s in ch.BODY_SOCKETS:
            self.assertIn(s.bone, ch.BONE_NAMES, s.name)
            b = ch.BONES_BY_NAME[s.bone]
            self.assertLess(min(math.dist(s.pos, b.head), math.dist(s.pos, b.tail)), 0.16, s.name)

    def test_names_match_shared(self):
        src = read("packages", "shared", "src", "assets", "characters.ts")
        self.assertEqual(ts_list(src, "CHARACTER_ANIMATIONS"), list(ch.ANIMATION_NAMES))
        self.assertEqual(sorted(ts_list(src, "CHARACTER_BONES")), sorted(ch.BONE_NAMES))
        self.assertEqual(ts_list(src, "CHARACTER_BODY_SOCKETS"), list(ch.BODY_SOCKET_NAMES))
        self.assertEqual(ts_list(src, "CHARACTER_HEAD_SOCKETS"), list(ch.HEAD_SOCKET_NAMES))
        for slot, tint in ch.MATERIAL_SLOTS.items():
            self.assertRegex(src, rf"\b{slot}: {'true' if tint else 'false'},")
        for key, (lo, hi) in (("body", ch.BODY_TRI_BUDGET), ("animal", ch.ANIMAL_TRI_BUDGET), ("outfit", ch.OUTFIT_TRI_BUDGET)):
            self.assertIn(f"{key}: {{ min: {lo}, max: {hi} }}", src)
        self.assertIn(f'CHARACTER_SOCKET_PREFIX = "{ch.SOCKET_NODE_PREFIX}"', src)


class ClipTest(unittest.TestCase):
    def test_fourteen_valid_clips(self):
        self.assertEqual(tuple(c.name for c in CLIPS), ch.ANIMATION_NAMES)
        for c in CLIPS:
            self.assertEqual(c.errors(), [], c.name)
            self.assertGreaterEqual(len(c.keys), 2, c.name)
            for _, pose in c.keys:
                self.assertEqual(set(pose), set(ch.BONE_NAMES), c.name)  # every key sets every bone
                for bone, bp in pose.items():
                    self.assertTrue(all(abs(a) <= 180 for a in bp.rot), f"{c.name} {bone}")
                    if bone != "hips":
                        self.assertEqual(bp.loc, (0.0, 0.0, 0.0), f"{c.name} {bone}")
        one_shots = {c.name for c in CLIPS if not c.loop}
        self.assertEqual(one_shots, {"fish_cast", "heart"})

    def test_every_clip_moves(self):
        for c in CLIPS:
            poses = [p for _, p in c.keys]
            self.assertTrue(any(p != poses[0] for p in poses), c.name)

    def test_mirroring_helpers(self):
        left, right = arm("l", out=30.0, yaw=10.0, fwd=5.0), arm("r", out=30.0, yaw=10.0, fwd=5.0)
        self.assertEqual(left["upper_arm_l"].rot, (-5.0, -30.0, 10.0))
        self.assertEqual(right["upper_arm_r"].rot, (-5.0, 30.0, -10.0))
        self.assertEqual(leg("r", fwd=20.0, knee=10.0)["shin_r"].rot, (10.0, 0.0, 0.0))

    def test_sit_drops_onto_the_seat(self):
        hips = get_clip("sit").pose_at_key(0)["hips"]
        self.assertAlmostEqual(hips.loc[2], -0.13)
        self.assertGreater(ch.SIT_HEIGHT_M, 0)


class AnimalTest(unittest.TestCase):
    def test_animals_match_shared(self):
        src = read("packages", "shared", "src", "data", "animals.ts")
        self.assertEqual(list(ANIMAL_IDS), re.findall(r'^    id: "([a-z_]+)",', src, re.M))
        for animal, hexes in FUR_HEX.items():
            block = src.split(f'id: "{animal}"', 1)[1].split("furTints:", 1)[1].split("]", 1)[0]
            self.assertEqual(tuple(re.findall(r'hex: "(#[0-9a-f]{6})"', block)), hexes, animal)
            if animal in FUR_TINT_IDS:
                self.assertEqual(tuple(re.findall(r'id: "([a-z_]+)"', block)), FUR_TINT_IDS[animal], animal)

    def test_every_animal_has_a_head_with_sockets_and_budget(self):
        for animal in ANIMAL_IDS:
            build = animal_parts(animal)
            parts = {p.name: p for p in build.parts}
            self.assertIn("head", parts, animal)
            self.assertEqual(parts["head"].socket, "head")
            for slot in ch.HEAD_SLOTS:
                self.assertIn(slot, parts["head"].shapes.slots, animal)
            self.assertEqual(sorted(build.sockets), sorted(ch.HEAD_SOCKET_NAMES), animal)
            hat = build.sockets["hat"]
            self.assertGreater(hat[2], 0.35, animal)
            for p in build.parts:
                self.assertIn(p.socket, ch.BODY_SOCKET_NAMES, f"{animal} {p.name}")
                self.assertTrue(ch.NAME_RE.match(p.name), p.name)
            total = sum(p.shapes.estimated_tris() for p in build.parts)
            self.assertLessEqual(total, ch.ANIMAL_TRI_BUDGET[1], animal)

    def test_gdd_features(self):
        self.assertIn("tail", {p.name for p in animal_parts("fox").parts})
        self.assertFalse({p.name: p.default for p in animal_parts("rabbit").parts}["ears_floppy"])
        self.assertTrue({p.name: p.default for p in animal_parts("rabbit").parts}["ears_upright"])
        self.assertEqual({p.socket for p in animal_parts("penguin").parts if p.name.startswith("flipper")}, {"hand_l", "hand_r"})
        for animal, part in (("cat", "tabby"), ("capybara", "orange"), ("deer", "antlers")):
            self.assertIn(part, {p.name for p in animal_parts(animal).parts}, animal)

    def test_body_uses_the_clothing_slots_on_bones(self):
        body = body_shapes()
        self.assertEqual(sorted(body.slots), sorted(ch.BODY_SLOTS))
        self.assertTrue(all(s.bone in ch.BONE_NAMES for s in body.shapes))
        self.assertLessEqual(body.estimated_tris(), ch.BODY_TRI_BUDGET[1])
        feet = [s for s in body.shapes if s.bone and s.bone.startswith("foot")]
        self.assertTrue(all(abs(s.center[2] - s.radii[2]) < 1e-6 for s in feet))  # soles on the ground

    def test_tintable_slots_take_shades_only(self):
        s = ShapeSet("t")
        s.ellipsoid((0, 0, 0), 1.0, "fur", "~0.5")
        with self.assertRaises(ValueError):
            s.ellipsoid((0, 0, 0), 1.0, "shirt", "#ff0000")
        with self.assertRaises(ValueError):
            s.ellipsoid((0, 0, 0), 1.0, "skin")


class OutfitTest(unittest.TestCase):
    def test_looks_match_npcs_ts(self):
        src = read("packages", "shared", "src", "data", "npcs.ts")
        ids = ts_list(src, "NPC_IDS")
        self.assertEqual(list(OUTFIT_IDS), ids)
        self.assertEqual(list(NPC_LOOKS), ids)
        for npc, look in NPC_LOOKS.items():
            expected = f'look: {{ animal: "{look.animal}", furTint: "{look.fur_tint}", shirt: "{look.shirt}", trousers: "{look.trousers}" }}'
            self.assertIn(expected, src, npc)
        self.assertEqual(len({l.animal for l in NPC_LOOKS.values()}), len(NPC_LOOKS))

    def test_swatches_match_palette(self):
        src = read("packages", "shared", "src", "data", "palette.ts")
        self.assertEqual(dict(re.findall(r'\{ id: "([a-z]+)", hex: "(#[0-9a-f]{6})" \}', src)), SWATCH_HEX)

    def test_outfits_use_known_sockets_and_the_outfit_slot(self):
        signature = {"baker": "apron_bib", "mayor": "sash", "librarian": "glasses", "farmer": "straw_hat", "doctor": "stethoscope"}
        for npc in OUTFIT_IDS:
            parts = outfit_parts(npc)
            self.assertTrue(parts, npc)
            for p in parts:
                self.assertIn(p.socket, ch.BODY_SOCKET_NAMES + ch.HEAD_SOCKET_NAMES, f"{npc} {p.name}")
                self.assertEqual(p.shapes.slots, ["outfit"], f"{npc} {p.name}")
            self.assertLessEqual(sum(p.shapes.estimated_tris() for p in parts), ch.OUTFIT_TRI_BUDGET[1], npc)
            if npc in signature:
                self.assertIn(signature[npc], {p.name for p in parts}, npc)


class ManifestTest(unittest.TestCase):
    def test_validation_catches_problems(self):
        good = ch.build_manifest(
            1700,
            CLIPS,
            [ch.FileResult("fox", "animal.fox.glb", [ch.PartResult("head", "head", 900)], ch.HEAD_SOCKET_NAMES)],
            [ch.FileResult("baker", "outfit.baker.glb", [ch.PartResult("apron", "chest", 100)])],
        )
        self.assertEqual(ch.validate_manifest(good), [])
        self.assertTrue(ch.validate_manifest(good, animal_ids=("fox", "cat")))
        bad = json.loads(json.dumps(good))
        bad["outfits"][0]["parts"][0]["socket"] = "elbow"
        bad["body"]["tris"] = 99999
        bad["animations"].pop()
        errors = "\n".join(ch.validate_manifest(bad))
        self.assertIn("elbow", errors)
        self.assertIn("body: 99999", errors)
        self.assertIn("animations must be", errors)

    @unittest.skipUnless(os.path.exists(MANIFEST), "characters not generated")
    def test_committed_manifest_is_valid_and_current(self):
        with open(MANIFEST, encoding="utf-8") as f:
            m = json.load(f)
        self.assertEqual(ch.validate_manifest(m, ANIMAL_IDS, OUTFIT_IDS), [])
        self.assertEqual([(a["name"], a["loop"]) for a in m["animations"]], [(c.name, c.loop) for c in CLIPS])
        for a in m["animals"]:
            build = animal_parts(a["id"])
            self.assertEqual(sorted(p["name"] for p in a["parts"]), sorted(p.name for p in build.parts), a["id"])
        for o in m["outfits"]:
            self.assertEqual(sorted(p["name"] for p in o["parts"]), sorted(p.name for p in outfit_parts(o["id"])), o["id"])
        self.assertEqual([s["pos"] for s in m["body"]["sockets"]], [ch.gltf(s.pos) for s in ch.BODY_SOCKETS])

    def test_cli_character_plan(self):
        plan = cli.make_character_plan(cli.parse_args(["--characters"]))
        self.assertTrue(plan.out_dir.endswith(os.path.join("public", "assets", "characters")))
        plan = cli.make_character_plan(cli.parse_args(["--characters", "--out", "tmp/chars", "--contact-sheet", "x.png"]))
        self.assertTrue(plan.out_dir.endswith(os.path.join("tmp", "chars")))
        self.assertTrue(plan.contact_sheet.endswith("x.png"))
        self.assertIn("14 animations", plan.describe())


if __name__ == "__main__":
    unittest.main()
