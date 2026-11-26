import { describe, expect, it } from "vitest";
import { APARTMENT_LAYOUT_DOC, FirestorePaths, isValidPathSegment } from "./paths";
import {
  ApartmentLayoutSchema,
  CachedLabelsSchema,
  CachedTtsSchema,
  InventorySlotSchema,
  LangProgressSchema,
  LangSettingsSchema,
  NotebookEntrySchema,
  NpcMemorySchema,
  NPC_MEMORY_MAX_FACTS,
  NPC_MEMORY_MAX_WORDS,
  PlayerNameSchema,
  TimestampSchema,
  USER_PROFILE_CLIENT_FIELDS,
  UserProfileClientUpdateSchema,
  UserProfileSchema,
  VillageEventSchema,
} from "./schemas";

const ts = { seconds: 1_790_000_000, nanoseconds: 0 };

const profile = {
  name: "Lia",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "mint" }, trousers: { h: 200, s: 0.4, l: 0.7 } },
  apartmentId: "3B",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: ts,
};

describe("FirestorePaths", () => {
  it("builds the GDD §9.4 paths", () => {
    expect(FirestorePaths.user("u1")).toBe("users/u1");
    expect(FirestorePaths.lang("u1", "ja")).toBe("users/u1/langs/ja");
    expect(FirestorePaths.notebookEntry("u1", "ja", "e1")).toBe("users/u1/langs/ja/notebook/e1");
    expect(FirestorePaths.npcMemory("u1", "ja", "baker")).toBe("users/u1/langs/ja/npcMemory/baker");
    expect(FirestorePaths.inventorySlot("u1", "0")).toBe("users/u1/inventory/0");
    expect(FirestorePaths.apartmentLayout("u1")).toBe(`users/u1/apartment/${APARTMENT_LAYOUT_DOC}`);
    expect(FirestorePaths.villageEvent("shard-1", "ev")).toBe("village/shard-1/events/ev");
    expect(FirestorePaths.cacheEntry("tts", "abc")).toBe("cache/tts/abc");
    expect(FirestorePaths.report("r1")).toBe("reports/r1");
    expect(FirestorePaths.standing("u1")).toBe("users/u1/safety/standing");
  });

  it("rejects segments that would escape or change the path", () => {
    for (const bad of ["", "a/b", ".", "..", "__name__", "x".repeat(257)]) {
      expect(isValidPathSegment(bad)).toBe(false);
      expect(() => FirestorePaths.user(bad)).toThrow(/invalid Firestore path segment/);
    }
    expect(isValidPathSegment("zh-Hans")).toBe(true);
  });
});

describe("TimestampSchema", () => {
  it("accepts timestamp-shaped objects and keeps the instance", () => {
    class FakeTimestamp {
      constructor(
        readonly seconds: number,
        readonly nanoseconds: number,
      ) {}
    }
    const t = new FakeTimestamp(1, 2);
    expect(TimestampSchema.parse(t)).toBe(t);
  });

  it("rejects dates, numbers and strings", () => {
    for (const bad of [new Date(), 123, "2026-01-01", null, { seconds: 1.5, nanoseconds: 0 }]) {
      expect(TimestampSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("UserProfileSchema", () => {
  it("accepts a complete profile", () => {
    expect(UserProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("rejects economy fields and unknown keys on the profile", () => {
    for (const extra of [{ coins: 100 }, { inventory: [] }, { hearts: {} }, { level: "C2" }, { admin: true }]) {
      expect(UserProfileSchema.safeParse({ ...profile, ...extra }).success).toBe(false);
    }
  });

  it("requires a fur tint of the chosen animal", () => {
    const wrongFur = { ...profile, colors: { ...profile.colors, fur: "not-a-tint" } };
    expect(UserProfileSchema.safeParse(wrongFur).success).toBe(false);
  });

  it("clamps custom clothing colours to pastel", () => {
    const loud = { ...profile, colors: { ...profile.colors, trousers: { h: 400, s: 1, l: 0.1 } } };
    const parsed = UserProfileSchema.parse(loud);
    expect(parsed.colors.trousers).toEqual({ h: 40, s: 0.7, l: 0.6 });
  });

  it("validates languages, style and apartment id", () => {
    expect(UserProfileSchema.safeParse({ ...profile, nativeLang: "xx" }).success).toBe(false);
    expect(UserProfileSchema.safeParse({ ...profile, targetLangs: [] }).success).toBe(false);
    expect(UserProfileSchema.safeParse({ ...profile, style: "gothic" }).success).toBe(false);
    expect(UserProfileSchema.safeParse({ ...profile, apartmentId: "10Z" }).success).toBe(false);
  });
});

describe("PlayerNameSchema", () => {
  it("enforces 2–16 characters without control characters", () => {
    expect(PlayerNameSchema.parse("  Lia ")).toBe("Lia");
    expect(PlayerNameSchema.safeParse("L").success).toBe(false);
    expect(PlayerNameSchema.safeParse("x".repeat(17)).success).toBe(false);
    expect(PlayerNameSchema.safeParse("Li\na").success).toBe(false);
  });
});

describe("UserProfileClientUpdateSchema", () => {
  it("lists only appearance, style and native language as client-writable", () => {
    expect([...USER_PROFILE_CLIENT_FIELDS].sort()).toEqual(["animal", "colors", "nativeLang", "style"]);
  });

  it("accepts partial appearance updates", () => {
    expect(UserProfileClientUpdateSchema.safeParse({ style: "european" }).success).toBe(true);
    expect(UserProfileClientUpdateSchema.safeParse({ animal: "fox", colors: profile.colors }).success).toBe(true);
  });

  it("rejects server-owned fields", () => {
    for (const field of ["name", "apartmentId", "targetLangs", "createdAt", "coins"]) {
      expect(UserProfileClientUpdateSchema.safeParse({ [field]: (profile as Record<string, unknown>)[field] ?? 1 }).success).toBe(
        false,
      );
    }
  });
});

describe("LangProgressSchema", () => {
  const progress = { level: "A1+", levelEstimate: 1.3, streak: 2, coins: 50, hearts: { baker: 3 }, settings: {} };

  it("accepts a progress document", () => {
    expect(LangProgressSchema.safeParse(progress).success).toBe(true);
  });

  it("rejects negative coins, too many hearts and unknown NPCs", () => {
    expect(LangProgressSchema.safeParse({ ...progress, coins: -1 }).success).toBe(false);
    expect(LangProgressSchema.safeParse({ ...progress, hearts: { baker: 11 } }).success).toBe(false);
    expect(LangProgressSchema.safeParse({ ...progress, hearts: { dragon: 1 } }).success).toBe(false);
  });

  it("settings hold only the script mode", () => {
    expect(LangSettingsSchema.safeParse({ scriptMode: "both" }).success).toBe(true);
    expect(LangSettingsSchema.safeParse({ scriptMode: "kana" }).success).toBe(false);
    expect(LangSettingsSchema.safeParse({ coins: 1 }).success).toBe(false);
  });
});

describe("NotebookEntrySchema", () => {
  const entry = { surface: "パン", lemma: "パン", reading: "pan", gloss: "bread", source: "npc:baker", createdAt: ts };

  it("accepts an entry", () => {
    expect(NotebookEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects empty surfaces, bad sources and unknown keys", () => {
    expect(NotebookEntrySchema.safeParse({ ...entry, surface: " " }).success).toBe(false);
    expect(NotebookEntrySchema.safeParse({ ...entry, source: "evil" }).success).toBe(false);
    expect(NotebookEntrySchema.safeParse({ ...entry, coins: 1 }).success).toBe(false);
  });
});

describe("server-written documents", () => {
  it("caps NPC memory at 120 words and 10 facts", () => {
    const ok = { summary: "likes rye bread", facts: ["promised eggs"], lastSeen: ts };
    expect(NpcMemorySchema.safeParse(ok).success).toBe(true);
    const words = Array.from({ length: NPC_MEMORY_MAX_WORDS + 1 }, () => "w").join(" ");
    expect(NpcMemorySchema.safeParse({ ...ok, summary: words }).success).toBe(false);
    const facts = Array.from({ length: NPC_MEMORY_MAX_FACTS + 1 }, () => "f");
    expect(NpcMemorySchema.safeParse({ ...ok, facts }).success).toBe(false);
  });

  it("validates inventory slots and apartment layouts against the item registry", () => {
    expect(InventorySlotSchema.safeParse({ itemId: "bread", qty: 2 }).success).toBe(true);
    expect(InventorySlotSchema.safeParse({ itemId: "bread", qty: 0 }).success).toBe(false);
    expect(InventorySlotSchema.safeParse({ itemId: "gold_bar", qty: 1 }).success).toBe(false);
    expect(ApartmentLayoutSchema.safeParse({ furniture: [] }).success).toBe(true);
    expect(ApartmentLayoutSchema.safeParse({ furniture: [{ itemId: "wooden_chair", x: 0, z: 0, rot: 45 }] }).success).toBe(false);
  });

  it("validates village events and cache entries", () => {
    expect(VillageEventSchema.safeParse({ type: "fish_caught", payload: {}, ts, expiresAt: ts }).success).toBe(true);
    expect(VillageEventSchema.safeParse({ type: "Fish Caught", payload: {}, ts, expiresAt: ts }).success).toBe(false);
    const hash = "a".repeat(64);
    expect(CachedTtsSchema.safeParse({ storagePath: `tts/${hash}.ogg`, voice: "Kore", durationMs: 900 }).success).toBe(true);
    expect(CachedTtsSchema.safeParse({ storagePath: "../secret", voice: "Kore", durationMs: 900 }).success).toBe(false);
    expect(CachedLabelsSchema.safeParse({ "label.bakery": { word: "パン屋", reading: "pan'ya" } }).success).toBe(true);
  });
});
