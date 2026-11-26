import { describe, expect, it } from "vitest";
import { getItem, ITEMS } from "../data/items";
import { getFish } from "../data/fish";
import { getNpc } from "../data/npcs";
import { getForage } from "../data/forage";
import { getRecipe } from "../data/recipes";
import { CachedLineSchema, QuestLogDocSchema } from "../firestore/schemas";
import { questNoticePrompt } from "../ai/prompts";
import { parseTaskAnswer } from "../ai/schemas";
import { emptyConversationLedger, emptyDailyLedger, validateNpcActions } from "../npc/actions";
import { buildNpcTurnVariables } from "../npc/prompt";
import { npcContextFixture } from "../npc/fixtures";
import { QUEST_COMPLETION_HEARTS } from "../npc/friendship";
import { HOTBAR_FIRST_SLOT, type SlotEntry } from "../npc/inventory";
import { parseClientMessage } from "../protocol/schemas";
import { ClientMessage } from "../protocol/messages";
import { isLabelKey } from "../world/labels";
import {
  acceptQuest,
  applyQuestEvent,
  BOARD_NPC,
  BOARD_SIZE,
  baseQuestReward,
  canCompleteQuest,
  dailyBoard,
  deadlinePassed,
  emptyQuestLog,
  expireQuests,
  getQuestTemplate,
  minutesIntoDay,
  noticeFromCachedLine,
  noticeToCachedLine,
  npcOfferBy,
  npcOffers,
  NPC_OFFERS_PER_DAY,
  parseQuestId,
  type Quest,
  QUEST_KINDS,
  QUEST_TEMPLATES,
  questBriefs,
  questById,
  questCard,
  questFacts,
  questIdFor,
  questLogFor,
  questNoticeLevel,
  questNoticePlayerMaterial,
  questNoticeSeedMaterial,
  questsCompletableWith,
  questsOfDay,
  questsOfferedBy,
  questView,
  questViews,
  settleQuest,
  turnInNpc,
  type QuestClock,
  type QuestLog,
} from "./index";

const UID = "lia";
const DAY = 512;
/** 09:00 in-game (the day starts at 06:00). */
const MORNING: QuestClock = { day: DAY, minutes: 9 * 60, nowMs: 1_000 };
const quest = (templateId: string, source: Quest["source"] = "board"): Quest => {
  const template = getQuestTemplate(templateId)!;
  return { questId: questIdFor(DAY, templateId), day: DAY, source, template, reward: baseQuestReward(template) };
};
const accept = (log: QuestLog, q: Quest, npc: Parameters<typeof acceptQuest>[2] = null, clock = MORNING) => {
  const r = acceptQuest(log, q, npc, clock);
  if (!r.ok) throw new Error(`accept refused: ${r.reason}`);
  return r.log;
};
const slots = (...entries: [string, number][]): SlotEntry[] => entries.map(([itemId, qty], slot) => ({ slot, itemId: itemId as SlotEntry["itemId"], qty }));
const wallet = (s: SlotEntry[], coins = 0, hearts = 0) => ({ coins, hearts, slots: s });

describe("quest templates (catalog)", () => {
  it("uses only real items, fish, recipes, forage kinds and villagers, with unique ids", () => {
    const ids = QUEST_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of QUEST_TEMPLATES) {
      expect(getNpc(t.giver), t.id).toBeDefined();
      const target = t.target as { kind: string; itemId?: string; fishId?: string; recipeId?: string; to?: string; by?: string; forageKind?: string; qty: number };
      expect(target.qty, t.id).toBeGreaterThan(0);
      if (target.itemId) expect(getItem(target.itemId), t.id).toBeDefined();
      if (target.fishId) expect(getFish(target.fishId), t.id).toBeDefined();
      if (target.recipeId) expect(getRecipe(target.recipeId)?.heartsRequired, t.id).toBe(0);
      if (target.to) expect(target.to).not.toBe(t.giver);
      if (target.by) expect(target.by).toMatch(/^\d\d:\d\d$/);
      // Ids are part of quest ids and cache keys.
      expect(t.id).toMatch(/^[a-z0-9_]{1,48}$/);
    }
    // Every kind has at least two templates, so the board can vary.
    for (const kind of QUEST_KINDS) expect(QUEST_TEMPLATES.filter((t) => t.target.kind === kind).length, kind).toBeGreaterThanOrEqual(2);
    // The GDD's example request.
    expect(getQuestTemplate("eggs_to_bakery")?.target).toEqual({ kind: "deliver", itemId: "egg", qty: 3, to: "baker", by: "12:00" });
  });

  it("pays more than the items are worth, plus a heart with the requester", () => {
    for (const t of QUEST_TEMPLATES) {
      const reward = baseQuestReward(t);
      expect(reward.hearts).toBe(QUEST_COMPLETION_HEARTS);
      const target = t.target as { itemId?: string; qty: number };
      const worth = target.itemId ? (ITEMS[target.itemId as keyof typeof ITEMS].basePrice ?? 0) * target.qty : 0;
      expect(reward.coins, t.id).toBeGreaterThan(worth);
    }
  });

  it("hands deliveries to the recipient and fetches to the requester; the rest complete on their own", () => {
    expect(turnInNpc(getQuestTemplate("eggs_to_bakery")!)).toBe("baker");
    expect(turnInNpc(getQuestTemplate("herbs_for_doctor")!)).toBe("doctor");
    expect(turnInNpc(getQuestTemplate("two_fish_for_elder")!)).toBeNull();
    expect(questFacts(getQuestTemplate("eggs_to_bakery")!)).toEqual({ kind: "deliver", who: "Farmer", what: "egg", quantity: 3, where: "deliver to the Baker", deadline: "before 12:00" });
  });
});

describe("daily board and favours (seeded per player per in-game day)", () => {
  it("gives every player 3 board requests of different kinds, the same after a restart, new the next day", () => {
    const board = dailyBoard(UID, "es", DAY);
    expect(board).toHaveLength(BOARD_SIZE);
    expect(new Set(board.map((q) => q.template.target.kind)).size).toBe(BOARD_SIZE);
    expect(board.every((q) => q.source === "board" && q.day === DAY && q.questId === questIdFor(DAY, q.template.id))).toBe(true);
    expect(dailyBoard(UID, "es", DAY)).toEqual(board);
    // Different days, players and languages get different boards (over a week at least one differs).
    const ids = (b: Quest[]) => b.map((q) => q.template.id).join();
    expect(Array.from({ length: 7 }, (_, i) => ids(dailyBoard(UID, "es", DAY + 1 + i))).some((x) => x !== ids(board))).toBe(true);
    expect(Array.from({ length: 7 }, (_, i) => ids(dailyBoard(`p${i}`, "es", DAY))).some((x) => x !== ids(board))).toBe(true);
  });

  it("sometimes adds furniture to a board request", () => {
    const bonuses = Array.from({ length: 60 }, (_, d) => dailyBoard(UID, "es", d)).flat().filter((q) => q.reward.itemId);
    expect(bonuses.length).toBeGreaterThan(0);
    for (const q of bonuses) expect(getItem(q.reward.itemId!)?.category).toBe("furniture");
  });

  it("has two villagers (never the Mayor) ask for a favour that is not on the board", () => {
    for (let d = 0; d < 30; d++) {
      const offers = npcOffers(UID, "es", d);
      const board = dailyBoard(UID, "es", d).map((q) => q.template.id);
      expect(offers).toHaveLength(NPC_OFFERS_PER_DAY);
      expect(new Set(offers.map((q) => q.template.giver)).size).toBe(NPC_OFFERS_PER_DAY);
      for (const q of offers) {
        expect(q.source).toBe("npc");
        expect(q.template.giver).not.toBe(BOARD_NPC);
        expect(board).not.toContain(q.template.id);
        expect(npcOfferBy(UID, "es", d, q.template.giver)).toEqual(q);
      }
    }
  });

  it("resolves only this player's quest ids of that day", () => {
    const [q] = dailyBoard(UID, "es", DAY);
    expect(questById(UID, "es", q!.questId)).toEqual(q);
    expect(parseQuestId(q!.questId)).toEqual({ day: DAY, templateId: q!.template.id });
    expect(parseQuestId("q12-free_hearts")).toBeNull();
    expect(parseQuestId("eggs_to_bakery")).toBeNull();
    const notMine = QUEST_TEMPLATES.find((t) => !questsOfDay(UID, "es", DAY).some((x) => x.template.id === t.id))!;
    expect(questById(UID, "es", questIdFor(DAY, notMine.id))).toBeNull();
  });
});

describe("accepting", () => {
  it("takes a board request at the board or from the Mayor, a favour only from its villager", () => {
    const board = quest("eggs_to_bakery", "board");
    const favour = quest("herbs_for_doctor", "npc");
    expect(acceptQuest(null, board, null, MORNING)).toMatchObject({ ok: true });
    expect(acceptQuest(null, board, "mayor", MORNING)).toMatchObject({ ok: true, log: { entries: { [board.questId]: { status: "active", via: "board" } } } });
    expect(acceptQuest(null, board, "baker", MORNING)).toEqual({ ok: false, reason: "wrong_npc" });
    expect(acceptQuest(null, favour, null, MORNING)).toEqual({ ok: false, reason: "wrong_npc" });
    expect(acceptQuest(null, favour, "mayor", MORNING)).toEqual({ ok: false, reason: "wrong_npc" });
    expect(acceptQuest(null, favour, "doctor", MORNING)).toMatchObject({ ok: true, log: { entries: { [favour.questId]: { via: "npc" } } } });
  });

  it("refuses twice, after the deadline, another day's quest and a full log", () => {
    const q = quest("eggs_to_bakery");
    const log = accept(emptyQuestLog(DAY), q);
    expect(acceptQuest(log, q, null, MORNING)).toEqual({ ok: false, reason: "already_accepted" });
    expect(acceptQuest(null, q, null, { ...MORNING, minutes: 12 * 60 })).toEqual({ ok: false, reason: "too_late" });
    expect(acceptQuest(null, q, null, { ...MORNING, day: DAY + 1 })).toEqual({ ok: false, reason: "unknown_quest" });
    expect(acceptQuest(null, null, null, MORNING)).toEqual({ ok: false, reason: "unknown_quest" });
    let full = emptyQuestLog(DAY);
    for (const id of ["herbs_for_doctor", "berries_for_baker", "daisies_for_mayor", "mushrooms_for_elder", "shell_for_gossip"]) full = accept(full, quest(id));
    expect(acceptQuest(full, quest("mint_for_barista"), null, MORNING)).toEqual({ ok: false, reason: "too_many" });
  });

  it("starts a new log each in-game day (open quests expire, the counts stay)", () => {
    const log: QuestLog = { ...accept(emptyQuestLog(DAY), quest("bake_bread")), completed: { cook: 2 } };
    expect(questLogFor(log, DAY + 1)).toEqual({ day: DAY + 1, entries: {}, completed: { cook: 2 } });
    expect(questLogFor(null, DAY)).toEqual(emptyQuestLog(DAY));
  });
});

describe("deadlines", () => {
  it("counts the day from 06:00, so a 12:00 delivery is late at noon and stays late overnight", () => {
    const q = quest("eggs_to_bakery");
    expect(minutesIntoDay(6 * 60)).toBe(0);
    expect(minutesIntoDay(2 * 60)).toBe(20 * 60);
    expect(deadlinePassed(q, 11 * 60 + 59)).toBe(false);
    expect(deadlinePassed(q, 12 * 60)).toBe(true);
    expect(deadlinePassed(q, 3 * 60)).toBe(true);
    expect(deadlinePassed(quest("herbs_for_doctor"), 5 * 60)).toBe(false);
    const log = accept(emptyQuestLog(DAY), q);
    expect(expireQuests(log, [q], { ...MORNING, minutes: 13 * 60 }).entries[q.questId]?.status).toBe("expired");
    expect(expireQuests(log, [q], MORNING)).toBe(log);
  });
});

describe("progress from server events (automatic kinds)", () => {
  it("counts catches, dishes and finds only after accepting, and only matching ones", () => {
    const fish = quest("carp_for_farmer");
    const anyFish = quest("two_fish_for_elder");
    const cook = quest("bake_bread");
    const find = quest("find_flowers");
    const deliver = quest("eggs_to_bakery");
    const all = [fish, anyFish, cook, find, deliver];
    // Before accepting nothing counts.
    expect(applyQuestEvent(emptyQuestLog(DAY), all, { type: "caught", fishId: "carp" }, DAY).moved).toEqual([]);
    let log = emptyQuestLog(DAY);
    for (const q of all) log = accept(log, q);
    let r = applyQuestEvent(log, all, { type: "caught", fishId: "perch" }, DAY);
    expect(r).toMatchObject({ moved: [anyFish.questId], ready: [] });
    r = applyQuestEvent(r.log, all, { type: "caught", fishId: "carp" }, DAY);
    expect(r).toMatchObject({ moved: [fish.questId, anyFish.questId], ready: [fish.questId, anyFish.questId] });
    r = applyQuestEvent(r.log, all, { type: "cooked", recipeId: "omelette" }, DAY);
    expect(r.moved).toEqual([]);
    r = applyQuestEvent(r.log, all, { type: "cooked", recipeId: "bread" }, DAY);
    expect(r.ready).toEqual([cook.questId]);
    r = applyQuestEvent(r.log, all, { type: "found", itemId: "daisy" }, DAY);
    expect(r).toMatchObject({ moved: [find.questId], ready: [] });
    r = applyQuestEvent(r.log, all, { type: "found", itemId: "river_shell" }, DAY);
    expect(r.moved).toEqual([]);
    r = applyQuestEvent(r.log, all, { type: "found", itemId: "poppy" }, DAY);
    expect(r.ready).toEqual([find.questId]);
    expect(r.log.entries[find.questId]?.progress).toBe(2);
    // Deliveries never move on events; a forged fish id never counts.
    expect(r.log.entries[deliver.questId]?.progress).toBe(0);
    expect(applyQuestEvent(r.log, all, { type: "caught", fishId: "dragon" }, DAY).moved).toEqual([]);
  });
});

describe("completing and settling", () => {
  const clock = MORNING;

  it("deliver: only at the recipient, with the items, before the deadline; pays coins and a heart and takes the items", () => {
    const q = quest("eggs_to_bakery");
    const log = accept(emptyQuestLog(DAY), q);
    const bag = slots(["egg", 3], ["bread", 1]);
    const inv = { egg: 3 };
    expect(canCompleteQuest(q, undefined, { npcId: "baker", inventory: inv, minutes: clock.minutes })).toEqual({ ok: false, reason: "not_active" });
    expect(canCompleteQuest(q, log.entries[q.questId], { npcId: "farmer", inventory: inv, minutes: clock.minutes })).toEqual({ ok: false, reason: "wrong_npc" });
    expect(canCompleteQuest(q, log.entries[q.questId], { npcId: "baker", inventory: { egg: 2 }, minutes: clock.minutes })).toEqual({ ok: false, reason: "missing_items" });
    expect(canCompleteQuest(q, log.entries[q.questId], { npcId: "baker", inventory: inv, minutes: 12 * 60 + 5 })).toEqual({ ok: false, reason: "too_late" });
    const done = settleQuest(log, q, "baker", wallet(bag, 10, 2), { ...clock, nowMs: 5000 });
    expect(done).toMatchObject({ ok: true, coins: 10 + q.reward.coins, hearts: 3, heartsDelta: 1, slots: [{ slot: 1, itemId: "bread", qty: 1 }] });
    if (!done.ok) throw new Error("not settled");
    expect(done.log.entries[q.questId]).toMatchObject({ status: "completed", completedMs: 5000 });
    expect(done.log.completed).toEqual({ deliver: 1 });
    // Once only.
    expect(settleQuest(done.log, q, "baker", wallet(bag), clock)).toEqual({ ok: false, reason: "not_active" });
  });

  it("fetch: at the requester; hearts stay within 10; a bonus item needs room in the bag", () => {
    const q: Quest = { ...quest("herbs_for_doctor"), reward: { ...baseQuestReward(getQuestTemplate("herbs_for_doctor")!), itemId: "potted_plant" } };
    const log = accept(emptyQuestLog(DAY), q);
    const done = settleQuest(log, q, "doctor", wallet(slots(["wild_herb", 2]), 0, 9.5), clock);
    expect(done).toMatchObject({ ok: true, hearts: 10, heartsDelta: 0.5, slots: [{ itemId: "potted_plant", qty: 1 }] });
    const full: SlotEntry[] = Array.from({ length: 30 }, (_, slot) => ({ slot, itemId: slot === 0 ? "wild_herb" : "bread", qty: slot === 0 ? 3 : 99 }));
    expect(settleQuest(log, q, "doctor", wallet(full), clock)).toEqual({ ok: false, reason: "inventory_full" });
  });

  it("automatic kinds: complete only when ready, with no NPC and no items taken", () => {
    const q = quest("bake_bread");
    let log = accept(emptyQuestLog(DAY), q);
    expect(settleQuest(log, q, null, wallet([]), clock)).toEqual({ ok: false, reason: "not_ready" });
    log = applyQuestEvent(log, [q], { type: "cooked", recipeId: "bread" }, DAY).log;
    const bag = slots(["bread", 1]);
    expect(settleQuest(log, q, null, wallet(bag), clock)).toMatchObject({ ok: true, coins: q.reward.coins, slots: bag });
  });

  it("feeds the NPC turn: offered favours (giveQuest) and completable hand-ins (completeQuest)", () => {
    const board = dailyBoard(UID, "es", DAY);
    const offers = npcOffers(UID, "es", DAY);
    const all = [...board, ...offers];
    const favour = offers[0]!;
    const giver = favour.template.giver;
    // The Mayor hands out the board; a villager only their favour.
    expect(questsOfferedBy("mayor", all, emptyQuestLog(DAY), MORNING).sort()).toEqual(board.filter((q) => !deadlinePassed(q, MORNING.minutes)).map((q) => q.questId).sort());
    expect(questsOfferedBy(giver, all, emptyQuestLog(DAY), MORNING)).toEqual([favour.questId]);
    // The model may hand it out; then it is active and no longer offered.
    const verdict = validateNpcActions([{ type: "giveQuest", questId: favour.questId }, { type: "giveQuest", questId: "q1-free_hearts" }], {
      npcId: giver,
      hearts: 0,
      inventory: {},
      knownRecipes: [],
      questsOffered: questsOfferedBy(giver, all, emptyQuestLog(DAY), MORNING),
      questsCompletable: [],
      conversation: emptyConversationLedger(),
      daily: emptyDailyLedger(),
    });
    expect(verdict.effects.questsGiven).toEqual([favour.questId]);
    expect(verdict.rejected).toEqual([{ type: "giveQuest", reason: "unknown_quest" }]);
    const log = accept(emptyQuestLog(DAY), favour, giver);
    expect(questsOfferedBy(giver, all, log, MORNING)).toEqual([]);
    const briefs = questBriefs(giver, all, log, {}, MORNING);
    expect(briefs.find((b) => b.questId === favour.questId)).toMatchObject({ status: "active", role: "asked" });
    // A completable delivery shows up for its recipient only, with the items held.
    const eggs = quest("eggs_to_bakery");
    const eggLog = accept(emptyQuestLog(DAY), eggs);
    expect(questsCompletableWith("baker", [eggs], eggLog, { egg: 3 }, MORNING)).toEqual([eggs.questId]);
    expect(questsCompletableWith("farmer", [eggs], eggLog, { egg: 3 }, MORNING)).toEqual([]);
    expect(questsCompletableWith("baker", [eggs], eggLog, { egg: 1 }, MORNING)).toEqual([]);
    expect(questBriefs("baker", [eggs], eggLog, { egg: 3 }, MORNING)).toEqual([
      { questId: eggs.questId, status: "active", role: "receives", summary: "Farmer wants 3 × egg, deliver to the Baker, before 12:00", canComplete: true },
    ]);
    // …and reaches the prompt as quests_json.
    const ctx = { ...npcContextFixture({ npcId: "baker", lang: "es", playerLevel: "A1" }), quests: questBriefs("baker", [eggs], eggLog, { egg: 3 }, MORNING) };
    expect(buildNpcTurnVariables(ctx, { name: "Lia", animal: "otter", apartmentId: "3A" }).quests_json).toContain(`"canComplete":true`);
  });

  it("views: open, active (with progress), completed and expired", () => {
    const eggs = quest("eggs_to_bakery");
    const fish = quest("two_fish_for_elder");
    let log = accept(emptyQuestLog(DAY), fish);
    log = applyQuestEvent(log, [fish], { type: "caught", fishId: "minnow" }, DAY).log;
    expect(questView(eggs, log, MORNING)).toMatchObject({ status: "open", progress: 0, turnIn: "baker" });
    expect(questView(eggs, log, { ...MORNING, minutes: 14 * 60 })).toMatchObject({ status: "expired" });
    expect(questView(fish, log, MORNING)).toMatchObject({ status: "active", progress: 1, turnIn: null });
    const views = questViews([eggs, { ...fish, source: "npc" }], log, MORNING);
    expect(views.board.map((v) => v.templateId)).toEqual(["eggs_to_bakery"]);
    expect(views.log.map((v) => v.templateId)).toEqual(["two_fish_for_elder"]);
  });
});

describe("notices and quest cards", () => {
  it("keys notices per template × target language × level band (seeded) and per native language (player)", () => {
    expect(questNoticeLevel("A2+")).toBe("A1");
    expect(questNoticeLevel("B2")).toBe("B1");
    expect(questNoticeSeedMaterial("eggs_to_bakery", "es", "A1")).toBe(questNoticeSeedMaterial("eggs_to_bakery", "es", "A2+"));
    expect(questNoticeSeedMaterial("eggs_to_bakery", "es", "A1")).not.toBe(questNoticeSeedMaterial("eggs_to_bakery", "es", "B1"));
    expect(questNoticeSeedMaterial("eggs_to_bakery", "es", "A1")).not.toBe(questNoticeSeedMaterial("eggs_to_bakery", "ja", "A1"));
    expect(questNoticePlayerMaterial("eggs_to_bakery", "es", "en", "A1")).not.toBe(questNoticePlayerMaterial("eggs_to_bakery", "es", "de", "A1"));
  });

  it("stores a notice as one seeded cache line and reads it back", () => {
    const notice = { title: { text: "¡Aviso!", translation: "Notice!" }, body: [{ text: "La granjera necesita 3 huevos.", translation: "The farmer needs 3 eggs." }, { text: "Antes de las 12:00.", translation: "Before 12:00." }] };
    const line = noticeToCachedLine(notice, "en");
    expect(CachedLineSchema.safeParse(line).success).toBe(true);
    expect(noticeFromCachedLine(line, "en")).toEqual(notice);
    expect(noticeFromCachedLine(line, "de")?.body[0]?.translation).toBe("");
    expect(noticeFromCachedLine({ text: "only a title" }, "en")).toBeNull();
  });

  it("builds the prompt from game data and validates the answer", () => {
    const prompt = questNoticePrompt({ targetLang: "es", nativeLang: "en", level: "A1", maxWords: 25, facts: { ...questFacts(getQuestTemplate("eggs_to_bakery")!) } });
    expect(prompt).toContain("in Spanish at CEFR A1");
    expect(prompt).toContain('"deadline":"before 12:00"');
    expect(prompt).not.toContain("{{");
    const answer = parseTaskAnswer("questNotice", JSON.stringify({ title: { text: " ¡Aviso! ", reading: "", translation: "Notice!" }, body: [{ text: "Tres huevos.", translation: null }, { text: "" }] }));
    expect(answer).toEqual({ title: { text: "¡Aviso!", translation: "Notice!" }, body: [{ text: "Tres huevos.", translation: "" }] });
    expect(() => parseTaskAnswer("questNotice", JSON.stringify({ title: { text: "x" }, body: [] }))).toThrow();
  });

  it("has a quest card made of world labels for every template", () => {
    for (const t of QUEST_TEMPLATES) {
      const card = questCard({ template: t });
      for (const key of [card.verbKey, card.whatKey, card.fromKey, ...(card.toKey ? [card.toKey] : [])]) expect(isLabelKey(key), `${t.id}: ${key}`).toBe(true);
      expect(card.qty).toBe(t.target.qty);
    }
    expect(questCard({ template: getQuestTemplate("eggs_to_bakery")! })).toEqual({ verbKey: "quest.kind.deliver", whatKey: "item.egg", qty: 3, fromKey: "npc.farmer", toKey: "npc.baker", by: "12:00" });
    expect(questCard({ template: getQuestTemplate("find_flowers")! }).whatKey).toBe("recipe.group.flower");
    expect(getForage("daisy")?.kind).toBe("flower");
  });
});

describe("wire formats", () => {
  it("validates quest messages and the stored log", () => {
    expect(parseClientMessage(ClientMessage.QuestAccept, { questId: "q512-eggs_to_bakery" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.QuestAccept, { questId: "eggs_to_bakery" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.QuestAccept, { questId: "q512-eggs_to_bakery", coins: 99 }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.QuestTurnIn, { conversationId: "c-1", questId: "q512-herbs_for_doctor" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.QuestTurnIn, { questId: "q512-herbs_for_doctor" }).ok).toBe(false);
    const ts = { seconds: 1, nanoseconds: 0 };
    const doc = { langs: { es: { day: DAY, entries: { "q512-bake_bread": { status: "active", progress: 0, accepted: ts, via: "board" } }, completed: { cook: 1 } } } };
    expect(QuestLogDocSchema.safeParse(doc).success).toBe(true);
    expect(QuestLogDocSchema.safeParse({ langs: { es: { ...doc.langs.es, completed: { heist: 1 } } } }).success).toBe(false);
    expect(HOTBAR_FIRST_SLOT).toBe(24);
  });
});
