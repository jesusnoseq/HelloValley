import { describe, expect, it } from "vitest";
import { getItem, ITEMS } from "../data/items";
import { getRecipe, RECIPES } from "../data/recipes";
import type { FishingConditions } from "../data/fish";
import { castTable } from "../fishing/roll";
import { emptyConversationLedger, emptyDailyLedger, validateNpcActions } from "../npc/actions";
import { npcContextFixture } from "../npc/fixtures";
import { HOTBAR_FIRST_SLOT, itemCounts, type SlotEntry } from "../npc/inventory";
import { buildNpcTurnVariables } from "../npc/prompt";
import { ClientMessage } from "../protocol/messages";
import { parseClientMessage } from "../protocol/schemas";
import { nearestInteractable, spaceInteractables } from "../world/interactables";
import { interiorArrivalPoint, PlayerController, spaceGrid } from "../world/player";
import { isLabelKey, LABEL_REGISTRY } from "../world/labels";
import { circleFits, RUN_SPEED_MPS } from "../world/movement";
import { createMoveTracker, MOVE_BUDGET_CAP_M, validateMove } from "../world/moveValidation";
import type { Vec2 } from "../world/town";
import { activeBuffs, addBuff, buffAmount, eatEffects, extraReplyHints, fishingLuck, HAPPY_EMOTE, walkSpeedFactor } from "./buffs";
import { atKitchen, cookRecipe, emptyRecipeBook, KITCHEN_REACH_M, kitchenSpot, knownRecipeIds, learnRecipes, planCooking } from "./cooking";
import { CAKE_SCOLD_COUNT, eatenToday, eatingFlags, judgeEat, recordEaten } from "./eating";
import { recipeCard, recipeCardLabels } from "./recipeCard";
import { allSeats, getSeat, judgeSit, nearestSeat, SEAT_REACH_M, spaceSeats } from "./seats";

const player = { name: "Lia", animal: "otter", apartmentId: "3A" };
const H = HOTBAR_FIRST_SLOT;
const MIN = 60_000;

describe("buffs (build plan M29, GDD §5.4)", () => {
  it("map the GDD foods to their effects", () => {
    expect(getItem("bread")!.buff).toEqual({ kind: "walk_speed", amount: 0.1, durationSec: 300 });
    expect(getItem("coffee")!.buff).toEqual({ kind: "reply_hint", amount: 1, durationSec: 600 });
    expect(getItem("fish_stew")!.buff?.kind).toBe("fishing_luck");
    expect(eatEffects("cake")).toEqual({ buff: null, emote: HAPPY_EMOTE });
    expect(eatEffects("bread").emote).toBeNull();
    expect(eatEffects("croissant")).toEqual({ buff: null, emote: null });
  });

  it("run for their duration and then expire", () => {
    const t0 = 1_000_000;
    const buffs = addBuff([], "bread", getItem("bread")!.buff!, t0);
    expect(walkSpeedFactor(buffs, t0)).toBeCloseTo(1.1);
    expect(walkSpeedFactor(buffs, t0 + 5 * MIN - 1)).toBeCloseTo(1.1);
    expect(walkSpeedFactor(buffs, t0 + 5 * MIN)).toBe(1);
    expect(activeBuffs(buffs, t0 + 5 * MIN)).toEqual([]);
    expect(walkSpeedFactor([], t0)).toBe(1);
  });

  it("do not stack: eating again restarts the timer and keeps the stronger amount", () => {
    const t0 = 0;
    let buffs = addBuff([], "bread", getItem("bread")!.buff!, t0);
    buffs = addBuff(buffs, "bread", getItem("bread")!.buff!, t0 + 4 * MIN);
    expect(buffs).toHaveLength(1);
    expect(walkSpeedFactor(buffs, t0 + 8 * MIN)).toBeCloseTo(1.1);
    expect(walkSpeedFactor(buffs, t0 + 9 * MIN)).toBe(1);
    // A weaker refresh keeps the stronger amount.
    buffs = addBuff([], "bread", { kind: "walk_speed", amount: 0.2, durationSec: 60 }, 0);
    buffs = addBuff(buffs, "bread", getItem("bread")!.buff!, 1000);
    expect(buffAmount(buffs, "walk_speed", 2000)).toBeCloseTo(0.2);
    // Different kinds sit side by side.
    buffs = addBuff(buffs, "coffee", getItem("coffee")!.buff!, 1000);
    buffs = addBuff(buffs, "fish_stew", getItem("fish_stew")!.buff!, 1000);
    expect(extraReplyHints(buffs, 2000)).toBe(1);
    expect(fishingLuck(buffs, 2000)).toBeCloseTo(0.2);
  });

  it("are capped whatever the amounts", () => {
    const silly = addBuff([], "bread", { kind: "walk_speed", amount: 9, durationSec: 60 }, 0);
    expect(walkSpeedFactor(silly, 1)).toBeCloseTo(1.25);
    expect(fishingLuck(addBuff([], "fish_stew", { kind: "fishing_luck", amount: 9, durationSec: 60 }, 0), 1)).toBe(0.5);
    expect(extraReplyHints(addBuff([], "coffee", { kind: "reply_hint", amount: 5, durationSec: 60 }, 0), 1)).toBe(1);
  });
});

describe("walk speed in the movement check (build plan M29)", () => {
  it("lets a bread-buffed walker cover more ground, and the client walks faster too", () => {
    // A straight, open stretch of town.
    const grid = spaceGrid("town");
    let start: Vec2 | null = null;
    for (let x = 20; x < 80 && !start; x += 0.5) {
      for (let z = 20; z < 80 && !start; z += 0.5) {
        let clear = true;
        for (let d = 0; d <= 6 && clear; d += 0.25) clear = circleFits(grid, [x + d, z]);
        if (clear) start = [x, z];
      }
    }
    expect(start).not.toBeNull();
    const jump = MOVE_BUDGET_CAP_M * 1.05;
    const plain = createMoveTracker({ space: "town", pos: start!, heading: 0 }, 0);
    expect(validateMove(plain, { space: "town", pos: [start![0] + jump, start![1]], heading: 0 }, 0)).toEqual({ ok: false, reason: "speed" });
    const fed = createMoveTracker({ space: "town", pos: start!, heading: 0 }, 0);
    fed.speedFactor = walkSpeedFactor(addBuff([], "bread", getItem("bread")!.buff!, 0), 0);
    // The cap refills to the buffed size, then the jump fits.
    expect(validateMove(fed, { space: "town", pos: start!, heading: 0 }, 2000).ok).toBe(true);
    expect(validateMove(fed, { space: "town", pos: [start![0] + jump, start![1]], heading: 0 }, 2000).ok).toBe(true);
    // A forged factor is clamped.
    const forged = createMoveTracker({ space: "town", pos: start!, heading: 0 }, 0);
    forged.speedFactor = 100;
    validateMove(forged, { space: "town", pos: start!, heading: 0 }, 60_000);
    expect(forged.budget).toBeLessThanOrEqual(MOVE_BUDGET_CAP_M * 1.5 + 1e-9);

    const walker = new PlayerController({ space: "town", pos: start!, heading: 0 });
    walker.speedFactor = 1.1;
    walker.setInput([1, 0], true);
    walker.update(0.5);
    expect(walker.state.pos[0] - start![0]).toBeCloseTo(RUN_SPEED_MPS * 1.1 * 0.5, 1);
  });
});

describe("fishing luck in the cast roll (build plan M29)", () => {
  it("makes rare fish likelier and leaves the species set alone", () => {
    const conditions: FishingConditions = { timeOfDay: "night", weather: "rain", spot: "dock" };
    const plain = castTable(conditions, 0);
    const lucky = castTable(conditions, 0, 0.2);
    expect(lucky.map((e) => e.value)).toEqual(plain.map((e) => e.value));
    const share = (t: typeof plain, pick: (w: (typeof plain)[number]) => boolean) => t.filter(pick).reduce((n, e) => n + e.weight, 0) / t.reduce((n, e) => n + e.weight, 0);
    const rareIds = new Set(plain.filter((e, i) => lucky[i]!.weight / e.weight > 1.9).map((e) => e.value));
    expect(rareIds.size).toBeGreaterThan(0);
    expect(share(lucky, (e) => rareIds.has(e.value))).toBeGreaterThan(share(plain, (e) => rareIds.has(e.value)));
    expect(castTable(conditions, 0, Number.NaN)).toEqual(plain);
  });
});

describe("eating from the hotbar (build plan M29)", () => {
  const slots: SlotEntry[] = [
    { slot: 0, itemId: "bread", qty: 5 },
    { slot: H, itemId: "bread", qty: 2 },
    { slot: H + 1, itemId: "fishing_rod", qty: 1 },
    { slot: H + 2, itemId: "coffee", qty: 1 },
  ];

  it("takes one from the hotbar stack itself", () => {
    const bite = judgeEat(slots, H);
    expect(bite).toMatchObject({ ok: true, itemId: "bread", changed: [H] });
    if (!bite.ok) return;
    expect(bite.slots.find((s) => s.slot === H)?.qty).toBe(1);
    expect(bite.slots.find((s) => s.slot === 0)?.qty).toBe(5);
    const last = judgeEat(slots, H + 2);
    expect(last.ok && last.slots.some((s) => s.slot === H + 2)).toBe(false);
  });

  it("refuses bag slots, empty slots and things that are not food", () => {
    expect(judgeEat(slots, 0)).toEqual({ ok: false, reason: "not_hotbar" });
    expect(judgeEat(slots, H + 3)).toEqual({ ok: false, reason: "empty_slot" });
    expect(judgeEat(slots, H + 1)).toEqual({ ok: false, reason: "not_food" });
    expect(judgeEat(slots, 99)).toEqual({ ok: false, reason: "not_hotbar" });
  });

  it("counts what was eaten per in-game day", () => {
    let log = recordEaten(null, "cake", 10);
    log = recordEaten(log, "cake", 10);
    expect(eatenToday(log, "cake", 10)).toBe(2);
    expect(eatenToday(log, "cake", 11)).toBe(0);
    log = recordEaten(log, "cake", 11);
    expect(log).toEqual({ day: 11, counts: { cake: 1 } });
  });

  it("makes the Doctor scold after three cakes (an NPC context flag)", () => {
    let log = null;
    for (let i = 0; i < CAKE_SCOLD_COUNT - 1; i++) log = recordEaten(log, "cake", 10);
    expect(eatingFlags("doctor", log, 10)).toEqual([]);
    log = recordEaten(log, "cake", 10);
    const flags = eatingFlags("doctor", log, 10);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/3 cakes today/);
    // Only the Doctor scolds, and only on that day.
    expect(eatingFlags("doctor", log, 11)).toEqual([]);
    expect(eatingFlags("mayor", log, 10)).toEqual([]);
    // The Baker notices the baking, and the flag reaches the prompt.
    expect(eatingFlags("baker", log, 10)).toEqual(["the player ate your cake today"]);
    const ctx = { ...npcContextFixture({ npcId: "doctor", lang: "es", playerLevel: "A2" }), flags };
    expect(buildNpcTurnVariables(ctx, player).context_flags).toMatch(/3 cakes today/);
  });

  it("only accepts a hotbar slot index over the wire", () => {
    expect(parseClientMessage(ClientMessage.FoodEat, { slot: H }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.FoodEat, { slot: 30 }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.FoodEat, { slot: H, itemId: "cake" }).ok).toBe(false);
  });
});

describe("the coffee's extra reply hint (build plan M29)", () => {
  it("asks the model for one more suggestion", () => {
    const ctx = npcContextFixture({ lang: "es", playerLevel: "A2" });
    const plain = buildNpcTurnVariables(ctx, player).num_suggestions as number;
    expect(buildNpcTurnVariables({ ...ctx, extraHints: 1 }, player).num_suggestions).toBe(plain + 1);
    expect(buildNpcTurnVariables({ ...ctx, extraHints: 7 }, player).num_suggestions).toBe(plain + 1);
  });
});

describe("seats (build plan M29)", () => {
  it("puts two places on every town bench and one on each café chair", () => {
    const town = spaceSeats("town");
    expect(town.length).toBeGreaterThanOrEqual(8);
    expect(town.length % 2).toBe(0);
    expect(spaceSeats("cafe").length).toBe(4);
    expect(new Set(allSeats().map((s) => s.id)).size).toBe(allSeats().length);
    for (const s of allSeats()) {
      expect(parseClientMessage(ClientMessage.SeatSit, { seatId: s.id }).ok).toBe(true);
      expect(isLabelKey(s.labelKey)).toBe(true);
    }
  });

  it("can be reached from walkable ground, and square benches face the fountain", () => {
    for (const s of allSeats()) {
      const grid = spaceGrid(s.space);
      let reachable = false;
      for (let dx = -SEAT_REACH_M; dx <= SEAT_REACH_M && !reachable; dx += 0.1) {
        for (let dz = -SEAT_REACH_M; dz <= SEAT_REACH_M && !reachable; dz += 0.1) {
          if (Math.hypot(dx, dz) <= SEAT_REACH_M - 0.05 && circleFits(grid, [s.pos[0] + dx, s.pos[1] + dz])) reachable = true;
        }
      }
      expect(reachable, s.id).toBe(true);
    }
    const fountain: Vec2 = [37, 46];
    for (const s of spaceSeats("town").filter((t) => Math.hypot(t.pos[0] - fountain[0], t.pos[1] - fountain[1]) < 9)) {
      const toFountain = [fountain[0] - s.pos[0], fountain[1] - s.pos[1]];
      expect(Math.sin(s.facing) * toFountain[0]! + Math.cos(s.facing) * toFountain[1]!, s.id).toBeGreaterThan(0);
    }
  });

  it("are judged against the server's walker and who sits where", () => {
    const seat = spaceSeats("town")[0]!;
    const near: Vec2 = [seat.pos[0] + 0.8, seat.pos[1]];
    expect(nearestSeat("town", near)?.id).toBeDefined();
    expect(judgeSit(seat.id, "town", near, false, false)).toEqual({ ok: true, seat });
    expect(judgeSit(seat.id, "town", [seat.pos[0] + 3, seat.pos[1]], false, false)).toEqual({ ok: false, reason: "too_far" });
    expect(judgeSit(seat.id, "town", near, true, false)).toEqual({ ok: false, reason: "taken" });
    expect(judgeSit(seat.id, "town", near, false, true)).toEqual({ ok: false, reason: "busy" });
    expect(judgeSit(seat.id, "cafe", near, false, false)).toEqual({ ok: false, reason: "unknown_seat" });
    expect(judgeSit("bench-999a", "town", near, false, false)).toEqual({ ok: false, reason: "unknown_seat" });
    expect(getSeat("cafe-chair-0")?.space).toBe("cafe");
  });
});

describe("cooking in the apartment kitchen (build plan M29)", () => {
  it("has a kitchen interactable at the nook, reachable from the door", () => {
    const kitchen = spaceInteractables("apartment").find((i) => i.kind === "kitchen")!;
    expect(kitchen.spot).toEqual(kitchenSpot());
    expect(atKitchen("apartment", kitchenSpot())).toBe(true);
    expect(atKitchen("apartment", [kitchenSpot()[0] + KITCHEN_REACH_M + 0.2, kitchenSpot()[1]])).toBe(false);
    expect(atKitchen("cafe", kitchenSpot())).toBe(false);
    const walker = new PlayerController(interiorArrivalPoint("apartment"));
    expect(walker.clickTo(kitchen.spot)).toBe(true);
    for (let k = 0; k < 600 && walker.waypoints; k++) walker.update(1 / 60);
    expect(nearestInteractable("apartment", walker.state.pos)?.kind).toBe("kitchen");
  });

  it("every recipe has 2–3 ingredient lines and a method", () => {
    for (const r of RECIPES) {
      expect(r.ingredients.length).toBeGreaterThanOrEqual(2);
      expect(r.ingredients.length).toBeLessThanOrEqual(3);
      expect(r.steps.length).toBeGreaterThan(0);
      expect(ITEMS[r.result].category).toMatch(/food|drink|remedy/);
    }
  });

  it("plans ingredients, taking the cheapest fish for an 'any fish' line", () => {
    const stew = getRecipe("fish_stew")!;
    const counts = itemCounts([
      { slot: 0, itemId: "potato", qty: 1 },
      { slot: 1, itemId: "carrot", qty: 1 },
      { slot: 2, itemId: "sturgeon", qty: 1 },
      { slot: 3, itemId: "minnow", qty: 3 },
    ]);
    const plan = planCooking(stew, counts);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.uses.find((u) => ITEMS[u.itemId].category === "fish")?.itemId).toBe("minnow");
    const short = planCooking(stew, { potato: 1 });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.missing).toHaveLength(2);
  });

  it("acceptance: learn bread from the Baker, cook it, eat it, and the buff runs and expires", () => {
    // The Baker's teachRecipe is accepted (0 hearts needed) and goes into the book.
    const verdict = validateNpcActions([{ type: "teachRecipe", recipeId: "bread" }], {
      npcId: "baker",
      hearts: 0,
      inventory: {},
      knownRecipes: [],
      questsOffered: [],
      questsCompletable: [],
      conversation: emptyConversationLedger(),
      daily: emptyDailyLedger(),
    });
    expect(verdict.effects.recipes).toEqual(["bread"]);
    const t0 = 5_000_000;
    const { book, learned } = learnRecipes(emptyRecipeBook(), verdict.effects.recipes, "baker", "es", t0);
    expect(learned).toEqual(["bread"]);
    expect(knownRecipeIds(book)).toEqual(["bread"]);
    // Once known, the Baker cannot teach it again.
    const again = validateNpcActions([{ type: "teachRecipe", recipeId: "bread" }], {
      npcId: "baker", hearts: 0, inventory: {}, knownRecipes: knownRecipeIds(book), questsOffered: [], questsCompletable: [], conversation: emptyConversationLedger(), daily: emptyDailyLedger(),
    });
    expect(again.rejected).toEqual([{ type: "teachRecipe", reason: "already_known" }]);

    // Cook: 2 flour + 1 milk → 1 bread.
    const slots: SlotEntry[] = [
      { slot: 0, itemId: "flour", qty: 2 },
      { slot: 1, itemId: "milk", qty: 1 },
    ];
    expect(cookRecipe(slots, emptyRecipeBook(), "bread")).toEqual({ ok: false, reason: "not_known" });
    expect(cookRecipe([{ slot: 0, itemId: "flour", qty: 1 }], book, "bread")).toMatchObject({ ok: false, reason: "missing_ingredients" });
    expect(cookRecipe(slots, book, "omelette_x")).toEqual({ ok: false, reason: "unknown_recipe" });
    const cooked = cookRecipe(slots, book, "bread");
    expect(cooked.ok).toBe(true);
    if (!cooked.ok) return;
    expect(cooked.slots).toEqual([{ slot: 0, itemId: "bread", qty: 1 }]);
    expect(cooked.book.known.bread?.cooked).toBe(1);

    // Eat it from the hotbar: the walk-speed buff runs for 5 minutes, then expires.
    const hotbar = cooked.slots.map((s) => ({ ...s, slot: H }));
    const bite = judgeEat(hotbar, H);
    expect(bite).toMatchObject({ ok: true, itemId: "bread" });
    if (!bite.ok) return;
    const { buff } = eatEffects(bite.itemId);
    const buffs = addBuff([], bite.itemId, buff!, t0);
    expect(activeBuffs(buffs, t0 + 1000)).toEqual([{ kind: "walk_speed", amount: 0.1, itemId: "bread", startedMs: t0, expiresMs: t0 + 5 * MIN }]);
    expect(walkSpeedFactor(buffs, t0 + 1000)).toBeCloseTo(1.1);
    expect(activeBuffs(buffs, t0 + 5 * MIN + 1)).toEqual([]);
  });

  it("refuses a dish with no room in the bag", () => {
    const full: SlotEntry[] = Array.from({ length: 30 }, (_, slot) => ({ slot, itemId: "fishing_rod" as const, qty: 1 }));
    full[0] = { slot: 0, itemId: "egg", qty: 2 };
    full[1] = { slot: 1, itemId: "onion", qty: 2 };
    const book = learnRecipes(emptyRecipeBook(), ["omelette"], "farmer", "es", 0).book;
    // The eggs' slot empties, so the omelette fits there.
    expect(cookRecipe(full, book, "omelette").ok).toBe(true);
    full[0] = { slot: 0, itemId: "egg", qty: 3 };
    expect(cookRecipe(full, book, "omelette")).toEqual({ ok: false, reason: "bag_full" });
  });
});

describe("recipe cards (build plan M29)", () => {
  it("are made only of world labels, so they read in the target language", () => {
    for (const r of RECIPES) {
      const card = recipeCard(r.id);
      for (const key of [card.titleKey, ...card.lines.map((l) => l.labelKey), ...card.steps]) expect(isLabelKey(key), key).toBe(true);
    }
    expect(recipeCard("bread")).toEqual({
      recipeId: "bread",
      titleKey: "item.bread",
      lines: [
        { labelKey: "item.flour", qty: 2 },
        { labelKey: "item.milk", qty: 1 },
      ],
      steps: ["recipe.step.mix", "recipe.step.knead", "recipe.step.bake"],
    });
    expect(recipeCard("fish_stew").lines[0]!.labelKey).toBe("recipe.group.fish");
    for (const [key, word] of Object.entries(recipeCardLabels())) expect(LABEL_REGISTRY[key]).toBe(word);
  });
});
