import { describe, expect, it } from "vitest";
import { interiorArrivalPoint, PlayerController } from "./player";
import { INTERIOR_IDS, interiorLayout } from "./interiors";
import { MIRROR_RADIUS_M, nearestInteractable, spaceInteractables } from "./interactables";

describe("interactables", () => {
  it("puts the mirror in the apartment only", () => {
    const list = spaceInteractables("apartment");
    expect(list.map((i) => i.kind)).toEqual(["mirror"]);
    expect(list[0]!.spot).toEqual(interiorLayout("apartment").spots.mirror);
    expect(spaceInteractables("town")).toEqual([]);
    for (const id of INTERIOR_IDS) if (id !== "apartment") expect(spaceInteractables(id)).toEqual([]);
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
});
