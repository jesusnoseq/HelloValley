import { describe, expect, it } from "vitest";
import { ModerationStandingSchema } from "../firestore/schemas";
import { moderateChatText, moderateNameText, moderationTokens, normalizeForModeration } from "./moderation";
import { addStrike, emptyStanding, type ModerationStanding, MUTE_DURATIONS_MS, MUTE_LEVEL_RESET_MS, MUTE_STRIKE_THRESHOLD, mutedUntil, STRIKE_WINDOW_MS } from "./strikes";

/** Build plan M36: the server's chat and name moderation (blocklist + heuristics) and the strikes toward shard-wide mutes. */

const blockedAs = (text: string) => {
  const v = moderateChatText(text);
  return v.ok ? null : v.category;
};
const nameBlockedAs = (name: string) => {
  const v = moderateNameText(name);
  return v.ok ? null : v.category;
};

describe("normalisation", () => {
  it("folds case, width, diacritics and invisible characters", () => {
    expect(normalizeForModeration("ＦＵＣＫ")).toBe("fuck");
    expect(normalizeForModeration("Ça déjà")).toBe("ca deja");
    expect(normalizeForModeration("fu​ck")).toBe("fuck");
    // Kana and Hangul keep their composed form.
    expect(normalizeForModeration("ばか 바보")).toBe("ばか 바보");
  });

  it("maps leetspeak and joins spaced-out letters", () => {
    expect(moderationTokens("$h1t")).toEqual(["shit"]);
    expect(moderationTokens("you f u c k")).toEqual(["you", "fuck"]);
    expect(moderationTokens("f.u.c.k off")).toEqual(["fuck", "off"]);
    expect(moderationTokens("I have a cat")).toEqual(["i", "have", "a", "cat"]);
  });
});

describe("moderateChatText", () => {
  it("lets ordinary chat through in every featured language", () => {
    for (const line of [
      "Hello! Do you want to go fishing by the river?",
      "I bought 3 loaves of bread for 15 coins",
      "¿Dónde está la panadería? Quiero comprar pan con queso.",
      "Je cherche la bibliothèque, merci beaucoup !",
      "Ich habe heute einen Fisch gefangen.",
      "パン屋さんはどこですか？",
      "我想买面包。",
      "빵 주세요!",
      "Где библиотека?",
      "أين المكتبة؟",
      "My class assessment is in Scunthorpe, I need a cocktail and some spice",
      "I will pass the classic cockpit to Hancock in Pakistan",
    ]) {
      expect(moderateChatText(line), line).toEqual({ ok: true });
    }
  });

  it("blocks profanity, slurs and sexual words, with the usual evasions", () => {
    expect(blockedAs("fuck you")).toBe("profanity");
    expect(blockedAs("FUUUUCK")).toBe("profanity");
    expect(blockedAs("f u c k this")).toBe("profanity");
    expect(blockedAs("you are a $h1t")).toBe("profanity");
    expect(blockedAs("fu​ck")).toBe("profanity");
    expect(blockedAs("ｆｕｃｋｉｎｇ")).toBe("profanity");
    expect(blockedAs("eres un pendejo")).toBe("profanity");
    expect(blockedAs("putain de merde")).toBe("profanity");
    expect(blockedAs("сука")).toBe("profanity");
    expect(blockedAs("send nudes")).toBe("sexual");
    expect(blockedAs("you faggot")).toBe("slur");
  });

  it("blocks scripts without spaces as substrings", () => {
    expect(blockedAs("お前は死ね")).toBe("harassment");
    expect(blockedAs("你是傻逼吗")).toBe("profanity");
    expect(blockedAs("씨발 뭐야")).toBe("profanity");
  });

  it("blocks threats as harassment and counts them double", () => {
    expect(blockedAs("just kill yourself")).toBe("harassment");
    expect(blockedAs("kys")).toBe("harassment");
    expect(moderateChatText("kys")).toEqual({ ok: false, category: "harassment", strikes: 2 });
  });

  it("blocks links, e-mail addresses and phone numbers", () => {
    expect(blockedAs("join discord.gg/abc")).toBe("link");
    expect(blockedAs("see https://example.org")).toBe("link");
    expect(blockedAs("go to www.example.org")).toBe("link");
    expect(blockedAs("free coins at coins4u.xyz")).toBe("link");
    expect(blockedAs("mail me at kid@example.com")).toBe("personal_data");
    expect(blockedAs("call me +34 612 345 678")).toBe("personal_data");
    // Personal data is blocked to protect the sender, without a strike.
    expect(moderateChatText("kid@example.com")).toMatchObject({ strikes: 0 });
    expect(moderateChatText("I caught 12 fish today, 3 were rare")).toEqual({ ok: true });
  });

  it("blocks flooding", () => {
    expect(blockedAs("aaaaaaaaaaaaaaaaaaaaaa")).toBe("spam");
    expect(moderateChatText("hahahaha!!")).toEqual({ ok: true });
  });
});

describe("moderateNameText", () => {
  it("accepts ordinary names", () => {
    for (const name of ["Lia", "Kenji", "Peacock", "Hancock", "Dev", "María José", "ハナ", "민지", "Алёна"]) expect(moderateNameText(name), name).toEqual({ ok: true });
  });

  it("blocks offensive names, also hidden inside a name", () => {
    expect(nameBlockedAs("xXfuckXx")).toBe("profanity");
    expect(nameBlockedAs("Sh1tHead")).toBe("profanity");
    expect(nameBlockedAs("nigga123")).toBe("slur");
  });

  it("blocks names that impersonate staff or carry contact details", () => {
    expect(nameBlockedAs("Admin")).toBe("reserved");
    expect(nameBlockedAs("Mod")).toBe("reserved");
    expect(nameBlockedAs("HelloValley_Team")).toBe("reserved");
    expect(nameBlockedAs("m0derator")).toBe("reserved");
    expect(nameBlockedAs("612345678")).toBe("personal_data");
    expect(nameBlockedAs("coins.com")).toBe("link");
  });
});

describe("strikes and shard-wide mutes", () => {
  const T0 = 1_800_000_000_000;
  const strike = (s: ModerationStanding, at: number, weight = 1, by?: string) =>
    addStrike(s, { at, weight, kind: by ? "report" : "moderation", ...(by ? { by } : {}) }, at);

  it(`mutes after ${MUTE_STRIKE_THRESHOLD} strikes inside the window`, () => {
    let s = emptyStanding();
    for (let i = 0; i < MUTE_STRIKE_THRESHOLD - 1; i++) {
      const r = strike(s, T0 + i * 1000);
      expect(r.muted).toBeNull();
      s = r.standing;
    }
    const r = strike(s, T0 + 5000);
    expect(r.muted).toEqual({ until: T0 + 5000 + MUTE_DURATIONS_MS[0], level: 1 });
    expect(mutedUntil(r.standing, T0 + 6000)).toBe(T0 + 5000 + MUTE_DURATIONS_MS[0]);
    expect(mutedUntil(r.standing, T0 + 5000 + MUTE_DURATIONS_MS[0])).toBeNull();
    expect(r.standing.strikes).toEqual([]);
  });

  it("forgets strikes older than the window", () => {
    let s = strike(emptyStanding(), T0).standing;
    s = strike(s, T0 + 1000).standing;
    const r = strike(s, T0 + STRIKE_WINDOW_MS + 2000);
    expect(r.muted).toBeNull();
    expect(r.standing.strikes).toHaveLength(1);
  });

  it("counts a threat double", () => {
    const s = strike(emptyStanding(), T0, 2).standing;
    expect(strike(s, T0 + 1000).muted).not.toBeNull();
  });

  it("counts one report per reporter, so one player cannot mute anyone alone", () => {
    let s = emptyStanding();
    for (let i = 0; i < 5; i++) {
      const r = strike(s, T0 + i * 1000, 1, "angry");
      expect(r.counted).toBe(i === 0);
      expect(r.muted).toBeNull();
      s = r.standing;
    }
    s = strike(s, T0 + 10_000, 1, "second").standing;
    expect(strike(s, T0 + 11_000, 1, "third").muted).toMatchObject({ level: 1 });
  });

  it("escalates repeated mutes within a week, and starts over after one", () => {
    let s = emptyStanding();
    const muteAt = (at: number) => {
      const r = strike(s, at, 3);
      s = r.standing;
      return r.muted;
    };
    expect(muteAt(T0)?.level).toBe(1);
    // Strikes while muted do not stack a new mute.
    expect(muteAt(T0 + 1000)).toBeNull();
    const second = muteAt(T0 + MUTE_DURATIONS_MS[0] + 1);
    expect(second).toEqual({ level: 2, until: T0 + MUTE_DURATIONS_MS[0] + 1 + MUTE_DURATIONS_MS[1] });
    expect(muteAt(T0 + 2 * MUTE_DURATIONS_MS[1] + 10)?.level).toBe(3);
    expect(muteAt(T0 + 3 * MUTE_DURATIONS_MS[2])?.level).toBe(4);
    expect(s.muteUntil! - s.lastMuteAt!).toBe(MUTE_DURATIONS_MS[2]);
    expect(muteAt(s.lastMuteAt! + MUTE_LEVEL_RESET_MS + 1)?.level).toBe(1);
  });

  it("ignores zero-weight verdicts and stores as the Firestore schema", () => {
    const r = strike(emptyStanding(), T0, 0);
    expect(r.counted).toBe(false);
    const muted = strike(strike(strike(emptyStanding(), T0, 1, "a").standing, T0 + 1, 1, "b").standing, T0 + 2, 1, "c").standing;
    expect(ModerationStandingSchema.parse(muted)).toEqual(muted);
    expect(ModerationStandingSchema.parse(strike(emptyStanding(), T0, 1, "a").standing).strikes).toEqual([{ at: T0, weight: 1, kind: "report", by: "a" }]);
  });
});
