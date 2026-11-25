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

# Print the plan without Blender:
python tools/blender/build.py -- --style europe --include-tests --dry-run
```

`build.py` options: `--style` (`european`, or the alias `europe`), `--out` (kits root; the kit
goes to `<out>/<style>/`), `--modules`, `--include-tests`, `--seed`, `--strict` (fail on
budget or bounds problems), `--no-atlas`, `--dry-run`. The npm wrapper adds `--no-optimize`.

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

## Layout

```
build.py              entry point (run inside Blender; --dry-run works in plain Python)
hvkit/                framework
  grid.py color.py variants.py atlas.py shaping.py styles.py module.py manifest.py cli.py
                      pure Python, no bpy (unit-tested)
  blender/            bpy-only: scene, materials, shapes (MeshBuilder), export, runner
hvmodules/            module definitions; importing the package registers them
  test_cube.py        test.cube (pipeline check)
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
canopies and bushes). `ctx.paint(group, index, tile)` picks a palette swatch and atlas tile.

## Tests and fixtures

- `npm run test:blender` (or `npm test`, which runs it when Python 3 is on PATH) runs the
  pure-Python tests. A smoke test imports the `bpy` package against stand-in modules.
- `packages/client/test/fixtures/kits/european/` is the real Blender output for `test.cube`
  (`npm run assets:build -- --modules test.cube --out packages/client/test/fixtures/kits`).
  `kits-synthetic/` holds the same layout written without Blender
  (`npm run assets:fixtures`). The client loader test (`packages/client/src/assets/kitGlb.test.ts`)
  decodes both with three.js `GLTFLoader` + meshopt.
