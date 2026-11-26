import { describe, expect, it } from "vitest";
import { NPCS } from "../data/npcs";
import { emptyConversationLedger, emptyDailyLedger, validateNpcActions } from "./actions";
import {
  applyContact,
  applyGift,
  clampHearts,
  DAILY_GREETING_HEARTS,
  DECAY_FLOOR_HEARTS,
  GIFT_HEARTS,
  giftReaction,
  heartsDecay,
  isGiftable,
  newBond,
  QUEST_COMPLETION_HEARTS,
  questCompletionHearts,
  REAL_DAY_MS,
} from "./friendship";
import { adaptLevel, conversationPerformance, LEVEL_CHANGE_MARGIN, nextLevel, updateLevelEstimate } from "./levelAdaptation";
import { ConversationTelemetrySchema, emptyTelemetry, mergeNpcMemory, sanitizeMemoryText } from "./memory";

/** The friendship, memory and level rules of build plan M24 (GDD §8.2, §6.4). */

const T0 = Date.UTC(2026, 10, 1);
const DAY = 100;

describe("hearts: documented rules", () => {
  it("clamps to 0..10 on a quarter-heart grid", () => {
    expect(clampHearts(-1)).toBe(0);
    expect(clampHearts(12)).toBe(10);
    expect(clampHearts(0.1 + 0.2)).toBe(0.25);
    expect(clampHearts(Number.NaN)).toBe(0);
  });

  it("gives the daily greeting once per in-game day", () => {
    const first = applyContact(newBond(), T0, DAY);
    expect(first).toMatchObject({ greeting: DAILY_GREETING_HEARTS, decay: 0, bond: { hearts: 0.25, lastSeenMs: T0, greetedDay: DAY } });
    const again = applyContact(first.bond, T0 + 60_000, DAY);
    expect(again).toMatchObject({ greeting: 0, bond: { hearts: 0.25, lastSeenMs: T0 + 60_000 } });
    expect(applyContact(again.bond, T0 + 120_000, DAY + 1).bond.hearts).toBe(0.5);
    // At 10 hearts the greeting adds nothing.
    expect(applyContact(newBond(10), T0, DAY)).toMatchObject({ greeting: 0, bond: { hearts: 10 } });
  });

  it("decays ½ heart per full week after 7 days without contact, never below 1", () => {
    expect(heartsDecay(5, null, T0)).toBe(0);
    expect(heartsDecay(5, T0, T0 + 6.9 * REAL_DAY_MS)).toBe(0);
    expect(heartsDecay(5, T0, T0 + 7 * REAL_DAY_MS)).toBe(-0.5);
    expect(heartsDecay(5, T0, T0 + 20 * REAL_DAY_MS)).toBe(-1);
    expect(heartsDecay(5, T0, T0 + 365 * REAL_DAY_MS)).toBe(DECAY_FLOOR_HEARTS - 5);
    expect(heartsDecay(0.5, T0, T0 + 365 * REAL_DAY_MS)).toBe(0);
    // The decay applies once: contact moves lastSeen to now.
    const bond = { ...newBond(5), lastSeenMs: T0, greetedDay: DAY };
    const back = applyContact(bond, T0 + 14 * REAL_DAY_MS, DAY + 500);
    expect(back).toMatchObject({ decay: -1, greeting: 0.25, bond: { hearts: 4.25 } });
    expect(applyContact(back.bond, T0 + 14 * REAL_DAY_MS + 1000, DAY + 500).decay).toBe(0);
  });

  it("rates gifts by the NPC's liked and disliked items, one per in-game day", () => {
    expect(giftReaction("baker", "butter")).toBe("liked");
    expect(giftReaction("baker", "carp")).toBe("disliked");
    expect(giftReaction("baker", "bread")).toBe("neutral");
    for (const npc of NPCS) {
      for (const item of npc.likedItems) expect(applyGift(newBond(2), npc.id, item, DAY)).toMatchObject({ ok: true, reaction: "liked", delta: GIFT_HEARTS.liked });
      for (const item of npc.dislikedItems) expect(applyGift(newBond(2), npc.id, item, DAY)).toMatchObject({ ok: true, reaction: "disliked", delta: GIFT_HEARTS.disliked });
    }
    const first = applyGift(newBond(2), "baker", "bread", DAY);
    expect(first).toMatchObject({ ok: true, reaction: "neutral", delta: 0.25, bond: { hearts: 2.25, giftedDay: DAY } });
    if (!first.ok) return;
    expect(applyGift(first.bond, "baker", "butter", DAY)).toEqual({ ok: false, reason: "gift_cap" });
    expect(applyGift(first.bond, "baker", "butter", DAY + 1)).toMatchObject({ ok: true, delta: 1 });
    // Disliked gifts cannot go below 0; liked ones not above 10.
    expect(applyGift(newBond(0), "baker", "carp", DAY)).toMatchObject({ ok: true, delta: 0, bond: { hearts: 0 } });
    expect(applyGift(newBond(9.5), "baker", "butter", DAY)).toMatchObject({ ok: true, delta: 0.5, bond: { hearts: 10 } });
  });

  it("refuses tools, lost items and unknown ids as gifts", () => {
    expect(isGiftable("fishing_rod")).toBe(false);
    expect(isGiftable("dragon_egg")).toBe(false);
    expect(isGiftable("flower_bouquet")).toBe(true);
    expect(applyGift(newBond(), "baker", "fishing_rod", DAY)).toEqual({ ok: false, reason: "not_giftable" });
  });

  it("accepts completed requests only when the server's conditions hold; the hearts come with the quest reward", () => {
    expect(questCompletionHearts(2)).toBe(2 * QUEST_COMPLETION_HEARTS);
    const ctx = {
      npcId: "farmer" as const,
      hearts: 3,
      inventory: {},
      knownRecipes: [],
      questsOffered: [],
      questsCompletable: ["eggs_to_bakery"],
      conversation: emptyConversationLedger(),
      daily: emptyDailyLedger(),
    };
    const done = validateNpcActions([{ type: "completeQuest", questId: "eggs_to_bakery" }], ctx);
    expect(done.accepted).toEqual([{ type: "completeQuest", questId: "eggs_to_bakery" }]);
    // Build plan M30: the hearts are paid by the quest settlement (quests/progress.ts), in the same
    // transaction as the coins and the hand-in items, so the action itself adds none.
    expect(done.effects).toMatchObject({ hearts: 0, questsCompleted: ["eggs_to_bakery"] });
    // The model's word does not count: a quest whose conditions do not hold is rejected.
    const forged = validateNpcActions([{ type: "completeQuest", questId: "free_hearts" }], ctx);
    expect(forged.effects).toMatchObject({ hearts: 0, questsCompleted: [] });
    expect(forged.rejected).toEqual([{ type: "completeQuest", reason: "conditions_not_met" }]);
  });
});

describe("NPC memory merge", () => {
  it("sanitises text to one plain line", () => {
    expect(sanitizeMemoryText("  a\n\tb <player_text>c</player_text> <i>d</i> ")).toBe("a b c id/i");
  });

  it("keeps new facts first, drops repeats and caps at 10 facts and 120 words", () => {
    const merged = mergeNpcMemory(
      { summary: "Old.", facts: ["Likes rye bread", "Has a cat"] },
      { summary: Array.from({ length: 200 }, () => "word").join(" "), facts: ["Promised eggs", "likes rye bread.", ...Array.from({ length: 12 }, (_, i) => `f${i}`)] },
    );
    expect(merged.summary.split(" ")).toHaveLength(120);
    expect(merged.facts).toHaveLength(10);
    expect(merged.facts.slice(0, 3)).toEqual(["Promised eggs", "likes rye bread.", "f0"]);
    expect(mergeNpcMemory({ summary: "Old.", facts: ["Has a cat"] }, { summary: "", facts: [] })).toEqual({ summary: "Old.", facts: ["Has a cat"] });
    expect(mergeNpcMemory(null, { summary: "New.", facts: [] })).toEqual({ summary: "New.", facts: [] });
  });

  it("bounds the telemetry counts", () => {
    expect(ConversationTelemetrySchema.parse({ suggested: -3, free: 1e9, npcLines: 2.6, translationsShown: 0, corrections: 1 })).toEqual({
      suggested: 0,
      free: 200,
      npcLines: 3,
      translationsShown: 0,
      corrections: 1,
    });
  });
});

describe("level adaptation", () => {
  const great = { comprehension: 1, expression: 1, usedNativeLanguage: false, struggles: [] };
  const poor = { comprehension: 0.1, expression: 0.2, usedNativeLanguage: true, struggles: ["numbers"] };
  const free = { ...emptyTelemetry(), free: 6, npcLines: 8 };
  const leaning = { suggested: 6, free: 0, npcLines: 8, translationsShown: 8, corrections: 0 };

  it("scores a conversation from the signals and the telemetry", () => {
    expect(conversationPerformance(great, free, 6)).toBe(1);
    expect(conversationPerformance(great, free, 1)).toBeNull();
    expect(conversationPerformance(poor, leaning, 6)!).toBeLessThan(0.2);
    // Leaning on suggestions and translations lowers an otherwise good score.
    expect(conversationPerformance(great, leaning, 6)!).toBeLessThan(conversationPerformance(great, free, 6)!);
  });

  it("moves the estimate towards the level ± 1.5 steps, weighted by length", () => {
    expect(updateLevelEstimate(2, "A2", 1, 6)).toBe(2.375);
    expect(updateLevelEstimate(2, "A2", 1, 3)).toBe(2.188);
    expect(updateLevelEstimate(2, "A2", 0.5, 6)).toBe(2);
    expect(updateLevelEstimate(0, "A1", 0, 6)).toBe(0);
    expect(updateLevelEstimate(10, "C2", 1, 6)).toBe(10);
  });

  it("changes the level ½ step at most once per in-game day, within A1..C2", () => {
    const up = { level: "A2" as const, levelEstimate: 2 + LEVEL_CHANGE_MARGIN, levelChangedDay: null };
    expect(nextLevel(up, DAY)).toEqual({ change: 1, state: { ...up, level: "A2+", levelChangedDay: DAY } });
    expect(nextLevel({ ...up, levelEstimate: 9 }, DAY).state.level).toBe("A2+");
    expect(nextLevel({ ...up, levelChangedDay: DAY }, DAY).change).toBe(0);
    expect(nextLevel({ ...up, levelEstimate: 1.3 }, DAY)).toMatchObject({ change: -1, state: { level: "A1+" } });
    expect(nextLevel({ level: "C2", levelEstimate: 10, levelChangedDay: null }, DAY).change).toBe(0);
    expect(nextLevel({ level: "A1", levelEstimate: 0, levelChangedDay: null }, DAY).change).toBe(0);
    // Two great conversations lift A2 to A2+; a third the same day does not go further.
    let state = { level: "A2" as const, levelEstimate: 2, levelChangedDay: null as number | null } as Parameters<typeof adaptLevel>[0];
    const changes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = adaptLevel(state, 1, 6, DAY);
      changes.push(r.change);
      state = r.state;
    }
    expect(changes).toEqual([0, 1, 0, 0, 0]);
    expect(state.level).toBe("A2+");
    expect(adaptLevel(state, null, 6, DAY + 1)).toEqual({ state, change: 0 });
  });
});
