import { describe, expect, it } from "vitest";
import { FISH, type FishId, getFish } from "../data/fish";
import { getNpc } from "../data/npcs";
import { RARITIES } from "../data/rarity";
import { TIMES_OF_DAY, WEATHERS } from "../data/world";
import { parseTaskAnswer } from "../ai/schemas";
import { FishCastSchema, FishReelSchema } from "../protocol/schemas";
import { npcBuys, npcBuyUnitPrice } from "../index";
import {
  autoReel,
  BITE_DELAY_MAX_MS,
  BITE_DELAY_MIN_MS,
  BITE_WINDOW_MS,
  CAST_MAX_M,
  castCharge,
  castDistance,
  castExpiresAt,
  castLanding,
  castTable,
  cleanFishLog,
  createRng,
  dockDeck,
  earliestCatchAt,
  elderAtDock,
  elderDockSpot,
  fishingSpotAt,
  fishLogStats,
  headingToWater,
  hookTiming,
  isOpenWater,
  judgeReel,
  minReelMs,
  nearElderOnDock,
  type PendingCast,
  pickWeighted,
  recordCatch,
  REEL_MAX_S,
  REEL_PARAMS,
  rollCast,
  SECRET_SPOT_AREA,
  SECRET_SPOT_HEARTS,
  seedFrom,
  startReel,
  stepReel,
  zoneCentre,
} from "./index";

const DOCK: [number, number] = [53, 30.25];
const BANK: [number, number] = [20.5, 32.6];
const SECRET: [number, number] = [4, 25.5];
const NORTH = Math.PI;

describe("seeded rng", () => {
  it("repeats for a seed and differs between seeds", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
    for (const x of xs) expect(x).toBeLessThan(1);
  });

  it("hashes parts into stable seeds", () => {
    expect(seedFrom("uid", 1)).toBe(seedFrom("uid", 1));
    expect(seedFrom("uid", 1)).not.toBe(seedFrom("uid", 2));
  });

  it("picks by weight", () => {
    const rng = createRng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) counts[pickWeighted([{ value: "a" as const, weight: 3 }, { value: "b" as const, weight: 1 }], rng)!]++;
    expect(counts.a / 4000).toBeGreaterThan(0.7);
    expect(counts.a / 4000).toBeLessThan(0.8);
    expect(pickWeighted([], rng)).toBeNull();
    expect(pickWeighted([{ value: 1, weight: 0 }], rng)).toBeNull();
  });
});

describe("fishing spots", () => {
  it("finds the dock, the banks and nothing inland or indoors", () => {
    expect(fishingSpotAt("town", DOCK)).toBe("dock");
    expect(fishingSpotAt("town", BANK)).toBe("bank");
    expect(fishingSpotAt("town", [37, 46])).toBeNull();
    expect(fishingSpotAt("bakery", [2, 2])).toBeNull();
  });

  it("unlocks the secret spot at 5 Elder hearts", () => {
    expect(fishingSpotAt("town", SECRET)).toBe("bank");
    expect(fishingSpotAt("town", SECRET, { elderHearts: SECRET_SPOT_HEARTS - 0.25 })).toBe("bank");
    expect(fishingSpotAt("town", SECRET, { elderHearts: SECRET_SPOT_HEARTS })).toBe("secret");
    expect(SECRET[0]).toBeGreaterThanOrEqual(SECRET_SPOT_AREA[0]);
  });

  it("lands casts in open water, never on land, a deck or past the far bank", () => {
    expect(isOpenWater(53, 31)).toBe(false); // under the dock deck
    expect(isOpenWater(53, 28)).toBe(true);
    const fromDock = castLanding(DOCK, NORTH, castDistance(1))!;
    expect(fromDock.point[1]).toBeGreaterThanOrEqual(27);
    expect(isOpenWater(...fromDock.point)).toBe(true);
    // Casting south from the bank is casting at the meadow.
    expect(castLanding(BANK, 0, CAST_MAX_M)).toBeNull();
    const short = castLanding(BANK, NORTH, castDistance(0))!;
    const long = castLanding(BANK, NORTH, castDistance(1))!;
    expect(long.distance).toBeGreaterThan(short.distance);
    expect(headingToWater(BANK, NORTH)).toBeCloseTo(NORTH);
    expect(headingToWater([37, 60])).toBeNull();
  });

  it("charges with the hold time", () => {
    expect(castCharge(0)).toBe(0);
    expect(castCharge(600)).toBeCloseTo(0.5);
    expect(castCharge(99_999)).toBe(1);
    expect(castCharge(Number.NaN)).toBe(0);
    expect(castDistance(2)).toBe(CAST_MAX_M);
  });
});

describe("the Elder on the dock", () => {
  const elder = getNpc("elder");
  it("follows his schedule", () => {
    expect(elderAtDock(elder, 6 * 60)).toBe(true);
    expect(elderAtDock(elder, 12 * 60)).toBe(false);
    expect(elderAtDock(elder, 15 * 60)).toBe(true);
    expect(elderAtDock(elder, 22 * 60)).toBe(false);
  });
  it("hears catches nearby only", () => {
    const deck = dockDeck();
    const spot = elderDockSpot();
    expect(spot[0]).toBeGreaterThan(deck[0]);
    expect(spot[0]).toBeLessThan(deck[2]);
    expect(nearElderOnDock(elder, 6 * 60, "town", DOCK)).toBe(true);
    expect(nearElderOnDock(elder, 6 * 60, "town", BANK)).toBe(false);
    expect(nearElderOnDock(elder, 12 * 60, "town", DOCK)).toBe(false);
  });
});

describe("the roll", () => {
  it("boosts rare fish with distance and leaves commons alone", () => {
    const near = castTable({ timeOfDay: "morning", weather: "rain", spot: "dock" }, 0);
    const far = castTable({ timeOfDay: "morning", weather: "rain", spot: "dock" }, 1);
    const w = (t: typeof near, id: FishId) => t.find((e) => e.value === id)!.weight;
    expect(w(far, "salmon")).toBe(2 * w(near, "salmon"));
    expect(w(far, "minnow")).toBe(w(near, "minnow"));
  });

  it("is deterministic per seed, with bite delays in range", () => {
    const c = { timeOfDay: "night", weather: "fog", spot: "secret" } as const;
    expect(rollCast(c, 0.5, createRng(9))).toEqual(rollCast(c, 0.5, createRng(9)));
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const roll = rollCast(c, 1, rng)!;
      expect(roll.biteDelayMs).toBeGreaterThanOrEqual(BITE_DELAY_MIN_MS);
      expect(roll.biteDelayMs).toBeLessThanOrEqual(BITE_DELAY_MAX_MS);
      expect(getFish(roll.fishId)!.times).toContain("night");
      expect(getFish(roll.fishId)!.weather).toContain("fog");
    }
  });

  it("acceptance: simulated catches yield at least 5 species across day and night", () => {
    const rng = createRng(2027);
    const day = new Set<FishId>();
    const night = new Set<FishId>();
    for (const timeOfDay of TIMES_OF_DAY) {
      for (const weather of WEATHERS) {
        for (const spot of ["dock", "bank"] as const) {
          for (let i = 0; i < 30; i++) {
            const roll = rollCast({ timeOfDay, weather, spot }, rng(), rng)!;
            // Play the mini-game with the steering policy: only landed fish count.
            const params = REEL_PARAMS[roll.rarity];
            let reel = startReel(params, roll.reelSeed);
            while (!reel.outcome) reel = stepReel(reel, autoReel(reel, params, roll.reelSeed), 1 / 60, params, roll.reelSeed);
            if (reel.outcome === "caught") (timeOfDay === "night" ? night : day).add(roll.fishId);
          }
        }
      }
    }
    expect(new Set([...day, ...night]).size).toBeGreaterThanOrEqual(5);
    expect(day.size).toBeGreaterThanOrEqual(5);
    expect(night.size).toBeGreaterThanOrEqual(3);
    // Some species only bite at night.
    expect([...night].some((id) => !getFish(id)!.times.some((t) => t !== "night"))).toBe(true);
  });
});

describe("bite and reel timing", () => {
  it("hooks only inside the bite window", () => {
    expect(hookTiming(-1, "common")).toBe("early");
    expect(hookTiming(0, "common")).toBe("hooked");
    expect(hookTiming(BITE_WINDOW_MS.common, "common")).toBe("hooked");
    expect(hookTiming(BITE_WINDOW_MS.common + 1, "common")).toBe("late");
    for (let i = 1; i < RARITIES.length; i++) expect(BITE_WINDOW_MS[RARITIES[i]!]).toBeLessThan(BITE_WINDOW_MS[RARITIES[i - 1]!]);
  });

  it("keeps the GDD's 2–4 s and moves the zone inside the bar", () => {
    for (const r of RARITIES) {
      expect(REEL_PARAMS[r].holdSeconds).toBeGreaterThanOrEqual(2);
      expect(REEL_PARAMS[r].holdSeconds).toBeLessThanOrEqual(4);
      for (let t = 0; t < 20; t += 0.37) {
        const c = zoneCentre(t, REEL_PARAMS[r], 12345);
        expect(c - REEL_PARAMS[r].zoneSize / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(c + REEL_PARAMS[r].zoneSize / 2).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("never lands a fish faster than the hold time", () => {
    for (const r of RARITIES) {
      const params = REEL_PARAMS[r];
      for (const seed of [1, 99, 4242]) {
        let reel = startReel(params, seed);
        while (!reel.outcome) reel = stepReel(reel, autoReel(reel, params, seed), 1 / 30, params, seed);
        if (reel.outcome === "caught") expect(reel.t * 1000).toBeGreaterThanOrEqual(minReelMs(r) - 1);
      }
    }
  });

  it("lets the fish escape when the player does nothing or only holds", () => {
    const params = REEL_PARAMS.rare;
    let idle = startReel(params, 5);
    while (!idle.outcome) idle = stepReel(idle, false, 1 / 60, params, 5);
    expect(idle.outcome).toBe("escaped");
    expect(idle.t).toBeLessThan(REEL_MAX_S);
    let held = startReel(params, 5);
    while (!held.outcome) held = stepReel(held, true, 1 / 60, params, 5);
    expect(held.outcome).toBe("escaped");
    expect(stepReel(held, true, 1, params, 5)).toBe(held);
  });
});

describe("server checks for a catch", () => {
  const cast: PendingCast = { castId: "c1", fishId: "carp", rarity: "common", spot: "dock", castAtMs: 1000, biteAtMs: 4000, pos: DOCK, bobber: [53, 28] };
  it("refuses unknown casts, too-fast catches, late ones and walking away", () => {
    expect(judgeReel(undefined, "c1", "caught", 9000, "town", DOCK)).toEqual({ ok: false, reason: "no_cast" });
    expect(judgeReel(cast, "other", "caught", 9000, "town", DOCK)).toEqual({ ok: false, reason: "no_cast" });
    expect(judgeReel(cast, "c1", "caught", 4500, "town", DOCK)).toEqual({ ok: false, reason: "too_soon" });
    expect(judgeReel(cast, "c1", "caught", earliestCatchAt(cast), "town", DOCK)).toEqual({ ok: true });
    expect(judgeReel(cast, "c1", "caught", castExpiresAt(cast) + 1, "town", DOCK)).toEqual({ ok: false, reason: "too_late" });
    expect(judgeReel(cast, "c1", "caught", 9000, "town", [DOCK[0], DOCK[1] + 2])).toEqual({ ok: false, reason: "moved" });
    expect(judgeReel(cast, "c1", "caught", 9000, "bakery", DOCK)).toEqual({ ok: false, reason: "moved" });
    expect(judgeReel(cast, "c1", "escaped", 1001, "town", DOCK)).toEqual({ ok: true });
  });
});

describe("the encyclopedia", () => {
  it("records first and repeat catches", () => {
    const a = recordCatch({}, "carp", 10);
    expect(a.first).toBe(true);
    const b = recordCatch(a.log, "carp", 20);
    expect(b.first).toBe(false);
    expect(b.entry).toEqual({ count: 2, firstMs: 10, lastMs: 20 });
    const c = recordCatch(b.log, "eel", 30);
    const stats = fishLogStats(c.log);
    expect(stats).toMatchObject({ species: 2, total: 3 });
    expect(stats.byRarity.common).toEqual({ caught: 1, of: FISH.filter((f) => f.rarity === "common").length });
    expect(cleanFishLog({ carp: { count: 1, firstMs: 1, lastMs: 1 }, shark: { count: 1, firstMs: 1, lastMs: 1 } })).toEqual({ carp: { count: 1, firstMs: 1, lastMs: 1 } });
  });
});

describe("fishing data and messages", () => {
  it("lets the Farmer buy fish at full price", () => {
    expect(npcBuys("farmer", "carp")).toBe(true);
    expect(npcBuyUnitPrice("farmer", "carp")).toBe(getFish("carp")!.basePrice);
  });

  it("validates fish:cast and fish:reel", () => {
    expect(FishCastSchema.safeParse({ slot: 24, charge: 0.5, heading: 1 }).success).toBe(true);
    expect(FishCastSchema.safeParse({ slot: 24, charge: 1.5, heading: 1 }).success).toBe(false);
    expect(FishCastSchema.safeParse({ slot: 30, charge: 0.5, heading: 1 }).success).toBe(false);
    expect(FishCastSchema.safeParse({ slot: 24, charge: 0.5, heading: 1, fishId: "golden_carp" }).success).toBe(false);
    expect(FishReelSchema.safeParse({ castId: "abc", outcome: "caught" }).success).toBe(true);
    expect(FishReelSchema.safeParse({ castId: "abc", outcome: "caught", fishId: "ghost_pike" }).success).toBe(false);
  });

  it("parses the Elder's comments", () => {
    const value = parseTaskAnswer("elderBark", JSON.stringify({ lines: [{ text: " ¡Una  carpa! ", reading: "", translation: "A carp!" }, { text: "", translation: "x" }] }));
    expect(value.lines).toEqual([{ text: "¡Una carpa!", translation: "A carp!" }]);
    expect(() => parseTaskAnswer("elderBark", JSON.stringify({ lines: [] }))).toThrow();
  });
});
