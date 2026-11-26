import type { SpaceId } from "../world/player";
import { townPlaces, type Vec2 } from "../world/town";

/**
 * The Town Hall notice board (GDD §4.1 "Its board holds the daily requests", build plan M30): an
 * interactable in town in front of the board prop. F there opens today's three requests; the
 * server checks `quest:accept` against its own walker with the same reach (+ slack).
 */

/** How close to the board's standing point the player must be (my number). */
export const NOTICE_BOARD_REACH_M = 1.5;
/** Slack on the reach for the server check (position reports lag the client a little). */
export const NOTICE_BOARD_SLACK_M = 0.5;

/** Where the player stands to read the board (town frame). */
export function noticeBoardSpot(): Vec2 {
  return townPlaces().notice_board;
}

export function atNoticeBoard(space: SpaceId, pos: Vec2, slack = 0): boolean {
  if (space !== "town") return false;
  const spot = noticeBoardSpot();
  return Math.hypot(pos[0] - spot[0], pos[1] - spot[1]) <= NOTICE_BOARD_REACH_M + slack;
}
