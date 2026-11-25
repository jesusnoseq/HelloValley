import { describe, expect, it } from "vitest";
import { buildingExitPoint, interiorArrivalPoint, PlayerController, spaceDoors } from "./player";
import { INTERIOR_IDS, interiorLayout } from "./interiors";
import { INTERCOM_RADIUS_M, intercomInteractable, MIRROR_RADIUS_M, nearestInteractable, spaceInteractables } from "./interactables";
import { circleFits } from "./movement";
import { townNavGrid } from "./navgrid";

describe("interactables", () => {
  it("puts the mirror in the apartment and the intercom in town", () => {
    const list = spaceInteractables("apartment");
    expect(list.map((i) => i.kind)).toEqual(["mirror"]);
    expect(list[0]!.spot).toEqual(interiorLayout("apartment").spots.mirror);
    expect(spaceInteractables("town").map((i) => i.kind)).toEqual(["intercom"]);
    // Every other room has exactly its villager (build plan M23).
    for (const id of INTERIOR_IDS) if (id !== "apartment") expect(spaceInteractables(id).map((i) => i.kind)).toEqual(["npc"]);
  });

  it("finds the mirror only within reach", () => {
    const spot = spaceInteractables("apartment")[0]!.spot;
    expect(nearestInteractable("apartment", spot)?.kind).toBe("mirror");
    expect(nearestInteractable("apartment", [spot[0] + MIRROR_RADIUS_M - 0.01, spot[1]])?.kind).toBe("mirror");
    expect(nearestInteractable("apartment", [spot[0] + MIRROR_RADIUS_M + 0.01, spot[1]])).toBeNull();
    expect(nearestInteractable("town", spot)).toBeNull();
    // Arriving home does not put you in front of the mirror.
    expect(nearestInteractable("apartment", interiorArrivalPoint("apartment").pos)).toBeNull();
  });

  it("can be walked to from the apartment door", () => {
    const player = new PlayerController(interiorArrivalPoint("apartment"));
    const mirror = spaceInteractables("apartment")[0]!;
    expect(player.clickTo(mirror.spot)).toBe(true);
    for (let k = 0; k < 600 && player.waypoints; k++) player.update(1 / 60);
    expect(nearestInteractable("apartment", player.state.pos)?.id).toBe(mirror.id);
    // The facing heading looks at the west wall.
    expect(Math.sin(mirror.facing)).toBeCloseTo(-1);
  });

  it("puts the intercom beside the apartment block door, reachable and out of the doorway", () => {
    const intercom = intercomInteractable();
    expect(circleFits(townNavGrid(), intercom.spot)).toBe(true);
    const door = spaceDoors("town").find((d) => d.id.startsWith("apartment_block:"))!;
    const [x0, z0, x1, z1] = door.trigger;
    const inTrigger = intercom.spot[0] >= x0 && intercom.spot[0] <= x1 && intercom.spot[1] >= z0 && intercom.spot[1] <= z1;
    expect(inTrigger).toBe(false);
    expect(Math.hypot(intercom.spot[0] - door.centre[0], intercom.spot[1] - door.centre[1])).toBeLessThan(2);
    // Walk there from where you come out of the apartment block.
    const player = new PlayerController(buildingExitPoint("apartment_block"));
    expect(player.clickTo(intercom.spot)).toBe(true);
    for (let k = 0; k < 600 && player.waypoints; k++) expect(player.update(1 / 60)).toBeNull();
    expect(nearestInteractable("town", player.state.pos)?.id).toBe(intercom.id);
    const far: [number, number] = [intercom.spot[0] + INTERCOM_RADIUS_M + 0.5, intercom.spot[1]];
    expect(nearestInteractable("town", far)?.kind).not.toBe("intercom");
  });
});
