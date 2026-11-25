import { describe, expect, it } from "vitest";
import {
  CEFR_LEVELS,
  cefrOf,
  effectiveLevel,
  effectiveLevelInfo,
  isLevel,
  LEVELS,
  LevelSchema,
  levelBand,
  levelToStep,
  MAX_LEVEL_STEP,
  shiftLevel,
  stepToLevel,
  type Level,
} from "./difficulty";
import { NPC_IDS, NPCS, type NpcId } from "./npcs";

describe("levels", () => {
  it("are half-CEFR steps from A1 to C2", () => {
    expect(LEVELS).toHaveLength(11);
    expect(LEVELS.filter((l) => !l.endsWith("+"))).toEqual(CEFR_LEVELS);
    LEVELS.forEach((level, i) => expect(levelToStep(level)).toBe(i));
  });

  it("stepToLevel clamps, floors and rejects non-finite input", () => {
    expect(stepToLevel(0)).toBe("A1");
    expect(stepToLevel(4)).toBe("B1");
    expect(stepToLevel(4.9)).toBe("B1");
    expect(stepToLevel(-3)).toBe("A1");
    expect(stepToLevel(99)).toBe("C2");
    expect(stepToLevel(Number.NaN)).toBe("A1");
    expect(stepToLevel(Number.POSITIVE_INFINITY)).toBe("A1");
    for (let step = 0; step <= MAX_LEVEL_STEP; step++) expect(levelToStep(stepToLevel(step))).toBe(step);
  });

  it("cefrOf and levelBand drop the half step", () => {
    expect(cefrOf("A1")).toBe("A1");
    expect(cefrOf("A1+")).toBe("A1");
    expect(cefrOf("B2+")).toBe("B2");
    expect(cefrOf("C2")).toBe("C2");
    expect(LEVELS.map(levelBand)).toEqual(["A", "A", "A", "A", "B", "B", "B", "B", "C", "C", "C"]);
  });

  it("shiftLevel moves by half steps and clamps", () => {
    expect(shiftLevel("A2", 1)).toBe("A2+");
    expect(shiftLevel("A2", -1)).toBe("A1+");
    expect(shiftLevel("A1", -1)).toBe("A1");
    expect(shiftLevel("C2", 1)).toBe("C2");
    expect(shiftLevel("B1", 0.9)).toBe("B1");
    expect(shiftLevel("B1", -0.9)).toBe("B1");
  });

  it("isLevel and LevelSchema accept only known levels", () => {
    expect(isLevel("B1+")).toBe(true);
    expect(isLevel("B3")).toBe(false);
    expect(isLevel("C2+")).toBe(false);
    expect(isLevel(2)).toBe(false);
    expect(LevelSchema.safeParse("A2+").success).toBe(true);
    expect(LevelSchema.safeParse("a2").success).toBe(false);
  });
});

describe("effectiveLevel (GDD §6.4)", () => {
  // GDD §6.4 offsets in half-CEFR steps: Baker/Farmer −1 level, Shopkeeper/Doctor/Barista/Gossip 0,
  // Mayor +½, Librarian/Elder +1.
  const GDD_OFFSETS: Record<NpcId, number> = {
    baker: -2,
    farmer: -2,
    shopkeeper: 0,
    doctor: 0,
    barista: 0,
    gossip: 0,
    mayor: 1,
    librarian: 2,
    elder: 2,
  };

  it("uses the GDD tier offsets", () => {
    for (const npc of NPCS) expect(npc.tierOffset, npc.id).toBe(GDD_OFFSETS[npc.id]);
  });

  it("is clamp(player + offset, A1, C2) for every level and NPC", () => {
    for (const player of LEVELS) {
      for (const npcId of NPC_IDS) {
        const raw = levelToStep(player) + GDD_OFFSETS[npcId];
        const expected = LEVELS[Math.min(MAX_LEVEL_STEP, Math.max(0, raw))] as Level;
        const info = effectiveLevelInfo(player, npcId);
        expect(info.level, `${player} × ${npcId}`).toBe(expected);
        expect(info.cefr).toBe(cefrOf(expected));
        expect(info.simplified).toBe(raw < 0);
        expect(effectiveLevel(player, npcId)).toBe(expected);
      }
    }
  });

  it("matches worked examples", () => {
    expect(effectiveLevel("B1", "baker")).toBe("A2");
    expect(effectiveLevel("B1", "shopkeeper")).toBe("B1");
    expect(effectiveLevel("B1", "mayor")).toBe("B1+");
    expect(effectiveLevel("B1", "librarian")).toBe("B2");
    expect(effectiveLevel("A2+", "farmer")).toBe("A1+");
    expect(effectiveLevel("C1+", "elder")).toBe("C2");
    expect(effectiveLevel("C2", "mayor")).toBe("C2");
  });

  it("absorbs offsets below A1 and flags the line for extra simplification", () => {
    expect(effectiveLevelInfo("A1", "baker")).toEqual({ level: "A1", cefr: "A1", simplified: true });
    expect(effectiveLevelInfo("A1+", "farmer")).toEqual({ level: "A1", cefr: "A1", simplified: true });
    expect(effectiveLevelInfo("A2", "baker")).toEqual({ level: "A1", cefr: "A1", simplified: false });
    expect(effectiveLevelInfo("A1", "gossip").simplified).toBe(false);
  });

  it("never makes an NPC easier than a lower-offset one", () => {
    const sorted = [...NPCS].sort((a, b) => a.tierOffset - b.tierOffset);
    for (const player of LEVELS) {
      for (let i = 1; i < sorted.length; i++) {
        const prev = levelToStep(effectiveLevel(player, sorted[i - 1]!.id));
        expect(levelToStep(effectiveLevel(player, sorted[i]!.id))).toBeGreaterThanOrEqual(prev);
      }
    }
  });
});
