import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_KITS_DIR } from "../tools/optimize-assets.mjs";
import { buildArgs } from "./assets-build.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("assets:build arguments", () => {
  it("defaults the style and output folder", () => {
    const { passthrough, optimize, outRoot } = buildArgs(["--modules", "test.cube"]);
    expect(passthrough).toEqual(["--modules", "test.cube", "--style", "european", "--out", DEFAULT_KITS_DIR]);
    expect(optimize).toBe(true);
    expect(outRoot).toBe(DEFAULT_KITS_DIR);
  });

  it("keeps explicit options and strips wrapper flags", () => {
    const { passthrough, optimize, outRoot } = buildArgs(["--style", "europe", "--out", "tmp/kits", "--no-optimize"]);
    expect(passthrough).toEqual(["--style", "europe", "--out", "tmp/kits"]);
    expect(optimize).toBe(false);
    expect(outRoot).toBe(resolve(ROOT, "tmp/kits"));
    expect(buildArgs(["--out=x", "--dry-run"]).optimize).toBe(false);
    expect(buildArgs(["--out=x"]).outRoot).toBe(resolve(ROOT, "x"));
  });
});
