import { interiorArrivalPoint, SPAWN_POINT, type SpacePoint } from "@hellovalley/shared";
import { useWorld } from "../state/worldStore";
import { Interior } from "./Interior";
import { Player } from "./Player";
import { Town } from "./Town";

/** In front of the apartment block, facing the road (the town spawn point). */
export const TOWN_START: SpacePoint = { space: "town", pos: SPAWN_POINT, heading: Math.PI / 2 };

/**
 * Where a session starts (build plan M14): new and returning players land in their own apartment.
 * TODO(M17): the private ApartmentRoom instance and the owner's furniture layout.
 */
export const HOME_START: SpacePoint = interiorArrivalPoint("apartment");

/**
 * The playable world (build plan M13): the town (kept loaded, hidden while indoors), the interior
 * the player is in, and the local player. The fade between them is drawn by ui/FadeOverlay.
 */
export function World({ start = HOME_START }: { start?: SpacePoint }) {
  const space = useWorld((s) => s.space);
  return (
    <>
      <Town visible={space === "town"} />
      {space !== "town" ? <Interior id={space} /> : null}
      <Player start={start} />
    </>
  );
}
