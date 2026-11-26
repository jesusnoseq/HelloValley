// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoadProgress, trackLoad } from "../../assets/loadProgress";
import { I18nProvider } from "../../i18n/I18nProvider";
import { LoadingScreen } from "./LoadingScreen";
import { LOADING_TIPS } from "./tips";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("preloading screen", () => {
  it("shows progress and a tip in the target language with its translation, then lifts", async () => {
    vi.useFakeTimers();
    const store = createLoadProgress();
    let finish!: () => void;
    void trackLoad(new Promise<void>((r) => (finish = r)), store);
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(
      <I18nProvider locale="es">
        <LoadingScreen targetLang="ja" store={store} />
      </I18nProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Preparando el valle…" })).toBeTruthy();
    expect(screen.getByText(LOADING_TIPS[0]!.ja).getAttribute("lang")).toBe("ja");
    expect(screen.getByText(LOADING_TIPS[0]!.es).getAttribute("lang")).toBe("es");
    expect(screen.getByText("Cargando el pueblo: 0 de 1")).toBeTruthy();
    // Tips rotate.
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByText(LOADING_TIPS[1]!.ja)).toBeTruthy();
    // Still loading after the skip delay: Continue appears.
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives up waiting after the longest wait", async () => {
    vi.useFakeTimers();
    const store = createLoadProgress();
    void trackLoad(new Promise<void>(() => {}), store);
    render(<LoadingScreen targetLang="ko" store={store} maxMs={3000} />);
    // No Korean tips: the English one alone.
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3400);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
