import { describe, expect, it, vi } from "vitest";
import { noticeToCachedLine, questNoticeSeedMaterial } from "@hellovalley/shared";
import { createQuestNotices } from "./questNotices";

/** Build plan M30: seeded notice first (template × language × level band), else one generation per player, else none. */

const notice = { title: { text: "¡Aviso!", translation: "Notice!" }, body: [{ text: "Tres huevos, por favor.", translation: "Three eggs, please." }] };

describe("quest notices", () => {
  it("reads the seeded notice for the player's level band, with the native translation", async () => {
    const seeded = vi.fn(async (material: string) => (material === questNoticeSeedMaterial("eggs_to_bakery", "es", "A1") ? noticeToCachedLine(notice, "en") : null));
    const generate = vi.fn();
    const notices = createQuestNotices({ seeded, generate });
    expect(await notices.get({ templateId: "eggs_to_bakery", targetLang: "es", nativeLang: "en", level: "A2" })).toEqual(notice);
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates on a miss (or a broken seeded doc), at the band's level and word cap, with the request's facts", async () => {
    const generate = vi.fn(async () => ({ ok: true as const, value: notice, source: "cloud" as const }));
    const notices = createQuestNotices({ seeded: async () => ({ text: 42 }), generate });
    expect(await notices.get({ templateId: "eggs_to_bakery", targetLang: "es", nativeLang: "en", level: "B2" })).toEqual(notice);
    expect(generate).toHaveBeenCalledWith({
      templateId: "eggs_to_bakery",
      targetLang: "es",
      nativeLang: "en",
      level: "B1",
      maxWords: 40,
      facts: { kind: "deliver", who: "Farmer", what: "egg", quantity: 3, where: "deliver to the Baker", deadline: "before 12:00" },
    });
  });

  it("gives null without a notice (unknown template, failed generation)", async () => {
    const notices = createQuestNotices({ generate: async () => ({ ok: false, reason: "unavailable" }) });
    expect(await notices.get({ templateId: "eggs_to_bakery", targetLang: "es", nativeLang: "en", level: "A1" })).toBeNull();
    expect(await notices.get({ templateId: "nope", targetLang: "es", nativeLang: "en", level: "A1" })).toBeNull();
  });
});
