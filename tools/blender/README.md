# Blender kit generator

Headless Blender Python (`bpy`) scripts that generate the modular style kits (GDD §7.2): one
GLB per semantic module plus `kit-manifest.json`, written to
`packages/client/public/assets/kits/{style}/`.

## Requirements

- **Blender 5.2 LTS** (target; 5.2.1 was used to generate the committed test fixture).
  Blender 4.2 or later should work, because the export helper drops glTF options the running
  exporter does not know, but only 5.2 is checked.
- Node 26.13+ and `npm ci` (for `npm run assets:build` and the optimize step).
- Optional: [KTX-Software](https://github.com/KhronosGroup/KTX-Software) (`toktx`, or `ktx`
  4.3+) on PATH for KTX2 textures. Without it, textures fall back to WebP.
- Optional: Python 3.11+ on PATH to run the pure-Python unit tests without Blender.

`npm run assets:build` looks for Blender in this order: `$BLENDER` (when set, it is the only
candidate), `blender` on PATH, then the default install folders
(`C:\Program Files\Blender Foundation\Blender *\blender.exe`,
`/Applications/Blender.app`). Asset generation is **not** part of `npm run build`.

## Running

```bash
# Build the europe kit (every non-test module), then optimize it:
npm run assets:build -- --style europe

# Only some modules (ids or prefix globs). Test modules are built only when named:
npm run assets:build -- --modules test.cube
npm run assets:build -- --modules "wall.*,roof.gable"

# Straight Blender, as in the build plan (no optimize step):
blender --background --factory-startup --python-exit-code 1 \
  --python tools/blender/build.py -- --style europe --out packages/client/public/assets/kits

# The style-neutral kit (terrain, river, vegetation, props) into kits/common/:
npm run assets:build -- --style common

# The interior and furniture kit (room panels, furniture, shop interiors) into kits/interior/:
npm run assets:build -- --style interior

# Render the contact sheet (every module and variant, labelled) instead of exporting:
npm run assets:contact-sheet                       # docs/art/european-kit-contact-sheet.png
npm run assets:contact-sheet -- --style common     # docs/art/common-kit-contact-sheet.png
npm run assets:contact-sheet -- --style interior   # docs/art/interior-kit-contact-sheet.png
#   = npm run assets:build -- --no-optimize --contact-sheet auto [--style ...]

# Print the plan without Blender:
python tools/blender/build.py -- --style europe --include-tests --dry-run
```

`build.py` options: `--style` (`european`, or the alias `europe`; `mediterranean` (`med`); `arabic` (`arab`); `japanese` (`jp`); `common` for the
style-neutral kit; `interior` for the interior and furniture kit), `--out` (kits root; the kit goes to `<out>/<style>/`), `--modules`, `--include-tests`, `--seed`, `--strict` (fail on
budget or bounds problems), `--no-atlas`, `--dry-run`, `--contact-sheet PNG` (render the
selected modules to a PNG with EEVEE instead of exporting; `hvkit/blender/contact.py`). The npm wrapper adds `--no-optimize`.

Partial builds (`--modules`) merge into an existing `kit-manifest.json` and keep the other
modules. Output is deterministic: the same seed gives byte-identical GLBs and atlas.

## Optimizing

`npm run assets:optimize [-- <kit dirs or kits root>] [--textures auto|ktx2|webp|none] [--keep-png]`
runs `tools/optimize-assets.mjs` (glTF Transform): `dedup`, `prune` (keeps UVs; the atlas is
bound at runtime), meshopt compression (`EXT_meshopt_compression` with quantization), and
KTX2 or WebP for textures. The shared `atlas.png` becomes `atlas.ktx2` or `atlas.webp` and
the manifest is updated. `assets:build` runs it on the kits it just wrote.

## Conventions

- **Grid**: 1 m cells, 3 m storeys (`hvkit/grid.py`, mirrored in
  `packages/shared/src/assets/kit.ts`).
- **Pivot**: bottom-left-front corner. Modules are authored in Blender space (Z up, the
  front faces -Y), so a `w x d` module occupies `x in [0, w]`, `y in [0, d]`, `z >= 0`. The
  exporter converts to glTF Y-up: `x in [0, w]`, `y >= 0`, `z in [-d, 0]`, front at `z = 0`
  facing +Z. Everything in the manifest is glTF space.
- **GLB layout**: one top-level empty per variant, named `v0`, `v1`, ..., with extras
  `{hv_module, hv_variant, hv_style}` (three.js `userData`); its children are the variant's
  meshes. All variants share the pivot.
- **Materials**: vertex colours (`COLOR_0`, linear) multiplied by one tiling atlas per
  style. The atlas is not embedded in the GLBs; each kit has one `atlas.*` file and the
  manifest lists the UV rect of every tile. Atlas materials carry `hv_atlas: true` in their
  extras. Base colour factor is white, roughness 0.9, no metal.
- **Atlas**: `hvkit/atlas.py` paints seamless, low-contrast detail tiles (plaster, planks,
  tiles, bricks, cobble) in pure Python. Preview one without Blender:
  `cd tools/blender && python -m hvkit.atlas --style europe atlas.png`.
- **Hand-made look**: shapes get rounded bevels, a small per-vertex brightness jitter, and
  a positional noise that never moves vertices on the footprint box, so modules still meet.
- **Manifest** (`kit-manifest.json`): `{version, generator, style, grid, atlas, modules[]}`,
  each module `{id, file, footprint {w, d, h}, variants, bounds {min, max}, sockets[], tris[],
  tags[], placement?}`. Furniture (M08) adds `placement {cell: 0.5, w, d, mount, againstWall}`. `tris` has one count per variant. The client validates it with
  `KitManifestSchema` from `@hellovalley/shared`.

## Europe kit (M05)

`hvmodules/europe/` generates the Central & Northern European kit into
`packages/client/public/assets/kits/european/` (committed, about 0.9 MB optimized). 22 modules,
3 seeded variants each:

| Group | Modules | Footprint | Budget (tris/variant) |
|---|---|---|---|
| Walls | `wall.plain`, `wall.window`, `wall.door`, `wall.shopfront`, `wall.timber` | 1 x 1, 3 m | 150-600 |
| Corners | `corner.outer` (L, rotate for each corner), `corner.inner` (fills the concave corner) | 1 x 1, 3 m | 150-600 |
| Roofs | `roof.gable`, `roof.hip`, `roof.stepped_gable` | 2 x 2 | <= 2000 |
| Roof parts | `dormer`, `chimney` | 1 x 1 | <= 2000 |
| Attachments | `balcony`, `awning`, `flowerbox`, `shutters`, `sign.hanging` | 1 x 1 (cell in front of the wall) | <= 2000 |
| Props | `stair`, `fence`, `lamp`, `bench` (2 x 1), `tile.cobble` | 1 x 1 | <= 2000 (`tile.*` <= 400) |

Placement conventions (details in `hvmodules/europe/common.py`):

- **Walls** have their facade on the footprint front (y = 0) and are 0.2 m thick; trims stand
  up to 0.1 m proud. Edges on the x and z footprint planes are never bevelled, so walls tile
  and stack without grooves. Every wall has `top`, `left`, `right` and `facade` sockets.
- **Attachments** live in the cell in front of a wall, in the wall's storey frame: their back
  plane (y = 1) is the wall face. Their `mount` socket (0.5, 1, 0) mates with the wall's
  `facade` socket, and `fits:<wall id>` tags say which openings they are sized for. Opening
  sizes are fixed per module so any shutters fit any `wall.window` variant.
- **Plaster swatch per variant**: every wall-like module except `wall.timber` uses the same
  plaster swatch for the same variant index (`WALL_SWATCH_BY_VARIANT`), so a building recipe
  that picks one variant for all its walls gets one coherent facade colour (M10).
- **Roofs** cover a 2 x 2 building and sit on the wall tops; the M10 assembler scales them to
  other footprints. `chimney`, `dormer` and `ridge` sockets give roof-part positions.
- Materials: `atlas` (vertex colour x atlas), `glass` (window panes, extras `hv_glass`) and
  `glow` (lamp lanterns, emissive, extras `hv_glow`).

Budgets live in `packages/shared/src/assets/budgets.ts` (`kitTriBudget`,
`kitCompletenessProblems`) and `hvkit/budgets.py`. The client test
`packages/client/src/assets/europeKit.test.ts` validates the committed manifest, the budgets
and every GLB; `tools/blender/tests/test_europe.py` checks the module definitions and that
the committed manifest is up to date. The contact sheet is
`docs/art/european-kit-contact-sheet.png`.

## Mediterranean kit (M32)

`hvmodules/mediterranean/` generates the Mediterranean kit into
`packages/client/public/assets/kits/mediterranean/` (committed, about 1.2 MB optimized; contact
sheet `docs/art/mediterranean-kit-contact-sheet.png`):

```bash
npm run assets:build -- --style mediterranean --strict
npm run assets:contact-sheet -- --style mediterranean
```

- **Same modules as the European kit**: all 22 building module ids. The `mirror` decorator
  (`hvmodules/mediterranean/common.py`) copies each European module's footprint, sockets,
  variant count, budget, overhang and `fits:` tags, so every building recipe assembles with
  identical placements and doors (`packages/shared/src/buildings/buildings.test.ts`). The module
  registry keys modules by id *and* kit: `get_module(id, style)`; without a style it returns the
  first one registered (European). `hvmodules` imports `mediterranean` after `europe`.
- **Look** (GDD §7.3, art.md §2.2): whitewash, ochre and apricot stucco (one swatch per variant,
  `WALL_SWATCH_BY_VARIANT`), a painted zocalo (blue, stone or terracotta), white band, tile
  (tejaroz) or sandstone cornices; arched doors, arched or barred (reja) windows and arched
  shopfronts inside the European openings (`solids.arc_points`, `arched_profile`,
  `arch_spandrels`, `arch_ring`); blue, sage and teal shutters; terracotta pots instead of window
  boxes; wrought-iron balconies (one with bougainvillea); striped or cane awnings; painted-tile
  signs and benches. `wall.timber` is the kit's rustic wall: worn stucco over rubble, beam ends
  (vigas) or ashlar. `roof.stepped_gable` holds the curved Baroque gable, the bell gable
  (espadana) and a low stepped parapet.
- **Low roofs** (25 degrees) with canal tiles: half-buried tubes from eave to ridge, barrel ridge
  and hip tiles. They keep the European `chimney`/`dormer` sockets, which sit higher than this
  roof, so `chimney` and `dormer` reach below their pivots (`sink_m` 1.3 m and 0.4 m) into the
  attic; a test checks that covers the largest roof scale of any recipe with a chimney or dormer.
- **Style-only extras** (`MED_EXTRA_IDS`, `KIT_STYLE_EXTRA_MODULE_IDS` in shared): `pergola`
  (2 x 2, vine/bougainvillea/jasmine), `bougainvillea` (climber, budget class `plant`),
  `pot.terracotta`, `tree.lemon`. Pergola, bougainvillea and lemon tree have a `trunk` mesh and a
  swaying `canopy` (M06 conventions). Olive and cypress trees stay in the common kit. Recipes never
  use the extras; the town places them through the per-style dressing (M34, see below).

Checks: `tools/blender/tests/test_mediterranean.py` (twins, extras, budgets, swatches, gable
clearance, chimney/dormer reach, arch solids, the committed manifest),
`packages/client/src/assets/mediterraneanKit.test.ts` (manifest, budgets, GLBs, canopies, mirror of
the European footprints and sockets), `packages/client/src/scene/buildingMeshes.test.ts` (every
recipe built from the Mediterranean GLBs) and `packages/shared/src/world/town.test.ts` (street
furniture inside the shared blockers).

## Arabic kit (M33)

`hvmodules/arabic/` generates the Arabic kit into `packages/client/public/assets/kits/arabic/`
(committed, about 1.2 MB optimized; contact sheet `docs/art/arabic-kit-contact-sheet.png`):

```bash
npm run assets:build -- --style arabic --strict
npm run assets:contact-sheet -- --style arabic
```

- **Same modules as the European kit**: all 22 building module ids, mirrored like the
  Mediterranean kit (`mirror` in `hvmodules/arabic/common.py`: footprint, sockets, variants,
  budget, overhang, `fits:` tags), so every recipe assembles with identical placements and doors.
  `hvmodules` imports `arabic` after `europe`.
- **Look** (GDD §7.3, art.md §2.3): sand, rose and lime-white plaster (`WALL_SWATCH_BY_VARIANT`)
  over a zellige, lime or stone dado; horseshoe arches inside the European openings
  (`solids.horseshoe_dims`, `horseshoe_arc`, `horseshoe_profile`, `horseshoe_fillers`), an ajimez
  (twin arches on a colonnette), alfiz frames, studded cedar doors, mashrabiya screens
  (`common.lattice`) on windows, shutters, balconies (an enclosed oriel) and shop transoms;
  zellige stars, strips and paving (`solids.star_polygon`, `regular_polygon`); brass lanterns
  with `glow` cores (`props.lantern`); souk goods (spice cones, brass lamps, rugs). `wall.timber`
  is the kit's textured wall: ablaq stripes, an earth (ksar) wall with palm beams, or a sebka
  lozenge panel.
- **Flat roofs**: every roof is a deck at `DECK_Z` inside a parapet flush with the facades, with
  stepped, rounded or saw-tooth merlons (`roofs.merlon`, `common.merlon_positions`) and
  waterspouts. `roof.hip` is a dome on a drum, a green glazed tile pyramid or an onion dome
  (`solids.dome_rings`); `roof.stepped_gable` (the town hall) is a gate crest, a great dome with
  corner kiosks, or a corner minaret. The assembler scales roofs non-uniformly, so parapets and
  domes stretch with the building (heights are kept low). The European `chimney`/`dormer`
  sockets float above the deck, so `chimney` (wind catcher, domed stack, clay pots) and `dormer`
  (a rooftop kiosk) reach below their pivots (`sink_m` 2.0 m and 0.65 m); a test checks the
  reach for every recipe, and that the `roof.hip` dome clears the library's chimney.
- **Style-only extras** (`ARAB_EXTRA_IDS`, `KIT_STYLE_EXTRA_MODULE_IDS.arabic` in shared):
  `arcade` (2 x 1, two horseshoe arches on columns), `fountain.courtyard` (octagonal, star or
  round zellige basin with a `water` part; the common `fountain`'s footprint, sockets and walking
  blocker), `lantern.brass` (standing lantern with a `light` socket), `tree.date_palm` (`trunk` +
  swaying `canopy`). Recipes never use them; the town places them through the per-style dressing
  (M34, see below).

Checks: `tools/blender/tests/test_arabic.py`, `packages/client/src/assets/arabicKit.test.ts`,
`packages/client/src/scene/buildingMeshes.test.ts` (every recipe built from the Arabic GLBs),
`packages/shared/src/buildings/buildings.test.ts` and `packages/shared/src/world/town.test.ts`.

## Japanese kit (M34)

`hvmodules/japanese/` generates the Japanese kit into `packages/client/public/assets/kits/japanese/`
(committed, about 1.2 MB optimized; contact sheet `docs/art/japanese-kit-contact-sheet.png`):

```bash
npm run assets:build -- --style japanese --strict
npm run assets:contact-sheet -- --style japanese
```

- **Same modules as the European kit**: all 22 building module ids, mirrored like the other kits
  (`mirror` in `hvmodules/japanese/common.py`: footprint, sockets, variants, budget, overhang,
  `fits:` tags), so every recipe assembles with identical placements and doors.
- **Look** (GDD §7.3, art.md §2.4): white lime, earth or pale plaster (`WALL_SWATCH_BY_VARIANT`)
  between dark posts (half a post at each side of a cell, so neighbours share one), a tie beam
  (nageshi) and a wall-plate beam; a base of dark boards, namako tiles or stone. Shoji (paper in
  the `glass` slot, so it glows at night with the windows) behind kumiko or koshi lattices, sliding
  lattice, shoji and plank doors, noren curtains, round and barred windows, machiya shopfronts.
  `wall.timber` is the textured wall: an exposed frame (shinkabe), charred cedar (yakisugi) or
  clapboards. Attachments: a wooden veranda (engawa manner), a tiled, copper or reed-blind pent
  roof (hisashi), bonsai/morning glories/ikebana, lattice screens/sudare/storm boards, a wooden
  kanban. Props: granite/wooden/natural steps, bamboo fences (yotsume, misu, kenninji), andon,
  chochin and bronze lamps, a tea bench under red felt, gravel and stepping-stone paving.
- **Curved kawara roofs**: the slab follows `common.roof_under` (concave: 32 degrees on average,
  flatter at the 0.4 m eave, steeper at the ridge) under rows of round tiles, a heavy ridge with
  onigawara and barge boards with a gegyo. `roof.hip` is an irimoya, a yosemune or a hogyo pyramid
  (`roofs.curved_hip`, rings with upturned eave corners); `roof.stepped_gable` (the town hall uses
  variant 1) is a great gable with shachihoko, a two-tier keep-like roof, or a gable with chidori
  gables. The European `chimney`/`dormer` sockets lie above this roof, so the chimney (a roofed
  smoke vent) and the dormer reach below their pivots (`sink_m` 1.2 m and 0.45 m); a test checks
  the reach for every recipe.
- **Style-only extras** (`JAP_EXTRA_IDS`, `KIT_STYLE_EXTRA_MODULE_IDS.japanese` in shared):
  `lantern.stone` (kasuga, yukimi or oki lantern with a `glow` fire box and a `light` socket),
  `bridge.wooden` (an arched taikobashi with the common `bridge.stone`'s footprint, sockets, sink and
  `deck_z` heights), `tree.pine` (cloud-pruned black pine) and `tree.maple` (autumn momiji), both
  `trunk` + swaying `canopy`. The cherry is the common kit's `tree.sakura`; bamboo fences are the
  kit's `fence`.

Checks: `tools/blender/tests/test_japanese.py`, `packages/client/src/assets/japaneseKit.test.ts`,
`packages/client/src/scene/buildingMeshes.test.ts` (every recipe built from the Japanese GLBs),
`packages/shared/src/buildings/buildings.test.ts` and `packages/shared/src/world/town.test.ts`.

## Per-style town dressing (M34)

The style-only extras of every kit are placed by data in `packages/shared/src/world/dressing.ts`,
not by recipes: per style, neutral layout props swap to styled modules (`STYLE_TOWN_DRESSING`:
broadleaf trees become cherries and maples in Japan, olives and lemons on the Mediterranean, date
palms in the Arabic town; conifers become pines; the stone bridge becomes the wooden one; the
square's fountain becomes the courtyard fountain), and layout entries can be limited to some
styles (`TownProp.styles`: the pergola, the bougainvillea, the arcade). Walking stays the same for
everyone: a placement blocks the union of its fills (`TOWN_PROPS` defines each module's blocker and
`packages/shared/src/world/town.test.ts` checks them against these manifests).

## Common kit (M06)

Style-neutral modules live in their own kit, `kits/common/` (kit id `common`, `COMMON_KIT_ID`
in `packages/shared/src/assets/kit.ts`), with a neutral palette and atlas (grass, dirt, sand,
cobble, bark, leaves...). The client loads it next to the player's style kit; modules declare
`styles = ("common",)`. `hvmodules/common/` generates 36 modules, 3 variants each (about
1.9 MB optimized, committed):

| Group | Modules | Footprint | Budget (tris/variant) |
|---|---|---|---|
| Terrain | `terrain.grass`, `.path`, `.cobble`, `.sand`; `terrain.{path,cobble,sand}.{edge,outer,inner}` | 1 x 1 | <= 400 |
| River | `bank.straight`, `bank.outer`, `bank.inner`, `bank.water` (1 x 1), `bank.curve_outer`, `bank.curve_inner` (2 x 2) | | <= 2000 |
| Water props | `bridge.stone` (2 x 4), `dock.fishing` (2 x 3), `fountain` (2 x 2) | | <= 2000 |
| Vegetation | `tree.deciduous`, `.conifer`, `.cypress` (1 x 1), `.palm`, `.sakura`, `.olive`; `bush`, `flowers` | 2 x 2 | <= 1000 |
| Props | `rock`, `crate`, `barrel`, `basket` (1 x 1), `notice_board` (2 x 1), `market_stall` (2 x 2) | | <= 2000 |

Conventions (details in `hvmodules/common/base.py`):

- **Ground**: terrain tiles are slabs on the pivot plane; grass tops out at 0.1 m, path and
  sand slightly lower. Edge pieces are marching squares: every transition crosses a cell side
  at its midpoint. `edge` has the feature (path, cobble, sand, or water for banks) on the
  front half, `outer` only in a quarter disc at the front-left corner, `inner` everywhere but
  a quarter disc of grass/land at the back-right corner. Rotate in 90-degree steps.
- **River**: pieces dig below the pivot (`Module.sink_m`, 0.5 m): bed at -0.45 m, water
  surface at -0.15 m. Banks are height fields with one shared resolution so neighbours share
  seam vertices (a test checks every seam profile). Water surfaces are separate meshes
  (`hv_part: water`, material extras `hv_water`) for the river shader (TODO(M12)).
- **Canopies**: trees build a `trunk` mesh and a `canopy` mesh (node extras `hv_part`), the
  canopy with the `canopy` material (extras `hv_atlas` + `hv_canopy`) and its node origin at
  the top of the trunk, the sway pivot. `Module.canopy`/`trunk` make the runner check this on
  every build (`Module.part_errors`, a `--strict` failure); `packages/client/src/assets/commonKit.test.ts`
  checks the committed GLBs. Bushes and flowers are canopy-only.
- `MeshBuilder` gained `tube` and `leaf` solids (branches, palm fronds), per-vertex colours
  for height fields, `blob(smooth=False, flatten_below=...)` and `to_object(part=, origin=)`.

The contact sheet is `docs/art/common-kit-contact-sheet.png`; `tools/blender/tests/test_common.py`
checks the definitions and that the committed manifest is up to date.

## Interior kit (M08)

Interiors live in their own kit, `kits/interior/` (kit id `interior`, `INTERIOR_KIT_ID` in
`packages/shared/src/assets/kit.ts`), with a warm indoor palette and atlas (floorboards, tiles,
brick, fabric, straw...). Interiors are style-neutral: every town style uses this kit. Modules
declare `styles = ("interior",)`. `hvmodules/interior/` generates 28 modules, 3 variants each
(about 1.5 MB optimized, committed):

| Group | Modules | Size | Budget (tris/variant) |
|---|---|---|---|
| Room floors | `floor.wood`, `floor.tile`, `floor.stone` | 1 x 1 cell | <= 400 |
| Room walls | `iwall.plain`, `iwall.window`, `iwall.door` | 1 x 1 cell, 3 m | 150-600 |
| Apartment | `bed` (1 x 2 m), `table` (1 x 1), `chair` (0.5 x 0.5), `sofa` (1.5 x 1), `wardrobe` (1 x 0.5), `mirror` (wall, 0.5), `kitchen.nook` (1.5 x 0.5, sink and stove), `shelf` (1 x 0.5), `plant.potted` (0.5 x 0.5), `rug` (1.5 x 1.5), `lamp.floor` (0.5 x 0.5), `lamp.table` (surface, 0.5 x 0.5), `painting` (wall, 1 m) | placement grid | <= 2000 |
| Shops | `bakery.counter` (2 x 1), `bakery.oven` (1.5 x 1), `store.shelf` (2 x 0.5), `cafe.bar` (2 x 1), `clinic.desk` (1.5 x 1), `library.shelf` (1 x 0.5), `townhall.desk` (2 x 1), `barn.stall` (1.5 x 1.5), `barn.hay` (1 x 0.5) | placement grid | <= 2000 |

Conventions (details in `hvmodules/interior/base.py`):

- **Floor level** is the pivot plane. Floor panels are slabs from -0.06 m (`Module.sink_m`) to 0.
- **Room walls** stand at the *back* of their cell: the panel fills `y in [0.9, 1]` (0.1 m thick)
  and its room face (`y = 0.9`, socket `face`) looks towards -Y, the camera side. Line a room by
  placing panels along its back and side edges, rotated in 90-degree steps (the M13 rooms put
  the slabs just outside the floor, `shared/src/world/interiors.ts`); the cut-away lowers the
  walls facing the camera to a stub (client `scene/Interior.tsx`). Opening sizes are fixed per
  module (window `x 0.2-0.8, z 1.0-2.2`, door `x 0.2-0.8, z 0-2.2`).
- **Furniture** sets `Module.placement` (`hvkit.grid.Placement`): `w x d` cells of
  `PLACEMENT_CELL_M = 0.5` m (GDD §4.2), a `mount` and `against_wall`. The 1 m footprint is
  derived from it, the bounds check uses the placement box, and the manifest gets
  `placement {cell, w, d, mount, againstWall}` (zod: `KitPlacementSchema`). Mounts: `floor`
  (blocks its cells), `rug` (walkable, floor pieces may stand on it), `wall` (hangs on a wall;
  its back plane `y = depth` is the wall face) and `surface` (stands on another piece's `top`
  socket). The front of a piece is `y = 0`; `againstWall` pieces put their back edge on a
  wall. Rotation turns the footprint (`rotatedPlacementCells`); the placement mode itself is
  TODO(M17).
- **Sockets**: every floor and wall piece has `use` (front edge, floor level, facing -Y), seats
  `sit`/`sit_l`/`sit_r` at seat height (0.45 m, facing the way the sitter looks), the bed
  `sleep`, tables and shelves `top`, lamps `light`, the kitchen `cook` and `sink`, and shop
  counters `vendor` (behind the counter, where the NPC stands) and `counter` (front edge at
  counter height, where the player trades).
- **Furniture items** (`wooden_chair`, `small_table`, `floor_lamp`, `round_rug`, `potted_plant`,
  `bookshelf`) map to a module and variant in `FURNITURE_ITEM_LOOKS`
  (`packages/shared/src/assets/interior.ts`).
- Materials: `atlas`, `glass` (mirrors, windows, display glass) and `glow` (lamp bulbs, the oven
  fire, stove rings).

Checks: `tools/blender/tests/test_interior.py` (placement maths and JSON, definitions, sockets,
the TS mirrors, the committed manifest) and `packages/client/src/assets/interiorKit.test.ts`
(manifest, budgets, placement on every furniture piece, bounds and sockets inside the placement
box, every GLB). The contact sheet is `docs/art/interior-kit-contact-sheet.png`.

## Characters (M07)

`--characters` builds the player/NPC character set (GDD §3) instead of a kit, into
`packages/client/public/assets/characters/` (committed, about 0.6 MB optimized):

```bash
npm run assets:build -- --characters            # build + optimize (add --strict to fail on problems)
npm run assets:contact-sheet -- --characters    # docs/art/characters-contact-sheet.png
```

| File | Contents |
|---|---|
| `body.glb` | The skinned chibi body (~2.4 heads, 1.18 m to the skull top), the shared 17-bone armature, one empty per body socket and the 14 clips: idle, walk, run, sit, talk, wave, fish_cast, fish_reel, eat, cheer, laugh, heart, think, clap (24 fps; fish_cast and heart are one-shots). |
| `animal.<id>.glb` × 16 | Root `animal_<id>`; children `head` (holds the head sockets), `tail` and optional parts (rabbit `ears_floppy`, cat `tabby`, capybara `orange`, penguin `flipper_l/_r`, deer `antlers`). |
| `outfit.<npc>.glb` × 9 | Root `outfit_<npc>`; one child per piece (apron, sash, glasses, straw hat, boots...). |
| `character-manifest.json` | Bones, sockets, slots, clip durations and loop flags, parts with their sockets, defaults and triangle counts. Validated by `CharacterManifestSchema` in `packages/shared/src/assets/characters.ts`. |

Conventions (pure Python in `hvkit/character.py`, definitions in `hvchars/`):

- **Sockets**: body sockets `head`, `neck`, `chest`, `hips`, `tail`, `hand_l/_r`, `foot_l/_r` are
  empties named `socket_<name>` parented to bones (no dots: three.js strips them from names);
  every head adds `hat`, `face`, `ear_l`, `ear_r`. Every part node has extras `hv_part`,
  `hv_socket` and `hv_default`, and is authored relative to its socket: attach it as a child of
  the socket and keep its local transform (meshopt quantization moves geometry into it).
- **Material slots** (extras `hv_slot`, `hv_tint`): `fur`, `shirt`, `trousers` are tintable
  (white vertex colours with a little jitter; the client sets `material.color`); `eyes`,
  `markings` and `outfit` carry their colours in COLOR_0.
- **Skinning** is rigid: each soft primitive (`hvkit/charshapes.py` recipes, built by
  `hvkit/blender/charmesh.py`) follows one bone; the rounded joints overlap.
- **Clips** are keyed in `hvchars/animations.py` as Euler degrees about the armature axes
  (`hvkit/blender/rig.py` converts them to bone space), one action per clip on its own NLA
  track, exported with `export_animation_mode = NLA_TRACKS`.
- **Budgets**: body 500–3000 tris, one animal file 200–3000, one outfit file ≤ 1500
  (`CHARACTER_TRI_BUDGETS`). NPC looks (animal, fur tint, shirt, trousers) live in
  `look` in `packages/shared/src/data/npcs.ts`, mirrored by `NPC_LOOKS` in `hvchars/outfits.py`.
- **Determinism**: shapes are triangulated with fixed methods and get rounded custom normals,
  and the optimizer sorts triangles canonically, so a rebuild is byte-identical.

Checks: `tools/blender/tests/test_characters.py` (definitions, TS mirrors, the committed
manifest) and `packages/client/src/characters/characters.test.ts` (loads every GLB with
three.js, checks the 14 clips, sockets and slots, assembles every animal and NPC, tints them
and plays every clip). The dev gallery is `/dev/characters` (`npm run dev`, dev builds only).

## Layout

```
build.py              entry point (run inside Blender; --dry-run works in plain Python)
hvkit/                framework
  grid.py color.py variants.py atlas.py shaping.py styles.py module.py manifest.py cli.py
                      pure Python, no bpy (unit-tested)
  blender/            bpy-only: scene, materials, shapes (MeshBuilder), export, runner, contact
  solids.py contact.py  pure solids (prisms, panels with openings, hip roofs) and the
                      contact-sheet layout
hvmodules/            module definitions; importing the package registers them
  test_cube.py        test.cube (pipeline check)
hvchars/              M07 characters: body.py, animals.py, outfits.py, animations.py
  (framework side: hvkit/character.py, hvkit/charshapes.py, hvkit/blender/{charmesh,rig,characters}.py)
  europe/             M05 kit: common.py, walls.py, roofs.py, attachments.py, props.py
  common/             M06 style-neutral kit: base.py, ground.py, water.py, vegetation.py, props.py
  interior/           M08 interior kit: base.py, parts.py, room.py, furniture.py, shops.py
  mediterranean/      M32 kit: common.py, walls.py, roofs.py, attachments.py, props.py, plants.py
  arabic/             M33 kit: common.py, walls.py, roofs.py, attachments.py, props.py, extras.py
  japanese/           M34 kit: common.py, walls.py, roofs.py, attachments.py, props.py, extras.py
tests/                unittest suite for the pure-Python parts
```

## Writing a module

```python
from hvkit.grid import Footprint
from hvkit.module import Module, Socket, register

@register
class WallPlain(Module):
    id = "wall.plain"
    footprint = Footprint(w=1, d=1, h=3.0)
    sockets = (Socket("top", "stack", (0.5, 0.5, 3.0), (0, 0, 1)),)
    variants = 3
    styles = ("european",)          # None = style-neutral
    tri_budget = (150, 600)

    def variant_params(self, style, variant, rng):   # pure: seeded choices, unit-testable
        return {"swatch": rng.randint(0, len(style.palette["walls"]) - 1)}

    def build(self, ctx, variant, params, rng):      # Blender only
        b = ctx.builder(self, variant, rng)
        b.box((0, 0, 0), (1, ctx.style.wall_thickness_m, 3), ctx.paint("walls", params["swatch"]))
        return [b.to_object(ctx.collection)]
```

Import the new file from `hvmodules/__init__.py`. Helpers on `MeshBuilder`: `box` (optional
bevel and noise), `rounded_box`, `cylinder` (cones and frustums too), `blob` (soft lumps for
canopies and bushes), and `solid` for anything from `hvkit/solids.py` (`prism`, `beam`,
`grid_panel` for walls with openings, `hip_roof`). `box` and `solid` take `seams` (`"x"`,
`"x+"`, `"z-"`...): edges lying in those footprint planes stay sharp so neighbouring modules
join flush; only sharp edges are bevelled. `ctx.paint(group, index, tile, material)` picks a
palette swatch, atlas tile and material (`atlas`, `glass`, `glow`).

## Tests and fixtures

- `npm run test:blender` (or `npm test`, which runs it when Python 3 is on PATH) runs the
  pure-Python tests. A smoke test imports the `bpy` package against stand-in modules.
- `packages/client/test/fixtures/kits/european/` is the real Blender output for `test.cube`
  (`npm run assets:build -- --modules test.cube --out packages/client/test/fixtures/kits`).
  `kits-synthetic/` holds the same layout written without Blender
  (`npm run assets:fixtures`). The client loader test (`packages/client/src/assets/kitGlb.test.ts`)
  decodes both with three.js `GLTFLoader` + meshopt.
