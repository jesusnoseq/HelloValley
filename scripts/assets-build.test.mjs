import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHARACTERS_DIR, DEFAULT_KITS_DIR } from "../tools/optimize-assets.mjs";
import { buildArgs, kitId } from "./assets-build.mjs";

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

  it("finds the contact sheet path", () => {
    expect(buildArgs([]).contactSheet).toBeNull();
    const { passthrough, contactSheet } = buildArgs(["--contact-sheet", "docs/a.png"]);
    expect(contactSheet).toBe(resolve(ROOT, "docs/a.png"));
    expect(passthrough).toContain("--contact-sheet");
    expect(buildArgs(["--contact-sheet=docs/b.png"]).contactSheet).toBe(resolve(ROOT, "docs/b.png"));
  });

  it("names the contact sheet after the kit with --contact-sheet auto", () => {
    expect(buildArgs(["--contact-sheet", "auto"]).contactSheet).toBe(resolve(ROOT, "docs/art/european-kit-contact-sheet.png"));
    const common = buildArgs(["--no-optimize", "--contact-sheet", "auto", "--style", "common"]);
    expect(common.contactSheet).toBe(resolve(ROOT, "docs/art/common-kit-contact-sheet.png"));
    expect(common.passthrough).toContain("docs/art/common-kit-contact-sheet.png");
    expect(buildArgs(["--style=europe", "--contact-sheet=auto"]).passthrough).toContain("--contact-sheet=docs/art/european-kit-contact-sheet.png");
    expect(kitId("Europe")).toBe("european");
    expect(kitId("shared")).toBe("common");
  });

  it("builds characters into public/assets/characters with --characters", () => {
    const { passthrough, outRoot, contactSheet } = buildArgs(["--characters", "--contact-sheet", "auto"]);
    expect(passthrough).not.toContain("--style");
    expect(passthrough.slice(-2)).toEqual(["--out", DEFAULT_CHARACTERS_DIR]);
    expect(outRoot).toBe(DEFAULT_CHARACTERS_DIR);
    expect(contactSheet).toBe(resolve(ROOT, "docs/art/characters-contact-sheet.png"));
  });
});
