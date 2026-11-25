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

# Render the contact sheet (every module and variant, labelled) instead of exporting:
npm run assets:contact-sheet                       # docs/art/european-kit-contact-sheet.png
npm run assets:contact-sheet -- --style common     # docs/art/common-kit-contact-sheet.png
#   = npm run assets:build -- --no-optimize --contact-sheet auto [--style ...]

# Print the plan without Blender:
python tools/blender/build.py -- --style europe --include-tests --dry-run
```

`build.py` options: `--style` (`european`, or the alias `europe`; `common` for the
style-neutral kit), `--out` (kits root; the kit goes to `<out>/<style>/`), `--modules`, `--include-tests`, `--seed`, `--strict` (fail on
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
  tags[]}`. `tris` has one count per variant. The client validates it with
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
  europe/             M05 kit: common.py, walls.py, roofs.py, attachments.py, props.py
  common/             M06 style-neutral kit: base.py, ground.py, water.py, vegetation.py, props.py
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
