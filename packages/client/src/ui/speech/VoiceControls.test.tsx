// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TtsClip, TtsLineRequest, TtsResult, TtsSpeaker } from "../../ai/tts";
import { VoiceControls } from "./VoiceControls";
import type { VoicePlayer } from "./voicePlayer";

const clip: TtsClip = { mime: "audio/wav", data: new ArrayBuffer(100), durationMs: 1200 };
const line: TtsLineRequest = { npcId: "baker", lang: "es", level: "A1", text: "¡Hola, cariño!" };

function deferredTts() {
  const pending: ((r: TtsResult) => void)[] = [];
  const tts: TtsSpeaker & { clip: ReturnType<typeof vi.fn> } = {
    clip: vi.fn(() => new Promise<TtsResult>((resolve) => pending.push(resolve))),
  };
  return { tts, resolve: (r: TtsResult, i = pending.length - 1) => act(async () => pending[i]!(r)) };
}

const fakePlayer = (): VoicePlayer & { play: ReturnType<typeof vi.fn> } => ({ play: vi.fn(async () => {}), stop: vi.fn() });

/** The line text and its controls, as a bubble renders them. */
function LineWithVoice(props: { line: TtsLineRequest; tts: TtsSpeaker; player: VoicePlayer; autoPlay?: boolean }) {
  return (
    <div>
      <p data-testid="text">{props.line.text}</p>
      <VoiceControls {...props} />
    </div>
  );
}

afterEach(cleanup);

describe("VoiceControls", () => {
  it("shows the text before the audio, autoplays once, then replays at 1× and 0.75×", async () => {
    const { tts, resolve } = deferredTts();
    const player = fakePlayer();
    render(<LineWithVoice line={line} tts={tts} player={player} />);

    // Text is on screen while the clip is still loading; nothing plays yet.
    expect(screen.getByTestId("text").textContent).toBe("¡Hola, cariño!");
    expect(screen.getByRole("status", { name: "Loading the voice…" })).toBeTruthy();
    expect(player.play).not.toHaveBeenCalled();
    expect(tts.clip).toHaveBeenCalledWith(expect.objectContaining({ npcId: "baker", lang: "es", level: "A1", text: "¡Hola, cariño!" }));

    await resolve({ ok: true, clip, source: "generated", hash: "h" });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenLastCalledWith(clip, 1);

    fireEvent.click(screen.getByRole("button", { name: "Play the line again at 0.75× speed" }));
    expect(player.play).toHaveBeenLastCalledWith(clip, 0.75);
    fireEvent.click(screen.getByRole("button", { name: "Play the line again" }));
    expect(player.play).toHaveBeenLastCalledWith(clip, 1);
    // Replays reuse the clip: no new generation.
    expect(tts.clip).toHaveBeenCalledTimes(1);
  });

  it("does not autoplay when asked not to", async () => {
    const { tts, resolve } = deferredTts();
    const player = fakePlayer();
    render(<LineWithVoice line={line} tts={tts} player={player} autoPlay={false} />);
    await resolve({ ok: true, clip, source: "memory", hash: "h" });
    expect(player.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play the line again" })).toBeTruthy();
  });

  it("keeps the text and shows 🔇 when there is no audio", async () => {
    const { tts, resolve } = deferredTts();
    const player = fakePlayer();
    render(<LineWithVoice line={line} tts={tts} player={player} />);
    await resolve({ ok: false, reason: "unavailable" });
    expect(screen.getByRole("img", { name: "Voice not available for this line" }).textContent).toBe("🔇");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("text").textContent).toBe("¡Hola, cariño!");
    expect(player.play).not.toHaveBeenCalled();
  });

  it("asks again for a new line and ignores the old answer", async () => {
    const { tts, resolve } = deferredTts();
    const player = fakePlayer();
    const { rerender } = render(<LineWithVoice line={line} tts={tts} player={player} />);
    const next = { ...line, text: "¿Quieres pan?" };
    rerender(<LineWithVoice line={next} tts={tts} player={player} />);
    expect(tts.clip).toHaveBeenCalledTimes(2);
    await resolve({ ok: true, clip, source: "generated", hash: "old" }, 0);
    expect(player.play).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
    await resolve({ ok: true, clip, source: "generated", hash: "new" }, 1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("survives a refused autoplay", async () => {
    const { tts, resolve } = deferredTts();
    const player = fakePlayer();
    player.play.mockRejectedValueOnce(new DOMException("no gesture", "NotAllowedError"));
    render(<LineWithVoice line={line} tts={tts} player={player} />);
    await resolve({ ok: true, clip, source: "generated", hash: "h" });
    fireEvent.click(screen.getByRole("button", { name: "Play the line again" }));
    expect(player.play).toHaveBeenCalledTimes(2);
  });
});
