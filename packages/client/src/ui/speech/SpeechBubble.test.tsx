// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineText, type SaveWordDraft, type ScriptCode, type TokenizedLine } from "@hellovalley/shared";
import { REQUIRED_FIXTURE_IDS, SPEECH_FIXTURES, type SpeechFixture } from "./fixtures";
import { ensureScriptFont, resetFontLoader } from "./fontLoader";
import { SCRIPT_MODE_STORAGE_KEY, scriptModeStore, setScriptModeSink } from "./scriptModeStore";
import { SpeechBubble } from "./SpeechBubble";
import { onSaveWord } from "./wordEvents";

// Node's own (file-less, undefined) Web Storage global hides jsdom's: use jsdom's, before the
// store module reads it.
vi.hoisted(() => {
  const { window } = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
});

const fixture = (id: string): SpeechFixture => SPEECH_FIXTURES.find((f) => f.id === id)!;
const noFont = () => Promise.resolve();

function renderFixture(f: SpeechFixture, props: Partial<Parameters<typeof SpeechBubble>[0]> = {}) {
  return render(
    <SpeechBubble lines={f.lines} lang={f.lang} nativeLang={f.nativeLang} source="npc:baker" speaker={f.speaker} loadFont={noFont} {...props} />,
  );
}

const lineTexts = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".hv-line__text")];

beforeEach(() => {
  localStorage.clear();
  scriptModeStore.setState({ modes: {} });
});

afterEach(() => {
  cleanup();
  setScriptModeSink(null);
});

describe("SpeechBubble fixtures", () => {
  it("has a fixture for every required language", () => {
    expect(SPEECH_FIXTURES.map((f) => f.id)).toEqual(expect.arrayContaining([...REQUIRED_FIXTURE_IDS]));
  });

  it.each(SPEECH_FIXTURES.map((f) => [f.id, f] as const))("renders %s in its own script, word by word", (_id, f) => {
    scriptModeStore.setState({ modes: { [f.lang]: "native" } });
    const { container } = renderFixture(f);
    const texts = lineTexts(container);
    expect(texts).toHaveLength(f.lines.length);
    f.lines.forEach((line, i) => {
      const el = texts[i]!;
      expect(el.textContent).toBe(line.text);
      expect(el.getAttribute("lang")).toBe(f.lang);
      const words = line.tokens.filter((t) => t.pos !== "punct").map((t) => t.surface);
      expect([...el.querySelectorAll(".hv-word")].map((b) => b.textContent)).toEqual(words);
    });
  });
});

describe("right-to-left", () => {
  it.each(["ar", "he", "fa"])("lays out %s lines right to left", (id) => {
    const f = fixture(id);
    scriptModeStore.setState({ modes: { [f.lang]: "native" } });
    const { container } = renderFixture(f);
    for (const el of lineTexts(container)) expect(el.getAttribute("dir")).toBe("rtl");
  });

  it("keeps the readings under the words left to right in both mode", () => {
    const { container } = renderFixture(fixture("ar"));
    expect(lineTexts(container)[0]!.getAttribute("dir")).toBe("rtl");
    const readings = [...container.querySelectorAll(".hv-stack__reading")];
    expect(readings.map((r) => r.textContent)).toContain("qahwa");
    for (const r of readings) expect(r.getAttribute("dir")).toBe("ltr");
  });

  it("shows romanized Arabic left to right, tagged as Latin", () => {
    scriptModeStore.setState({ modes: { ar: "romanized" } });
    const { container } = renderFixture(fixture("ar"));
    const el = lineTexts(container)[0]!;
    expect(el.getAttribute("dir")).toBe("ltr");
    expect(el.getAttribute("lang")).toBe("ar-Latn");
    expect(el.textContent).toBe("marḥaban! hal turīd qahwa?");
  });

  it("keeps left-to-right languages ltr", () => {
    const { container } = renderFixture(fixture("ru"));
    for (const el of lineTexts(container)) expect(el.getAttribute("dir")).toBe("ltr");
  });
});

describe("Japanese ruby", () => {
  it("adds furigana over the kanji only in both mode", () => {
    scriptModeStore.setState({ modes: { ja: "both" } });
    const { container } = renderFixture(fixture("ja"));
    const rubies = [...container.querySelectorAll("ruby")];
    const pairs = rubies.map((r) => [r.firstChild?.textContent, r.querySelector("rt")?.textContent]);
    expect(pairs).toEqual([
      ["食", "た"],
      ["今日", "きょう"],
      ["東京", "とうきょう"],
      ["来", "き"],
      ["茶", "ちゃ"],
    ]);
    // Fallback parentheses for browsers without ruby support.
    expect(rubies[0]!.querySelectorAll("rp")).toHaveLength(2);
    // The romaji sits under each word, from `romanized` or from the kana reading.
    const readings = [...container.querySelectorAll(".hv-stack__reading")].map((r) => r.textContent);
    expect(readings).toEqual(expect.arrayContaining(["tabemasu", "wa", "kimashita", "ocha", "mo", "douzo"]));
  });

  it("has no ruby in native mode and only romaji in romanized mode", () => {
    scriptModeStore.setState({ modes: { ja: "native" } });
    const { container, unmount } = renderFixture(fixture("ja"));
    expect(container.querySelectorAll("ruby")).toHaveLength(0);
    unmount();
    scriptModeStore.setState({ modes: { ja: "romanized" } });
    const romanized = renderFixture(fixture("ja"));
    expect(romanized.container.querySelectorAll("ruby")).toHaveLength(0);
    expect(lineTexts(romanized.container)[0]!.textContent).toBe("ohayō gozaimasu! pan o tabemasu ka?");
    expect(lineTexts(romanized.container)[2]!.textContent).toBe("ocha mo douzo.");
  });
});

describe("script toggle", () => {
  it("cycles both → romanized → native, labelled あ / あ+a / a, and saves per language", () => {
    const sink = vi.fn();
    setScriptModeSink(sink);
    renderFixture(fixture("ja"));
    const toggle = screen.getByRole("button", { name: /native with reading/ });
    expect(toggle.textContent).toBe("あ+a");
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("a");
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("あ");
    expect(JSON.parse(localStorage.getItem(SCRIPT_MODE_STORAGE_KEY)!)).toEqual({ ja: "native" });
    expect(sink.mock.calls).toEqual([
      ["ja", "romanized"],
      ["ja", "native"],
    ]);
    // Another language keeps its own setting.
    expect(scriptModeStore.getState().modes["ko"]).toBeUndefined();
  });

  it("is not shown for Latin-script languages", () => {
    renderFixture(fixture("es"));
    expect(screen.queryByRole("button", { name: /Script/ })).toBeNull();
  });

  it("lets a stored Firestore value apply only when the device has none", () => {
    scriptModeStore.getState().hydrate("ko", "romanized");
    scriptModeStore.getState().setMode("zh-Hans", "native");
    scriptModeStore.getState().hydrate("zh-Hans", "both");
    expect(scriptModeStore.getState().modes).toEqual({ ko: "romanized", "zh-Hans": "native" });
  });
});

describe("words and translations", () => {
  it("shows the word tooltip on hover and saves the word on click", () => {
    const saved: SaveWordDraft[] = [];
    const emitted: SaveWordDraft[] = [];
    const off = onSaveWord((d) => emitted.push(d));
    scriptModeStore.setState({ modes: { ja: "native" } });
    renderFixture(fixture("ja"), { onSaveWord: (d) => saved.push(d) });
    const word = screen.getByRole("button", { name: "食べます" });
    fireEvent.pointerEnter(word);
    const tip = screen.getByRole("tooltip");
    expect(word.getAttribute("aria-describedby")).toBe(tip.id);
    expect(within(tip).getByText("食べる")).toBeTruthy();
    expect(within(tip).getByText("たべます")).toBeTruthy();
    expect(within(tip).getByText("tabemasu")).toBeTruthy();
    expect(within(tip).getByText("eat")).toBeTruthy();
    expect(within(tip).getByText("verb")).toBeTruthy();
    fireEvent.click(word);
    expect(word.hasAttribute("data-saved")).toBe(true);
    const expected = {
      lang: "ja",
      surface: "食べます",
      lemma: "食べる",
      reading: "たべます",
      gloss: "eat",
      pos: "verb",
      example: "おはようございます！パンを食べますか？",
      source: "npc:baker",
    };
    expect(saved).toEqual([expected]);
    expect(emitted).toEqual([expected]);
    fireEvent.pointerLeave(word);
    expect(screen.queryByRole("tooltip")).toBeNull();
    off();
  });

  it("shows the sentence translation when the line or the 🌐 button is hovered", () => {
    const { container } = renderFixture(fixture("es"));
    expect(screen.queryByText("Do you want a coffee with milk?")).toBeNull();
    fireEvent.pointerEnter(lineTexts(container)[0]!);
    const translation = screen.getByText("Do you want a coffee with milk?");
    expect(translation.getAttribute("lang")).toBe("en");
    fireEvent.pointerLeave(lineTexts(container)[0]!);
    expect(screen.queryByText("Do you want a coffee with milk?")).toBeNull();
    const globes = screen.getAllByRole("button", { name: "Show the translation" });
    fireEvent.focus(globes[1]!);
    expect(screen.getByText("It's sunny today.")).toBeTruthy();
  });

  it("keeps only the last three lines", () => {
    const base = fixture("es").lines[0]!;
    const lines: TokenizedLine[] = [1, 2, 3, 4].map((n) => ({ ...base, text: `Uno ${n}`, tokens: [{ surface: "Uno", gloss: "one" }, { surface: String(n), gloss: "" }] }));
    const { container } = render(<SpeechBubble lines={lines} lang="es" nativeLang="en" source="chat" loadFont={noFont} />);
    expect(lineTexts(container).map((el) => el.textContent)).toEqual(["Uno 2", "Uno 3", "Uno 4"]);
    expect(lineText(lines[0]!, "Latn")).toBe("Uno 1");
  });
});

describe("fonts", () => {
  it("asks for the script's font, and the Latin one when readings are shown", () => {
    const loadFont = vi.fn<(script: ScriptCode) => Promise<void>>(() => Promise.resolve());
    renderFixture(fixture("ko"), { loadFont });
    expect(loadFont.mock.calls.map((c) => c[0])).toEqual(["Kore", "Latn"]);
  });

  it("adds each Google Fonts stylesheet once", () => {
    resetFontLoader();
    void ensureScriptFont("Jpan");
    void ensureScriptFont("Jpan");
    void ensureScriptFont("Arab");
    const sheets = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][data-hv-font]')].map((l) => l.getAttribute("href"));
    expect(sheets).toEqual([
      "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&display=swap",
    ]);
    expect(document.head.querySelectorAll('link[rel="preconnect"]')).toHaveLength(1);
  });
});
