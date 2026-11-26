import { clockMinutesForPhase, type SfxId, SPAWN_POINT } from "@hellovalley/shared";
import { weatherRuntime } from "../scene/worldFx";
import { dioramaStore } from "../state/dioramaStore";
import { type AudioDirector, type AudioWorld, createAudioDirector } from "./director";
import { type AudioSink, createWebAudioSink, oneShotIds } from "./engine";
import { startGameSfx } from "./gameSfx";
import { audioLive, playSfx, setAudioOutput } from "./live";
import { setVoiceMixer } from "./voiceRoute";
import { loadVolumesFor, volumeStore } from "./volumeStore";

/** How often music and ambience follow the world (ms); the sink eases in between. */
export const AUDIO_TICK_MS = 250;

/** What the audio follows right now. */
export function readAudioWorld(): AudioWorld {
  const diorama = dioramaStore.getState();
  return {
    style: diorama.style,
    minutes: clockMinutesForPhase(diorama.worldTime),
    space: audioLive.space,
    pos: audioLive.pos ?? SPAWN_POINT,
    rain: weatherRuntime.weights.rain,
  };
}

const CLICKABLE = "button, [role='button'], input[type='radio'], input[type='checkbox']";

/**
 * Start the game's audio for a signed-in player (build plan M35): their saved volumes, and on the
 * first click or key press (browsers only let audio start after a gesture) the Web Audio mixer,
 * the director that keeps music and ambience in step with the style, the clock, the place and
 * the weather, footsteps and effects, and voice routing. Clicking any button pops softly; a panel
 * opening or closing plays its own sound instead. The audio pauses while the tab is hidden.
 * Returns the stop function (sign-out).
 */
export function startAudio(uid: string): () => void {
  loadVolumesFor(uid);
  let ctx: AudioContext | null = null;
  let sink: AudioSink | null = null;
  let director: AudioDirector | null = null;
  let lastPanelSfx = -Infinity;

  const unlock = () => {
    if (!sink) {
      const Ctor = typeof window === "undefined" ? undefined : window.AudioContext;
      if (!Ctor) return;
      ctx = new Ctor({ latencyHint: "interactive" });
      const s = createWebAudioSink(ctx);
      const d = createAudioDirector(s, readAudioWorld, volumeStore.getState().volumes);
      sink = s;
      director = d;
      setAudioOutput(s);
      setVoiceMixer({ sink: s, onVoiceActive: (active) => d.setVoiceActive(active) });
      s.preload(oneShotIds());
    }
    void sink.resume().then(() => director?.tick());
  };
  const gestures = ["pointerdown", "keydown"] as const;
  for (const g of gestures) window.addEventListener(g, unlock, { capture: true });

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target?.closest(CLICKABLE)) return;
    const at = performance.now();
    // A click that opens or closes a panel plays that sound instead (the store changes first).
    setTimeout(() => {
      if (lastPanelSfx < at) playSfx("ui.pop");
    }, 0);
  };
  document.addEventListener("click", onClick, true);

  const stopSfx = startGameSfx((id: SfxId) => {
    if (id === "ui.open" || id === "ui.close") lastPanelSfx = performance.now();
    playSfx(id);
  });
  const stopVolumes = volumeStore.subscribe((s) => director?.setVolumes(s.volumes));
  const timer = setInterval(() => {
    if (sink?.running) director?.tick();
  }, AUDIO_TICK_MS);
  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clearInterval(timer);
    for (const g of gestures) window.removeEventListener(g, unlock, { capture: true });
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onVisibility);
    stopSfx();
    stopVolumes();
    setAudioOutput(null);
    setVoiceMixer(null);
    sink?.dispose();
    loadVolumesFor(null);
  };
}
