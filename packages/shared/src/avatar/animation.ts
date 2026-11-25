import { z } from "zod";
import type { CharacterAnimation } from "../assets/characters";
import type { Motion } from "../world/player";

/**
 * The avatar animation state machine (build plan M15): which clip a character shows and how long
 * each change crossfades. Pure and deterministic (no three.js), so the client drives its
 * AnimationMixer with it. Remote avatars (build plan M16) run their own machine from the synced
 * `motion` and the emotes the TownRoom relays (it accepts only `EMOTE_KEYS`).
 *
 * Base states come from what the character is doing, by priority: moving (run, walk) > seated
 * (sit) > talking (talk) > idle. Emotes are one-shot overlays on top of idle or talk: they play
 * for `emoteLength` seconds and then fade back, and starting to move or sitting down cancels them.
 * Stopping is debounced by `STOP_GRACE_S` so a path that ends and restarts does not flicker.
 * TODO(M27/M29): fish_cast, fish_reel and eat as activity states.
 */

export const BASE_ANIM_STATES = ["idle", "walk", "run", "sit", "talk"] as const satisfies readonly CharacterAnimation[];
export type BaseAnimState = (typeof BASE_ANIM_STATES)[number];

export const EMOTES = ["wave", "laugh", "cheer", "clap", "heart", "think"] as const satisfies readonly CharacterAnimation[];
export type Emote = (typeof EMOTES)[number];
export const EmoteSchema = z.enum(EMOTES);

/**
 * GDD §10: keys 1–5 play emotes (my mapping). `think` is left out of the hotbar: it is the
 * "waiting for an answer" pose of conversations (the NPC plays it while the model answers, M23).
 */
export const EMOTE_KEYS = ["wave", "laugh", "cheer", "clap", "heart"] as const satisfies readonly Emote[];

/** The emote on key `digit` (1–5), or null. */
export function emoteForKey(digit: number): Emote | null {
  return Number.isInteger(digit) && digit >= 1 && digit <= EMOTE_KEYS.length ? EMOTE_KEYS[digit - 1]! : null;
}

export function isEmote(clip: string): clip is Emote {
  return (EMOTES as readonly string[]).includes(clip);
}

/** What the character is doing this frame. */
export interface AnimInput {
  motion: Motion;
  seated?: boolean;
  talking?: boolean;
}

/** Clip length (seconds) and whether it loops, from the character manifest (`animations`). */
export interface ClipTiming {
  duration: number;
  loop: boolean;
}
export type ClipTimings = Readonly<Partial<Record<CharacterAnimation, ClipTiming>>>;

/** Used for a clip missing from the timings. */
export const FALLBACK_CLIP_TIMING: ClipTiming = { duration: 1, loop: true };

/** A looping emote plays whole cycles for at least this long; a one-shot plays once. */
export const EMOTE_MIN_S = 2.4;
/** How long motion must have stopped before walk/run settle into idle or talk. */
export const STOP_GRACE_S = 0.1;

/** Crossfade durations in seconds (my choice: quick for locomotion, softer for sitting and emotes). */
export const CROSSFADE_S = {
  default: 0.2,
  /** walk ↔ run. */
  gait: 0.15,
  /** Into the sit pose, and standing up from it. */
  sitDown: 0.35,
  standUp: 0.3,
  /** idle ↔ talk. */
  talk: 0.25,
  /** Into an emote, and back out of it. */
  emoteIn: 0.15,
  emoteOut: 0.25,
} as const;

const MOVING = (s: string) => s === "walk" || s === "run";

/** The crossfade from clip `from` to clip `to`. */
export function crossfadeSeconds(from: CharacterAnimation, to: CharacterAnimation): number {
  if (from === to) return 0;
  if (isEmote(to)) return CROSSFADE_S.emoteIn;
  if (isEmote(from)) return CROSSFADE_S.emoteOut;
  if (MOVING(from) && MOVING(to)) return CROSSFADE_S.gait;
  if (to === "sit") return CROSSFADE_S.sitDown;
  if (from === "sit") return CROSSFADE_S.standUp;
  if ((from === "idle" && to === "talk") || (from === "talk" && to === "idle")) return CROSSFADE_S.talk;
  return CROSSFADE_S.default;
}

/** How long an emote plays: whole cycles of a looping clip lasting at least EMOTE_MIN_S, or one pass of a one-shot. */
export function emoteLength(timing: ClipTiming): number {
  const d = timing.duration > 0 ? timing.duration : FALLBACK_CLIP_TIMING.duration;
  return timing.loop ? Math.ceil(EMOTE_MIN_S / d - 1e-9) * d : d;
}

/** The base state an input asks for. */
export function targetBaseState(input: AnimInput): BaseAnimState {
  if (input.motion === "run") return "run";
  if (input.motion === "walk") return "walk";
  if (input.seated) return "sit";
  if (input.talking) return "talk";
  return "idle";
}

/** A clip change for the renderer: play `clip`, crossfading over `fade` seconds; `restart` replays it from the start. */
export interface AnimChange {
  clip: CharacterAnimation;
  fade: number;
  restart: boolean;
}

export interface ActiveEmote {
  name: Emote;
  elapsed: number;
  length: number;
}

export class AnimationStateMachine {
  private baseState: BaseAnimState;
  private active: ActiveEmote | null = null;
  private pending: Emote | null = null;
  private still = 0;
  private shown: CharacterAnimation;

  constructor(
    private readonly timings: ClipTimings = {},
    initial: BaseAnimState = "idle",
  ) {
    this.baseState = initial;
    this.shown = initial;
  }

  /** The clip currently shown. */
  get clip(): CharacterAnimation {
    return this.shown;
  }

  get base(): BaseAnimState {
    return this.baseState;
  }

  get emote(): Readonly<ActiveEmote> | null {
    return this.active;
  }

  timing(clip: CharacterAnimation): ClipTiming {
    return this.timings[clip] ?? FALLBACK_CLIP_TIMING;
  }

  /** Emotes play only from idle or talk (not while moving or seated). Returns whether it was accepted; it starts on the next `update`. */
  playEmote(emote: Emote): boolean {
    if (this.baseState !== "idle" && this.baseState !== "talk") return false;
    this.pending = emote;
    return true;
  }

  /** Stops a playing or queued emote (it fades out on the next `update`). */
  cancelEmote(): void {
    this.pending = null;
    if (this.active) this.active.elapsed = this.active.length;
  }

  /** Advances `dt` seconds. Returns the clip change to apply, or null when the shown clip stays. */
  update(input: AnimInput, dt: number): AnimChange | null {
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const target = targetBaseState(input);

    // Stopping is debounced; everything else switches at once.
    if (MOVING(target)) this.still = 0;
    else this.still += step;
    const settle = MOVING(this.baseState) && !MOVING(target) && target !== "sit" && this.still < STOP_GRACE_S;
    if (!settle) this.baseState = target;

    // Moving or sitting cancels emotes.
    const canEmote = this.baseState === "idle" || this.baseState === "talk";
    if (!canEmote) {
      this.active = null;
      this.pending = null;
    }

    let restart = false;
    if (this.pending) {
      restart = this.active?.name === this.pending || this.shown === this.pending;
      this.active = { name: this.pending, elapsed: 0, length: emoteLength(this.timing(this.pending)) };
      this.pending = null;
    } else if (this.active) {
      this.active.elapsed += step;
      if (this.active.elapsed >= this.active.length) this.active = null;
    }

    const next: CharacterAnimation = this.active ? this.active.name : this.baseState;
    if (next === this.shown && !restart) return null;
    const from = this.shown;
    this.shown = next;
    return { clip: next, fade: restart ? CROSSFADE_S.emoteIn : crossfadeSeconds(from, next), restart: restart || isEmote(next) };
  }
}
