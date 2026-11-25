#!/usr/bin/env node
// npm run assets:build [-- <build.py args>] [--no-optimize]
//
// Runs the Blender kit generator headless, then tools/optimize-assets on the kits it wrote.
// Blender is found through $BLENDER (exclusively, when set), else `blender` on PATH, else the
// usual install folders.
// Without Blender it prints how to install it and exits with status 1. This is deliberately
// not part of `npm run build`.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_KITS_DIR, MANIFEST_FILE, findKitDirs, optimizeKit } from "../tools/optimize-assets.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_PY = join(ROOT, "tools", "blender", "build.py");
const TARGET = "5.2 LTS";

function works(cmd) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 60_000 });
  return !r.error && r.status === 0 && /Blender/i.test(r.stdout ?? "");
}

function candidates() {
  // An explicit $BLENDER is the only candidate, so a wrong path fails loudly.
  if (process.env.BLENDER) return [process.env.BLENDER];
  const out = ["blender"];
  if (process.platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean)) {
      const foundation = join(base, "Blender Foundation");
      if (!existsSync(foundation)) continue;
      // Newest version first ("Blender 5.2" before "Blender 4.5").
      const dirs = readdirSync(foundation).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
      for (const dir of dirs) out.push(join(foundation, dir, "blender.exe"));
    }
  } else if (process.platform === "darwin") {
    out.push("/Applications/Blender.app/Contents/MacOS/Blender");
  }
  return out;
}

export function findBlender() {
  for (const cmd of candidates()) {
    const isPath = cmd.includes("/") || cmd.includes("\\");
    if (isPath && !existsSync(cmd)) continue;
    if (works(cmd)) return cmd;
  }
  return null;
}

/** Splits wrapper flags from build.py flags and fills in the default style and output. */
export function buildArgs(argv) {
  const passthrough = argv.filter((a) => a !== "--no-optimize");
  const optimize = !argv.includes("--no-optimize") && !argv.includes("--dry-run");
  const sheetIndex = argv.findIndex((a) => a === "--contact-sheet" || a.startsWith("--contact-sheet="));
  const sheetValue =
    sheetIndex === -1 ? null : argv[sheetIndex].includes("=") ? argv[sheetIndex].split("=")[1] : argv[sheetIndex + 1];
  const contactSheet = sheetValue ? resolve(ROOT, sheetValue) : null;
  const has = (flag) => passthrough.some((a) => a === flag || a.startsWith(`${flag}=`));
  if (!has("--style")) passthrough.push("--style", "european");
  let outRoot = DEFAULT_KITS_DIR;
  const outIndex = passthrough.findIndex((a) => a === "--out" || a.startsWith("--out="));
  if (outIndex === -1) passthrough.push("--out", DEFAULT_KITS_DIR);
  else {
    const value = passthrough[outIndex].includes("=") ? passthrough[outIndex].split("=")[1] : passthrough[outIndex + 1];
    outRoot = resolve(ROOT, value ?? "");
  }
  return { passthrough, optimize, outRoot, contactSheet };
}

/** Re-encodes Blender's contact-sheet PNG as a palette PNG (a fraction of the size, fine for
 * docs). */
export async function shrinkPng(path) {
  const sharp = (await import("sharp")).default;
  const before = statSync(path).size;
  const bytes = await sharp(readFileSync(path)).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
  if (bytes.length < before) writeFileSync(path, bytes);
  return { before, after: Math.min(before, bytes.length) };
}

async function main() {
  const blender = findBlender();
  if (!blender) {
    console.error(
      [
        "assets:build needs Blender, which was not found.",
        `Install Blender ${TARGET} (https://www.blender.org/download/lts/) and either put it on PATH`,
        "or set BLENDER to the executable, e.g.",
        '  BLENDER="C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" npm run assets:build',
        "See tools/blender/README.md. (npm run build does not need Blender.)",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  const { passthrough, optimize, outRoot, contactSheet } = buildArgs(process.argv.slice(2));
  const started = Date.now();
  const args = ["--background", "--factory-startup", "--python-exit-code", "1", "--python", BUILD_PY, "--", ...passthrough];
  console.log(`> ${blender} ${args.join(" ")}`);
  const r = spawnSync(blender, args, { stdio: "inherit", cwd: ROOT });
  if (r.error || r.status !== 0) {
    console.error(`Blender exited with ${r.error?.message ?? r.status}`);
    process.exitCode = r.status || 1;
    return;
  }
  if (contactSheet && existsSync(contactSheet)) {
    const { before, after } = await shrinkPng(contactSheet);
    console.log(`  contact sheet: ${before} -> ${after} bytes`);
    return;
  }
  if (!optimize) return;
  // Optimize only the kits this run wrote.
  const fresh = findKitDirs([outRoot]).filter((dir) => statSync(join(dir, MANIFEST_FILE)).mtimeMs >= started - 1000);
  for (const dir of fresh) await optimizeKit(dir);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
