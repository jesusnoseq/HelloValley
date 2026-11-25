import { describe, expect, it } from "vitest";
import { starterSuggestions } from "./starters";

describe("starter suggestions (build plan M23)", () => {
  it("fits the NPC and the level", () => {
    expect(starterSuggestions("baker", "es", "en", "A1")).toEqual([
      { text: "¡Hola!", translation: "Hello!" },
      { text: "¿Qué tienes hoy?", translation: "What do you have today?" },
      { text: "¡Adiós!", translation: "Goodbye!" },
    ]);
    // Not a shop: ask how they are. B1 shows two.
    expect(starterSuggestions("elder", "fr", "es", "B1").map((s) => [s.text, s.translation])).toEqual([
      ["Bonjour !", "¡Hola!"],
      ["Comment ça va ?", "¿Cómo estás?"],
    ]);
    // B2 one starter; C1+ one too (behind the 💡).
    expect(starterSuggestions("baker", "de", "en", "B2")).toHaveLength(1);
    expect(starterSuggestions("baker", "de", "en", "C2")).toHaveLength(1);
  });

  it("carries readings for Japanese, no translation in the same language, nothing for other languages", () => {
    expect(starterSuggestions("baker", "ja", "en", "A1")[0]).toEqual({ text: "こんにちは！", reading: "konnichiwa!", translation: "Hello!" });
    expect(starterSuggestions("baker", "en-GB", "en", "A1")[0]).toEqual({ text: "Hello!", translation: "" });
    expect(starterSuggestions("baker", "sw", "en", "A1")).toEqual([]);
  });
});
