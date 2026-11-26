import {
  BITE_WINDOW_MS,
  castCharge,
  type FishCastMessage,
  type FishReelMessage,
  headingToWater,
  hookTiming,
  REEL_PARAMS,
  startReel,
  stepReel,
  type Vec2,
} from "@hellovalley/shared";
import type { FishingNotice, FishingStore } from "../../state/fishingStore";

/**
 * The angler's controls (build plan M27, GDD §5.2): one button (Space, or the on-screen button)
 * does everything. Hold to charge the cast and let go to throw (the distance follows the hold);
 * while the shadow approaches, wait; when the fish bites, press within the bite window; then hold
 * to lift the bobber and let go to let it sink, keeping it in the moving zone until the fish is
 * landed. Escape reels in. The rules (charge, bite window, reel physics) are the shared ones; the
 * server decides what the cast and the catch were.
 */

export interface FishingControllerDeps {
  store: FishingStore;
  sendCast(message: FishCastMessage): boolean;
  sendReel(message: FishReelMessage): void;
  /** The hotbar slot holding the rod in hand, or null. */
  rodSlot(): number | null;
  /** The player's position in the town and current heading, or null (indoors, not loaded). */
  where(): { pos: Vec2; heading: number } | null;
  /** Standing at a fishing spot with nothing else open. */
  canCast(): boolean;
  now?: () => number;
}

/** No answer to a cast after this long: give up (ms). */
export const CAST_ANSWER_TIMEOUT_MS = 5000;

export interface FishingController {
  /** The button went down. */
  press(): void;
  /** The button came up. */
  release(): void;
  /** Escape: reel in (or close the card). */
  cancel(): void;
  /** Per frame: the bite, the late hook and the reel. */
  tick(): void;
  /** The catch card is dismissed. */
  closeResult(): void;
}

export function createFishingController(deps: FishingControllerDeps): FishingController {
  const { store } = deps;
  const now = deps.now ?? (() => performance.now());
  let held = false;
  let lastTick: number | null = null;
  let castSentAt = 0;

  /** Ends the cast without a catch (the server hears it got away) and says why. */
  const giveUp = (notice: FishingNotice) => {
    const cast = store.getState().cast;
    if (cast) deps.sendReel({ castId: cast.castId, outcome: "escaped" });
    held = false;
    store.setState({ phase: "idle", cast: null, biteAtMs: null, reel: null, chargeStartMs: null, notice });
  };

  return {
    press() {
      const s = store.getState();
      switch (s.phase) {
        case "idle": {
          const where = deps.where();
          if (!where || deps.rodSlot() === null || !deps.canCast()) return;
          const heading = headingToWater(where.pos, where.heading);
          if (heading === null) {
            store.setState({ notice: "no_water" });
            return;
          }
          held = true;
          store.setState({ phase: "charging", chargeStartMs: now(), heading, notice: null, result: null });
          return;
        }
        case "waiting":
          giveUp("early");
          return;
        case "bite": {
          const cast = s.cast!;
          const timing = hookTiming(now() - (s.biteAtMs ?? now()), cast.rarity);
          if (timing !== "hooked") {
            giveUp(timing);
            return;
          }
          held = true;
          lastTick = now();
          store.setState({ phase: "reeling", reel: startReel(REEL_PARAMS[cast.rarity], cast.reelSeed) });
          return;
        }
        case "reeling":
          held = true;
          return;
        default:
          return;
      }
    },

    release() {
      const s = store.getState();
      held = false;
      if (s.phase !== "charging") return;
      const slot = deps.rodSlot();
      const charge = castCharge(now() - (s.chargeStartMs ?? now()));
      if (slot === null || s.heading === null || !deps.sendCast({ slot, charge, heading: s.heading })) {
        store.setState({ phase: "idle", chargeStartMs: null, notice: "unavailable" });
        return;
      }
      castSentAt = now();
      store.setState({ phase: "casting", chargeStartMs: null });
    },

    cancel() {
      const s = store.getState();
      if (s.phase === "charging") store.setState({ phase: "idle", chargeStartMs: null });
      else if (s.phase === "waiting" || s.phase === "bite" || s.phase === "reeling") giveUp("escaped");
      else if (s.phase === "result") this.closeResult();
    },

    tick() {
      const s = store.getState();
      const t = now();
      if (s.phase === "casting" && t - castSentAt > CAST_ANSWER_TIMEOUT_MS) {
        store.setState({ phase: "idle", notice: "unavailable" });
        return;
      }
      const cast = s.cast;
      if (!cast) return;
      if (s.phase === "waiting" && s.biteAtMs !== null && t >= s.biteAtMs) store.setState({ phase: "bite" });
      else if (s.phase === "bite" && s.biteAtMs !== null && t - s.biteAtMs > BITE_WINDOW_MS[cast.rarity]) giveUp("late");
      else if (s.phase === "reeling" && s.reel) {
        const dt = (t - (lastTick ?? t)) / 1000;
        lastTick = t;
        const reel = stepReel(s.reel, held, dt, REEL_PARAMS[cast.rarity], cast.reelSeed);
        if (reel.outcome === "caught") {
          deps.sendReel({ castId: cast.castId, outcome: "caught" });
          held = false;
          store.setState({ phase: "landing", reel });
        } else if (reel.outcome === "escaped") giveUp("escaped");
        else store.setState({ reel });
      }
    },

    closeResult() {
      store.setState({ phase: "idle", result: null, cast: null, notice: null });
    },
  };
}
