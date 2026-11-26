import { describe, expect, it } from "vitest";
import { AMBIENT_BARKS_JSON_SCHEMA, ambientBarksPrompt, parseTaskAnswer } from "../ai/index";
import { NPC_IDS } from "../data/npcs";
import { VillageEventSchema, VillagePrivacySchema } from "../firestore/schemas";
import { elderSecretFlag, SECRET_SPOT_HEARTS } from "../fishing/spots";
import {
  ambientPromptInput,
  ambientSetPlayerMaterial,
  BARK_PAIRS,
  barkActivities,
  barkSpeakers,
  exchangeSeedMaterial,
  soloBarkSeedMaterial,
} from "../npc/ambient";
import { npcContextFixture } from "../npc/fixtures";
import { buildNpcTurnVariables } from "../npc/prompt";
import { parseClientMessage } from "../protocol/schemas";
import { ClientMessage } from "../protocol/messages";
import { WORLD_DAY_MS, WORLD_EPOCH_MS } from "../world/clock";
import {
  buildDigest,
  eventDedupeKey,
  nearestPlace,
  newsSeed,
  parseVillagePayload,
  requestDoneEvent,
  villageNewsFor,
  villageShardId,
  type VillageEventRecord,
} from "./events";

const day = (n: number, extraMs = 0) => WORLD_EPOCH_MS + n * WORLD_DAY_MS + extraMs;
const NOW = day(200, 60_000);

const carp: VillageEventRecord = { id: "e1", type: "fish_caught", actorName: "Lia", payload: { fishId: "golden_carp", rarity: "legendary", place: "fishing_dock" }, ts: NOW - 30_000 };
const anon: VillageEventRecord = { id: "e2", type: "forage_found", payload: { itemId: "crystal_pebble", rarity: "rare", place: "town_square" }, ts: day(199, 5_000) };
const hat: VillageEventRecord = { id: "e3", type: "lost_returned", actorName: "Kenji", payload: { itemId: "lost_hat", owner: "farmer" }, ts: day(198, 5_000) };
const old: VillageEventRecord = { id: "e4", type: "request_done", payload: { templateId: "eggs_to_bakery", kind: "deliver", npcId: "farmer" }, ts: day(150) };

describe("village memory (build plan M31)", () => {
  it("writes events as English seeds, with the name only when the player allows it", () => {
    expect(newsSeed(carp, NOW)).toBe("Lia caught a legendary golden carp at the fishing dock (today).");
    expect(newsSeed(anon, NOW)).toMatch(/^someone found a rare .* near the town square \(yesterday\)\.$/);
    expect(newsSeed(hat, NOW)).toBe("Kenji found the Farmer's lost straw hat and gave it back (2 days ago).");
    expect(newsSeed(old, NOW)).toContain("made a delivery for the Farmer");
  });

  it("batches the log into the Gossip's rumours and the Elder's legends", () => {
    const digest = buildDigest([old, hat, anon, carp], NOW);
    // Rumours: the last 3 in-game days, newest first; the old request is not news any more.
    expect(digest.rumours).toHaveLength(3);
    expect(digest.rumours[0]).toContain("golden carp");
    expect(digest.rumours.join(" ")).not.toContain("delivery");
    // Legends: rare and legendary finds only, the most notable first.
    expect(digest.legends).toHaveLength(2);
    expect(digest.legends[0]).toMatch(/^Legend seed: Lia caught a legendary golden carp/);
    expect(villageNewsFor("gossip", digest)).toBe(digest.rumours);
    expect(villageNewsFor("elder", digest)).toBe(digest.legends);
    expect(villageNewsFor("baker", digest)).toEqual([]);
    // Legends can come from other shards (the global log).
    const elsewhere: VillageEventRecord = { ...carp, id: "x9", actorName: "Ana", payload: { ...carp.payload, fishId: "rainbow_koi" } };
    expect(buildDigest([], NOW, [elsewhere]).legends[0]).toContain("Ana caught");
    expect(buildDigest([], NOW)).toMatchObject({ rumours: [], legends: [] });
  });

  it("puts the rumour into the Gossip's prompt as data", () => {
    const digest = buildDigest([carp], NOW);
    const ctx = { ...npcContextFixture({ npcId: "gossip", lang: "es", playerLevel: "A2" }), news: villageNewsFor("gossip", digest) };
    const vars = buildNpcTurnVariables(ctx, { name: "Mo", animal: "fox", apartmentId: "1A" });
    expect(String(vars.village_news)).toContain("golden carp");
    expect(vars.is_gossip).toBe(true);
  });

  it("validates payloads, stored events and the privacy document", () => {
    expect(parseVillagePayload("fish_caught", carp.payload)).toEqual({ type: "fish_caught", payload: carp.payload });
    expect(parseVillagePayload("fish_caught", { ...carp.payload, extra: 1 })).toBeNull();
    expect(parseVillagePayload("chat_line", {})).toBeNull();
    const ts = { seconds: 1, nanoseconds: 0 };
    expect(VillageEventSchema.safeParse({ type: "fish_caught", payload: carp.payload, ts, expiresAt: ts }).success).toBe(true);
    expect(VillageEventSchema.safeParse({ type: "made_up", payload: {}, ts, expiresAt: ts }).success).toBe(false);
    expect(VillagePrivacySchema.parse({ named: false })).toEqual({ named: false });
    expect(parseClientMessage(ClientMessage.VillagePrivacy, { named: false }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.VillagePrivacy, { named: "no" }).ok).toBe(false);
    expect(villageShardId(3)).toBe("valley-3");
    expect(nearestPlace([53, 30])).toBe("fishing_dock");
    expect(requestDoneEvent("q12-eggs_to_bakery")).toMatchObject({ type: "request_done", payload: { kind: "deliver" } });
    expect(requestDoneEvent("q12-nope")).toBeNull();
    const e = { type: "fish_caught" as const, payload: carp.payload };
    expect(eventDedupeKey("u", e, 1)).toBe(eventDedupeKey("u", e, 1));
    expect(eventDedupeKey("u", e, 1)).not.toBe(eventDedupeKey("u", e, 2));
  });

  it("lets the Elder tell of the secret spot at 5 hearts", () => {
    expect(elderSecretFlag(SECRET_SPOT_HEARTS - 0.5)).toBeNull();
    expect(elderSecretFlag(SECRET_SPOT_HEARTS)).toContain("secret fishing spot");
  });
});

describe("ambient barks (build plan M31)", () => {
  it("keys seeded lines per villager, activity, language and index, and pairs per relationship", () => {
    expect(soloBarkSeedMaterial("baker", "work", "es", 0)).not.toBe(soloBarkSeedMaterial("baker", "work", "es", 1));
    expect(soloBarkSeedMaterial("baker", "work", "es", 0)).not.toBe(soloBarkSeedMaterial("baker", "work", "ja", 0));
    expect(exchangeSeedMaterial("baker", "farmer", "es", 0, 0)).not.toBe(exchangeSeedMaterial("baker", "farmer", "es", 0, 1));
    const solo = { kind: "solo" as const, npcId: "baker" as const, activity: "work" as const, index: 2 };
    expect(ambientSetPlayerMaterial(solo, "es", "en")).toBe(ambientSetPlayerMaterial({ ...solo, index: 5 }, "es", "en"));
    expect(ambientSetPlayerMaterial(solo, "es", "en")).not.toBe(ambientSetPlayerMaterial(solo, "es", "de"));
    expect(BARK_PAIRS).toContainEqual({ a: "barista", b: "librarian" });
    for (const id of NPC_IDS) expect(barkActivities(id).length).toBeGreaterThan(0);
    expect(barkSpeakers({ kind: "exchange", a: "farmer", b: "mayor", index: 0 })).toEqual(["farmer", "mayor"]);
  });

  it("builds the §9.1 prompt from public game data and parses the answer", () => {
    const solo = ambientBarksPrompt(ambientPromptInput({ kind: "solo", npcId: "baker", activity: "work", index: 0 }, "es", "en"));
    expect(solo).toContain("Spanish");
    expect(solo).toContain("8 different short lines");
    expect(solo).toContain("at the bakery");
    const pair = ambientBarksPrompt(ambientPromptInput({ kind: "exchange", a: "farmer", b: "mayor", index: 0 }, "ja", "en"));
    expect(pair).toContain("the Mayor");
    expect(pair).toContain("unnecessary village projects");
    expect(pair).toContain("Hepburn");
    expect(AMBIENT_BARKS_JSON_SCHEMA.required).toEqual(["barks", "exchanges"]);
    const answer = parseTaskAnswer("ambientBarks", JSON.stringify({ barks: [{ text: "¡Pan fresco!", reading: "", translation: "Fresh bread!" }, { text: " ", translation: "" }], exchanges: null }));
    expect(answer).toEqual({ barks: [{ text: "¡Pan fresco!", translation: "Fresh bread!" }], exchanges: [] });
    expect(() => parseTaskAnswer("ambientBarks", JSON.stringify({ barks: [], exchanges: [] }))).toThrow();
  });
});
