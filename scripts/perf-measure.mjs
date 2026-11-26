#!/usr/bin/env node
// npm run perf:measure [-- <out.json>]
//
// Build plan M37: the automated per-style town measurements for docs/perf.md (triangles, meshes,
// draw-call estimates with the local player and with a full shard), written as JSON by
// packages/client/src/scene/perfReport.test.ts, plus the production bundle sizes (run
// `npm run build` first for those).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(ROOT, process.argv[2] ?? "docs/perf/town-measurements.json");

const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", "packages/client/src/scene/perfReport.test.ts"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, HV_PERF_REPORT: out } });
if (r.status !== 0) process.exit(r.status ?? 1);

const report = JSON.parse(readFileSync(out, "utf8"));
const dist = join(ROOT, "packages", "client", "dist", "assets");
if (existsSync(dist)) {
  const files = readdirSync(dist).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
  const chunks = files
    .map((f) => {
      const bytes = readFileSync(join(dist, f));
      return { file: f, kB: Math.round(bytes.length / 102.4) / 10, gzipKB: Math.round(gzipSync(bytes).length / 102.4) / 10 };
    })
    .sort((a, b) => b.kB - a.kB);
  const index = readFileSync(join(ROOT, "packages", "client", "dist", "index.html"), "utf8");
  const entry = [...index.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const sum = (list, key) => Math.round(list.reduce((n, c) => n + c[key], 0) * 10) / 10;
  const initial = chunks.filter((c) => entry.includes(c.file));
  report.bundle = { totalKB: sum(chunks, "kB"), totalGzipKB: sum(chunks, "gzipKB"), entryKB: sum(initial, "kB"), entryGzipKB: sum(initial, "gzipKB"), largest: chunks.slice(0, 12) };
}
const dirSize = (dir) => readdirSync(dir).reduce((n, f) => n + (statSync(join(dir, f)).isDirectory() ? dirSize(join(dir, f)) : statSync(join(dir, f)).size), 0);
const assets = join(ROOT, "packages", "client", "public", "assets");
report.assets = Object.fromEntries(
  [...readdirSync(join(assets, "kits")).map((k) => [`kits/${k}`, join(assets, "kits", k)]), ["characters", join(assets, "characters")], ["audio", join(assets, "audio")]].map(([k, d]) => [k, Math.round(dirSize(d) / 1024)]),
);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${out}`);
