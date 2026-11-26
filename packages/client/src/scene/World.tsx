import { interiorArrivalPoint, SPAWN_POINT, type SpacePoint } from "@hellovalley/shared";
import { useWorld } from "../state/worldStore";
import { Interior } from "./Interior";
import { Npcs } from "./Npcs";
import { PlacementMode } from "./PlacementMode";
import { Player } from "./Player";
import { RemotePlayers } from "./RemotePlayers";
import { Town } from "./Town";
import { WorldLabels } from "./WorldLabels";

/** In front of the apartment block, facing the road (the town spawn point). */
export const TOWN_START: SpacePoint = { space: "town", pos: SPAWN_POINT, heading: Math.PI / 2 };

/**
 * Where a session starts (build plan M14): new and returning players land in their own apartment
 * (its furniture comes from their ApartmentRoom, build plan M17).
 */
export const HOME_START: SpacePoint = interiorArrivalPoint("apartment");

/**
 * The playable world (build plan M13): the town (kept loaded, hidden while indoors), the interior
 * the player is in, the local player and (online, build plan M16) the other players in the same
 * space, the villagers at their posts (M23), plus furniture placement mode in the apartment (M17)
 * and the world labels on hover (M25). The fade between them is drawn by ui/FadeOverlay.
 */
export function World({ start = HOME_START }: { start?: SpacePoint }) {
  const space = useWorld((s) => s.space);
  return (
    <>
      <Town visible={space === "town"} />
      {space !== "town" ? <Interior id={space} /> : null}
      <Npcs />
      <Player start={start} />
      <RemotePlayers />
      <PlacementMode />
      <WorldLabels />
    </>
  );
}
