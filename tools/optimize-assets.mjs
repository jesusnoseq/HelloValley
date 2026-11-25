#!/usr/bin/env node
// Optimizes generated kits for the web (GDD §7.2): meshopt geometry compression for every
// module GLB, and KTX2 textures (Basis Universal) with a WebP fallback.
//
//   node tools/optimize-assets.mjs [kit dirs or kits root...] [--textures auto|ktx2|webp|none]
//                                  [--keep-png]
//
// Default input: packages/client/public/assets/kits (every <style>/kit-manifest.json in it).
// A folder with character-manifest.json (M07: public/assets/characters) is optimized too: its
// GLBs keep their socket empties (empty leaf nodes) and their animations are resampled.
// KTX2 needs the KTX-Software CLI (`toktx`, or `ktx` from 4.3+) on PATH; without it `auto`
// falls back to WebP through sharp. The shared style atlas (manifest `atlas.file`) is
// converted the same way and the manifest is updated to point at the new file.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_KITS_DIR = join(ROOT, "packages", "client", "public", "assets", "kits");
export const MANIFEST_FILE = "kit-manifest.json";
export const CHARACTER_MANIFEST_FILE = "character-manifest.json";
export const DEFAULT_CHARACTERS_DIR = join(ROOT, "packages", "client", "public", "assets", "characters");

/** The manifest file in a folder: a kit manifest, a character manifest, or null. */
export function manifestFileIn(dir) {
  for (const file of [MANIFEST_FILE, CHARACTER_MANIFEST_FILE]) if (existsSync(join(dir, file))) return file;
  return null;
}

/** Every GLB a manifest lists: kit modules, or the character body, animals and outfits. */
export function manifestGlbFiles(manifest) {
  if (Array.isArray(manifest.modules)) return manifest.modules.map((m) => m.file);
  return [manifest.body?.file, ...(manifest.animals ?? []).map((a) => a.file), ...(manifest.outfits ?? []).map((o) => o.file)].filter(Boolean);
}

/** Returns the KTX-Software command available on PATH: "toktx", "ktx" or null. */
export function findKtxTool() {
  for (const cmd of ["toktx", "ktx"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: false });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

/** Resolves `auto` to a concrete texture mode for this machine. */
export function resolveTextureMode(mode, ktxTool = findKtxTool()) {
  if (mode === "auto") return ktxTool ? "ktx2" : "webp";
  if (mode === "ktx2" && !ktxTool) {
    throw new Error("--textures ktx2 needs the KTX-Software CLI (toktx or ktx) on PATH");
  }
  if (!["ktx2", "webp", "none"].includes(mode)) throw new Error(`unknown --textures mode ${mode}`);
  return mode;
}

/** Encodes PNG/JPEG bytes as a KTX2 (Basis Universal ETC1S, mipmapped, sRGB) file. */
export function encodeKtx2(imageBytes, ktxTool, inputExt = ".png") {
  const dir = mkdtempSync(join(tmpdir(), "hv-ktx-"));
  try {
    const input = join(dir, `in${inputExt}`);
    const output = join(dir, "out.ktx2");
    writeFileSync(input, imageBytes);
    const args =
      ktxTool === "toktx"
        ? ["--t2", "--encode", "etc1s", "--genmipmap", "--assign_oetf", "srgb", output, input]
        : ["create", "--format", "R8G8B8A8_SRGB", "--encode", "basis-lz", "--generate-mipmap", input, output];
    const r = spawnSync(ktxTool, args, { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      throw new Error(`${ktxTool} failed: ${r.error?.message ?? r.stderr ?? r.status}`);
    }
    return new Uint8Array(readFileSync(output));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new Error("WebP textures need the `sharp` devDependency (npm ci)");
  }
}

let ioPromise;
/** A NodeIO that can read and write every extension, including EXT_meshopt_compression. */
export function createIO() {
  ioPromise ??= (async () => {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  })();
  return ioPromise;
}

/** Sorts every primitive's triangles into a canonical order (each rotated to start at its
 * lowest index, winding kept). Blender's exporter can list the same triangles in a different
 * order from run to run; sorting first keeps the meshopt output byte-identical. */
export function sortTriangles(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (!indices || prim.getMode() !== 4) continue;
      const src = indices.getArray();
      const tris = [];
      for (let i = 0; i + 2 < src.length; i += 3) {
        const [a, b, c] = [src[i], src[i + 1], src[i + 2]];
        tris.push(a <= b && a <= c ? [a, b, c] : b <= a && b <= c ? [b, c, a] : [c, a, b]);
      }
      tris.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
      const out = new src.constructor(src.length);
      tris.forEach((t, i) => out.set(t, i * 3));
      indices.setArray(out);
    }
  }
  return document;
}

/** Applies the kit optimizations to a glTF Document in place. */
export async function optimizeDocument(document, { textures = "none", ktxTool = null, verbose = false, character = false } = {}) {
  await MeshoptEncoder.ready;
  document.setLogger(new Logger(verbose ? Logger.Verbosity.INFO : Logger.Verbosity.WARN));
  // keepAttributes: UVs look unused (no texture in the GLB) but the shared atlas binds at runtime.
  // Characters keep their socket empties (leaf nodes with hv_socket extras) and drop redundant
  // animation keys.
  const keep = character ? { keepLeaves: true, keepExtras: true } : {};
  if (character) sortTriangles(document);
  await document.transform(dedup(), prune({ keepAttributes: true, ...keep }), ...(character ? [resample()] : []));
  if (textures === "webp") {
    await document.transform(textureCompress({ encoder: await loadSharp(), targetFormat: "webp" }));
  } else if (textures === "ktx2") {
    const list = document.getRoot().listTextures();
    for (const texture of list) {
      const mime = texture.getMimeType();
      const image = texture.getImage();
      if (!image || mime === "image/ktx2") continue;
      const ext = mime === "image/jpeg" ? ".jpg" : ".png";
      texture.setImage(encodeKtx2(image, ktxTool, ext)).setMimeType("image/ktx2");
      const uri = texture.getURI();
      if (uri) texture.setURI(uri.replace(/\.[^./]+$/, ".ktx2"));
    }
    if (list.length) document.createExtension(KHRTextureBasisu).setRequired(true);
  }
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  return document;
}

/** Reads a GLB, optimizes it and returns the new GLB bytes. */
export async function optimizeGlb(bytes, options) {
  const io = await createIO();
  const document = await io.readBinary(bytes);
  await optimizeDocument(document, options);
  return io.writeBinary(document);
}

/** Converts the kit's shared atlas and returns the new file name (or the old one). */
async function optimizeAtlas(kitDir, file, mode, ktxTool, keepPng) {
  if (mode === "none" || extname(file) !== ".png") return file;
  const src = join(kitDir, file);
  if (!existsSync(src)) return file;
  const bytes = readFileSync(src);
  let out;
  if (mode === "ktx2") {
    out = file.replace(/\.png$/, ".ktx2");
    writeFileSync(join(kitDir, out), encodeKtx2(bytes, ktxTool));
  } else {
    out = file.replace(/\.png$/, ".webp");
    const sharp = await loadSharp();
    writeFileSync(join(kitDir, out), await sharp(bytes).webp({ quality: 90 }).toBuffer());
  }
  if (!keepPng) rmSync(src);
  return out;
}

/** Optimizes every GLB listed in a kit (or character) directory's manifest. */
export async function optimizeKit(kitDir, { textures = "auto", keepPng = false, log = console.log } = {}) {
  const manifestFile = manifestFileIn(kitDir) ?? MANIFEST_FILE;
  const character = manifestFile === CHARACTER_MANIFEST_FILE;
  const manifestPath = join(kitDir, manifestFile);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const ktxTool = findKtxTool();
  const mode = resolveTextureMode(textures, ktxTool);
  let before = 0;
  let after = 0;
  const files = manifestGlbFiles(manifest);
  for (const file of files) {
    const path = join(kitDir, file);
    if (!existsSync(path)) {
      log(`  missing ${file}, skipped`);
      continue;
    }
    const input = readFileSync(path);
    const output = await optimizeGlb(new Uint8Array(input), { textures: mode, ktxTool, character });
    writeFileSync(path, output);
    before += input.byteLength;
    after += output.byteLength;
  }
  if (manifest.atlas?.file) {
    manifest.atlas.file = await optimizeAtlas(kitDir, manifest.atlas.file, mode, ktxTool, keepPng);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  log(`  ${basename(kitDir)}: ${files.length} GLBs, ${before} -> ${after} bytes, textures ${mode}`);
  return { before, after, mode };
}

/** Kit or character directories under the given paths (such a dir itself, or a root holding
 * them). */
export function findKitDirs(paths) {
  const dirs = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (manifestFileIn(p)) {
      dirs.push(p);
      continue;
    }
    for (const name of readdirSync(p)) {
      const child = join(p, name);
      if (statSync(child).isDirectory() && manifestFileIn(child)) dirs.push(child);
    }
  }
  return dirs;
}

export function parseArgs(argv) {
  const opts = { paths: [], textures: "auto", keepPng: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--textures") opts.textures = argv[++i] ?? "";
    else if (a.startsWith("--textures=")) opts.textures = a.slice("--textures=".length);
    else if (a === "--keep-png") opts.keepPng = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.paths.push(resolve(a));
  }
  if (!opts.paths.length) opts.paths.push(DEFAULT_KITS_DIR);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("usage: node tools/optimize-assets.mjs [kit dirs...] [--textures auto|ktx2|webp|none] [--keep-png]");
    return;
  }
  const dirs = findKitDirs(opts.paths);
  if (!dirs.length) {
    console.error(`No ${MANIFEST_FILE} found under ${opts.paths.join(", ")}. Run npm run assets:build first.`);
    process.exitCode = 1;
    return;
  }
  for (const dir of dirs) await optimizeKit(dir, { textures: opts.textures, keepPng: opts.keepPng });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
