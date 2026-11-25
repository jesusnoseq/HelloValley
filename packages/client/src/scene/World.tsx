import { SPAWN_POINT, type SpacePoint } from "@hellovalley/shared";
import { useWorld } from "../state/worldStore";
import { Interior } from "./Interior";
import { Player } from "./Player";
import { Town } from "./Town";

/**
 * Where a session starts: in front of the apartment block, facing the road.
 * TODO(M14): new and returning players land in their apartment.
 */
export const DEFAULT_START: SpacePoint = { space: "town", pos: SPAWN_POINT, heading: Math.PI / 2 };

/**
 * The playable world (build plan M13): the town (kept loaded, hidden while indoors), the interior
 * the player is in, and the local player. The fade between them is drawn by ui/FadeOverlay.
 */
export function World({ start = DEFAULT_START }: { start?: SpacePoint }) {
  const space = useWorld((s) => s.space);
  return (
    <>
      <Town visible={space === "town"} />
      {space !== "town" ? <Interior id={space} /> : null}
      <Player start={start} />
    </>
  );
}
