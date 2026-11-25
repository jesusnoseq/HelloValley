/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Color, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { AnimationStateMachine, appearanceHex, type AvatarAppearance, CHARACTER_MANIFEST_FILE, clothingColorHex } from "@hellovalley/shared";
import { assembleAvatar, tintAvatar } from "./avatarLook";
import { loadCharacterAssets } from "./characterGlb";

// The avatar built from a profile's appearance and driven by the shared animation state machine
// (build plan M15), against the committed M07 character set.
const DIR = new URL("../../public/assets/characters/", import.meta.url);
const present = existsSync(fileURLToPath(new URL(CHARACTER_MANIFEST_FILE, DIR)));

async function fakeFetch(url: string) {
  const bytes = readFileSync(fileURLToPath(new URL(url.replace(/^.*\//, ""), DIR)));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

const look: AvatarAppearance = { animal: "otter", colors: { fur: "chestnut", shirt: { h: 300, s: 0.5, l: 0.8 }, trousers: { swatch: "moss" } } };

function hexOf(materials: readonly MeshStandardMaterial[] | undefined): string[] {
  return (materials ?? []).map((m) => `#${m.color.getHexString()}`);
}

describe.skipIf(!present)("player avatar", () => {
  it("tints fur and custom clothes from the appearance, and re-tints in place", async () => {
    const assets = await loadCharacterAssets("/assets/characters", { animals: ["otter"], outfits: [], fetchImpl: fakeFetch });
    const c = assembleAvatar(assets, look);
    const hex = appearanceHex(look);
    // Material colours are linear; compare in sRGB like the hex inputs.
    const srgb = (h: string) => `#${new Color(h).getHexString()}`;
    expect(hexOf(c.tints.get("fur"))).toEqual(hexOf(c.tints.get("fur")).map(() => srgb(hex.fur)));
    expect(hexOf(c.tints.get("shirt"))[0]).toBe(srgb(clothingColorHex(look.colors.shirt)));
    tintAvatar(c, { ...look, colors: { ...look.colors, trousers: { swatch: "coral" } } });
    expect(hexOf(c.tints.get("trousers"))[0]).toBe(srgb(clothingColorHex({ swatch: "coral" })));
  });

  it("crossfades the clips the state machine picks, including out of a finished one-shot", async () => {
    const assets = await loadCharacterAssets("/assets/characters", { animals: ["otter"], outfits: [], fetchImpl: fakeFetch });
    const c = assembleAvatar(assets, look);
    const timings = Object.fromEntries(assets.manifest.animations.map((a) => [a.name, { duration: a.duration, loop: a.loop }]));
    const m = new AnimationStateMachine(timings);
    c.play(m.clip, 0);
    const step = (motion: "idle" | "walk" | "run", seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        const change = m.update({ motion }, 1 / 30);
        if (change) c.play(change.clip, change.fade, change.restart);
        c.mixer.update(1 / 30);
      }
    };
    const weight = (clip: string) => c.actions.get(clip)!.getEffectiveWeight();

    step("walk", 0.1);
    expect(m.clip).toBe("walk");
    // Mid-crossfade both clips contribute.
    expect(weight("walk")).toBeGreaterThan(0);
    expect(weight("idle")).toBeGreaterThan(0);
    step("walk", 0.5);
    expect(weight("walk")).toBeCloseTo(1);
    expect(weight("idle")).toBeCloseTo(0);

    step("idle", 0.6);
    expect(m.clip).toBe("idle");
    expect(m.playEmote("heart")).toBe(true);
    step("idle", 0.1);
    expect(m.clip).toBe("heart");
    const heartLength = assets.manifest.animations.find((a) => a.name === "heart")!.duration;
    step("idle", heartLength + 0.1);
    // The one-shot finished (clamped) and faded back to idle instead of snapping.
    expect(m.clip).toBe("idle");
    expect(weight("heart")).toBeGreaterThan(0);
    step("idle", 0.5);
    expect(weight("heart")).toBeCloseTo(0);
    expect(weight("idle")).toBeCloseTo(1);
  });
});
