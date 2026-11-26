import { describe, expect, it } from "vitest";
import { type SfxSnapshot, sfxForChange } from "./gameSfx";

const base: SfxSnapshot = { coins: 10, fishing: "idle", cooked: null, forage: null, saved: null, panels: 0 };

describe("interaction effects from game state", () => {
  it("rings coins when the purse changes, not when it first loads", () => {
    expect(sfxForChange(base, { ...base, coins: 4 })).toEqual(["coins"]);
    expect(sfxForChange({ ...base, coins: null }, base)).toEqual([]);
    expect(sfxForChange(base, base)).toEqual([]);
  });

  it("follows the fishing phases", () => {
    expect(sfxForChange(base, { ...base, fishing: "casting" })).toEqual(["fish.cast"]);
    expect(sfxForChange({ ...base, fishing: "casting" }, { ...base, fishing: "waiting" })).toEqual(["fish.splash"]);
    expect(sfxForChange({ ...base, fishing: "waiting" }, { ...base, fishing: "bite" })).toEqual(["fish.splash"]);
    expect(sfxForChange({ ...base, fishing: "bite" }, { ...base, fishing: "reeling" })).toEqual(["fish.reel"]);
    expect(sfxForChange({ ...base, fishing: "reeling" }, { ...base, fishing: "reeling" })).toEqual([]);
  });

  it("sizzles a cooked dish, jingles a pick-up and turns a page for a saved word (successes only)", () => {
    expect(sfxForChange(base, { ...base, cooked: { ok: true } })).toEqual(["cook.sizzle"]);
    expect(sfxForChange(base, { ...base, cooked: { ok: false } })).toEqual([]);
    expect(sfxForChange(base, { ...base, forage: { ok: true } })).toEqual(["pickup"]);
    expect(sfxForChange(base, { ...base, saved: { outcome: "saved", at: 1 } })).toEqual(["page"]);
    expect(sfxForChange(base, { ...base, saved: { outcome: "exists", at: 1 } })).toEqual([]);
  });

  it("opens and closes panels", () => {
    expect(sfxForChange(base, { ...base, panels: 1 })).toEqual(["ui.open"]);
    expect(sfxForChange({ ...base, panels: 2 }, { ...base, panels: 1 })).toEqual(["ui.close"]);
  });
});
