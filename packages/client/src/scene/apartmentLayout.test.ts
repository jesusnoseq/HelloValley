import { defaultApartmentLayout, isWalkable } from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { apartmentSession, sendFurnitureEdit, setOfflineFurnitureEditor } from "../net/apartmentSession";
import { nextRotation } from "../state/placementStore";
import { currentApartment, parseLayoutJson, sceneGrids, startOfflineApartment } from "./apartmentLayout";
import { dropEdit } from "./PlacementMode";

afterEach(() => {
  setOfflineFurnitureEditor(null);
  apartmentSession.setState({ room: null, layoutJson: null, revision: 0, lastResult: null, isOwner: false, owner: null });
});

describe("apartment layout in the scene (M17)", () => {
  it("parses the room's layout JSON and rejects malformed layouts", () => {
    const layout = defaultApartmentLayout();
    expect(parseLayoutJson(JSON.stringify(layout))).toEqual(layout);
    expect(parseLayoutJson("{")).toBeNull();
    expect(parseLayoutJson(JSON.stringify({ furniture: [{ itemId: "throne", x: 0, z: 0, rot: 0 }] }))).toBeNull();
    expect(parseLayoutJson(null)).toBeNull();
  });

  it("shows the starting furniture until the room's layout arrives", () => {
    expect(currentApartment().layout).toEqual(defaultApartmentLayout());
    expect(isWalkable(sceneGrids("apartment"), [5.5, 1])).toBe(false); // the bed
  });

  it("applies edits offline with the shared rules, and the walker's grid follows", () => {
    startOfflineApartment();
    expect(apartmentSession.getState().isOwner).toBe(true);
    sendFurnitureEdit({ op: "store", index: 4, itemId: "bed" });
    expect(apartmentSession.getState().lastResult).toMatchObject({ ok: true });
    expect(currentApartment().layout.stored).toEqual(["bed"]);
    expect(isWalkable(sceneGrids("apartment"), [5.5, 1])).toBe(true);
    sendFurnitureEdit({ op: "move", index: 0, itemId: "kitchen_nook", x: 1, z: 0, rot: 0 });
    expect(apartmentSession.getState().lastResult).toMatchObject({ ok: false, reason: "fixed" });
    // Placing from storage.
    sendFurnitureEdit(dropEdit({ kind: "stored", itemId: "bed" }, { x: 5, z: 0, rot: 0 }));
    expect(apartmentSession.getState().lastResult).toMatchObject({ ok: true });
    expect(currentApartment().layout.stored).toEqual([]);
  });

  it("turns held pieces in quarter turns and builds move edits for placed ones", () => {
    expect([0, 90, 180, 270].map((r) => nextRotation(r as 0))).toEqual([90, 180, 270, 0]);
    expect(dropEdit({ kind: "placed", index: 3, itemId: "floor_lamp" }, { x: 1, z: 1, rot: 90 })).toEqual({
      op: "move",
      index: 3,
      itemId: "floor_lamp",
      x: 1,
      z: 1,
      rot: 90,
    });
  });
});
