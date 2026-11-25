import { describe, expect, it } from "vitest";
import { CHARACTER_ANIMATIONS } from "../assets/characters";
import {
  type AnimChange,
  type AnimInput,
  AnimationStateMachine,
  BASE_ANIM_STATES,
  type ClipTimings,
  CROSSFADE_S,
  crossfadeSeconds,
  EMOTE_KEYS,
  EMOTE_MIN_S,
  EMOTES,
  EmoteSchema,
  emoteForKey,
  emoteLength,
  STOP_GRACE_S,
  targetBaseState,
} from "./animation";

// The committed M07 manifest's clip timings (24 fps).
const TIMINGS: ClipTimings = {
  idle: { duration: 2, loop: true },
  walk: { duration: 1, loop: true },
  run: { duration: 0.667, loop: true },
  sit: { duration: 2, loop: true },
  talk: { duration: 2, loop: true },
  wave: { duration: 1, loop: true },
  laugh: { duration: 1, loop: true },
  cheer: { duration: 1.5, loop: true },
  clap: { duration: 0.5, loop: true },
  heart: { duration: 2, loop: false },
  think: { duration: 3, loop: true },
};

const idle: AnimInput = { motion: "idle" };
const walk: AnimInput = { motion: "walk" };
const run: AnimInput = { motion: "run" };

/** Runs the machine for `seconds` in 1/60 s steps and returns every change. */
function runFor(m: AnimationStateMachine, input: AnimInput, seconds: number): AnimChange[] {
  const out: AnimChange[] = [];
  const steps = Math.round(seconds * 60);
  for (let k = 0; k < steps; k++) {
    const c = m.update(input, 1 / 60);
    if (c) out.push(c);
  }
  return out;
}

describe("animation state machine data", () => {
  it("uses only generated clips", () => {
    for (const c of [...BASE_ANIM_STATES, ...EMOTES]) expect(CHARACTER_ANIMATIONS).toContain(c);
  });

  it("maps keys 1–5 to emotes", () => {
    expect(EMOTE_KEYS).toHaveLength(5);
    expect([1, 2, 3, 4, 5].map(emoteForKey)).toEqual([...EMOTE_KEYS]);
    for (const k of [0, 6, 1.5, Number.NaN]) expect(emoteForKey(k)).toBeNull();
    expect(EmoteSchema.safeParse("wave").success).toBe(true);
    expect(EmoteSchema.safeParse("fish_cast").success).toBe(false);
  });

  it("picks the base state by priority", () => {
    expect(targetBaseState({ motion: "run", seated: true, talking: true })).toBe("run");
    expect(targetBaseState({ motion: "walk", talking: true })).toBe("walk");
    expect(targetBaseState({ motion: "idle", seated: true, talking: true })).toBe("sit");
    expect(targetBaseState({ motion: "idle", talking: true })).toBe("talk");
    expect(targetBaseState(idle)).toBe("idle");
  });

  it("times crossfades per transition", () => {
    expect(crossfadeSeconds("idle", "idle")).toBe(0);
    expect(crossfadeSeconds("idle", "walk")).toBe(CROSSFADE_S.default);
    expect(crossfadeSeconds("walk", "run")).toBe(CROSSFADE_S.gait);
    expect(crossfadeSeconds("run", "walk")).toBe(CROSSFADE_S.gait);
    expect(crossfadeSeconds("idle", "sit")).toBe(CROSSFADE_S.sitDown);
    expect(crossfadeSeconds("sit", "walk")).toBe(CROSSFADE_S.standUp);
    expect(crossfadeSeconds("idle", "talk")).toBe(CROSSFADE_S.talk);
    expect(crossfadeSeconds("talk", "wave")).toBe(CROSSFADE_S.emoteIn);
    expect(crossfadeSeconds("wave", "idle")).toBe(CROSSFADE_S.emoteOut);
    for (const a of CHARACTER_ANIMATIONS) for (const b of CHARACTER_ANIMATIONS) expect(crossfadeSeconds(a, b)).toBeLessThanOrEqual(0.5);
  });

  it("plays looping emotes for whole cycles and one-shots once", () => {
    expect(emoteLength({ duration: 1, loop: true })).toBe(3);
    expect(emoteLength({ duration: 0.5, loop: true })).toBe(2.5);
    expect(emoteLength({ duration: 1.2, loop: true })).toBeCloseTo(2.4);
    expect(emoteLength({ duration: 3, loop: true })).toBe(3);
    expect(emoteLength({ duration: 2, loop: false })).toBe(2);
    expect(emoteLength({ duration: 0, loop: true })).toBeGreaterThanOrEqual(EMOTE_MIN_S);
  });
});

describe("AnimationStateMachine", () => {
  it("starts idle and stays quiet without changes", () => {
    const m = new AnimationStateMachine(TIMINGS);
    expect(m.clip).toBe("idle");
    expect(runFor(m, idle, 1)).toEqual([]);
  });

  it("walks, runs and settles back to idle after the stop grace", () => {
    const m = new AnimationStateMachine(TIMINGS);
    expect(m.update(walk, 1 / 60)).toEqual({ clip: "walk", fade: CROSSFADE_S.default, restart: false });
    expect(m.update(run, 1 / 60)).toEqual({ clip: "run", fade: CROSSFADE_S.gait, restart: false });
    // A short stop (path ends and restarts) does not flicker to idle.
    expect(m.update(idle, STOP_GRACE_S / 2)).toBeNull();
    expect(m.update(run, 1 / 60)).toBeNull();
    expect(m.clip).toBe("run");
    // A real stop does.
    const changes = runFor(m, idle, 0.5);
    expect(changes).toEqual([{ clip: "idle", fade: CROSSFADE_S.default, restart: false }]);
  });

  it("sits at once (no stop grace) and stands up into walking", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.update(walk, 1 / 60);
    expect(m.update({ motion: "idle", seated: true }, 1 / 60)).toEqual({ clip: "sit", fade: CROSSFADE_S.sitDown, restart: false });
    expect(m.update(walk, 1 / 60)).toEqual({ clip: "walk", fade: CROSSFADE_S.standUp, restart: false });
  });

  it("talks when idle and stops talking to walk", () => {
    const m = new AnimationStateMachine(TIMINGS);
    expect(m.update({ motion: "idle", talking: true }, 1 / 60)?.clip).toBe("talk");
    expect(m.update({ motion: "walk", talking: true }, 1 / 60)?.clip).toBe("walk");
  });

  it("plays an emote for its length, then fades back to the base state", () => {
    const m = new AnimationStateMachine(TIMINGS);
    expect(m.playEmote("wave")).toBe(true);
    expect(m.update(idle, 1 / 60)).toEqual({ clip: "wave", fade: CROSSFADE_S.emoteIn, restart: true });
    expect(m.emote?.length).toBe(3);
    const changes = runFor(m, idle, 3.1);
    expect(changes).toEqual([{ clip: "idle", fade: CROSSFADE_S.emoteOut, restart: false }]);
    expect(m.emote).toBeNull();
  });

  it("plays a one-shot emote once", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.playEmote("heart");
    m.update(idle, 1 / 60);
    expect(m.emote?.length).toBe(2);
    expect(runFor(m, idle, 1.9)).toEqual([]);
    expect(runFor(m, idle, 0.2).map((c) => c.clip)).toEqual(["idle"]);
  });

  it("returns to talk after an emote started while talking", () => {
    const m = new AnimationStateMachine(TIMINGS);
    const talking: AnimInput = { motion: "idle", talking: true };
    m.update(talking, 1 / 60);
    m.playEmote("laugh");
    expect(m.update(talking, 1 / 60)?.clip).toBe("laugh");
    expect(runFor(m, talking, 3.2).map((c) => c.clip)).toEqual(["talk"]);
  });

  it("restarts the same emote when it is triggered again", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.playEmote("clap");
    m.update(idle, 1 / 60);
    runFor(m, idle, 1);
    m.playEmote("clap");
    expect(m.update(idle, 1 / 60)).toEqual({ clip: "clap", fade: CROSSFADE_S.emoteIn, restart: true });
    expect(m.emote?.elapsed).toBe(0);
  });

  it("switches straight from one emote to another", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.playEmote("wave");
    m.update(idle, 1 / 60);
    m.playEmote("cheer");
    expect(m.update(idle, 1 / 60)).toEqual({ clip: "cheer", fade: CROSSFADE_S.emoteIn, restart: true });
  });

  it("refuses emotes while moving or seated, and moving cancels a playing one", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.update(walk, 1 / 60);
    expect(m.playEmote("wave")).toBe(false);
    runFor(m, idle, 0.5);
    m.update({ motion: "idle", seated: true }, 1 / 60);
    expect(m.playEmote("wave")).toBe(false);
    m.update(idle, 1 / 60);
    expect(m.playEmote("wave")).toBe(true);
    m.update(idle, 1 / 60);
    expect(m.update(walk, 1 / 60)).toEqual({ clip: "walk", fade: CROSSFADE_S.emoteOut, restart: false });
    expect(m.emote).toBeNull();
    // A queued emote is dropped when movement starts before it plays.
    runFor(m, idle, 0.5);
    m.playEmote("cheer");
    expect(m.update(run, 1 / 60)?.clip).toBe("run");
    expect(runFor(m, idle, 0.5).map((c) => c.clip)).toEqual(["idle"]);
  });

  it("cancels an emote on request", () => {
    const m = new AnimationStateMachine(TIMINGS);
    m.playEmote("think");
    m.update(idle, 1 / 60);
    m.cancelEmote();
    expect(m.update(idle, 1 / 60)).toEqual({ clip: "idle", fade: CROSSFADE_S.emoteOut, restart: false });
  });

  it("falls back to default timings and ignores bad dt", () => {
    const m = new AnimationStateMachine();
    m.playEmote("wave");
    m.update(idle, Number.NaN);
    expect(m.emote?.length).toBe(3);
    expect(m.update(idle, -5)).toBeNull();
    expect(m.emote?.elapsed).toBe(0);
  });
});
