// Type-only imports: this module stays free of zod so the client's entry chunk can use it.
import type { SpaceId } from "../world/player";

/** GDD §6.6: chat lines reach players within about 12 m of the speaker. */
export const CHAT_RADIUS_M = 12;

/** Where a speaker or listener is, for the proximity check. */
export interface ChatPosition {
  space: SpaceId;
  x: number;
  z: number;
  /**
   * Which instance of the space: the apartment's owner uid in the private apartment space
   * (everyone has their own), null in shared spaces (the town, the bakery…).
   */
  instance: string | null;
}

/**
 * Whether `listener` hears a line `speaker` says (build plan M18): the same space (and, in an
 * apartment, the same apartment) and at most `radius` metres apart. Walls inside one space do not
 * block chat; interiors are single rooms.
 */
export function chatAudible(speaker: ChatPosition, listener: ChatPosition, radius: number = CHAT_RADIUS_M): boolean {
  if (speaker.space !== listener.space || speaker.instance !== listener.instance) return false;
  const d = Math.hypot(speaker.x - listener.x, speaker.z - listener.z);
  return Number.isFinite(d) && d <= radius;
}
