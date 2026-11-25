import { describe, expect, it } from "vitest";
import { BUILDING_RECIPE_IDS, type BuildingRecipeId } from "../buildings/schema";
import { INTERIOR_IDS, INTERIOR_LAYOUTS, interiorForBuilding } from "./interiors";
import { circleFits } from "./movement";
import {
  buildingExitPoint,
  type DoorLink,
  interiorArrivalPoint,
  pickClick,
  PlayerController,
  rayBox,
  spaceDoors,
  spaceGrid,
} from "./player";
import { buildingDoors, SPAWN_POINT, townBuilding, type Vec2 } from "./town";

const DT = 1 / 30;

/** Run the controller until it walks into a door (then go through it) or `seconds` pass. */
function runUntilDoor(p: PlayerController, seconds: number): DoorLink | null {
  for (let t = 0; t < seconds; t += DT) {
    const door = p.update(DT);
    expect(circleFits(spaceGrid(p.state.space), p.state.pos), `${p.state.space} at ${p.state.pos.join(", ")}`).toBe(true);
    if (door) {
      p.completeTransition();
      return door;
    }
  }
  return null;
}

/** Run until the walker stands still. */
function runUntilIdle(p: PlayerController, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    expect(p.update(DT)).toBeNull();
    if (p.state.motion === "idle" && !p.waypoints) return;
  }
  throw new Error(`still walking after ${seconds} s`);
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function townDoorOf(id: BuildingRecipeId): Vec2 {
  return buildingDoors(townBuilding(id))[0]!.position;
}

describe("door links", () => {
  it("links every town front door to its building's interior and back out", () => {
    const town = spaceDoors("town");
    for (const id of BUILDING_RECIPE_IDS) {
      const links = town.filter((d) => d.id.startsWith(`${id}:`));
      expect(links.length, id).toBeGreaterThan(0);
      for (const l of links) expect(l.to.space).toBe(interiorForBuilding(id));
    }
    for (const id of INTERIOR_IDS) {
      const [exit] = spaceDoors(id);
      expect(exit!.to.space).toBe("town");
    }
  });

  it("drops walkers where they fit, outside the door triggers", () => {
    for (const id of BUILDING_RECIPE_IDS) {
      const out = buildingExitPoint(id);
      expect(circleFits(spaceGrid("town"), out.pos), id).toBe(true);
      for (const d of spaceDoors("town")) {
        const [x0, z0, x1, z1] = d.trigger;
        expect(out.pos[0] >= x0 && out.pos[0] <= x1 && out.pos[1] >= z0 && out.pos[1] <= z1, `${id} exit inside ${d.id}`).toBe(false);
      }
    }
    for (const id of INTERIOR_IDS) {
      const inside = interiorArrivalPoint(id);
      expect(circleFits(spaceGrid(id), inside.pos), id).toBe(true);
      const [x0, z0, x1, z1] = spaceDoors(id)[0]!.trigger;
      expect(inside.pos[0] >= x0 && inside.pos[0] <= x1 && inside.pos[1] >= z0 && inside.pos[1] <= z1).toBe(false);
    }
  });
});

describe("click picking", () => {
  it("intersects rays with boxes", () => {
    expect(rayBox([0, 0, -5], [0, 0, 1], [-1, -1, -1], [1, 1, 1])).toBeCloseTo(4);
    expect(rayBox([0, 5, -5], [0, 0, 1], [-1, -1, -1], [1, 1, 1])).toBeNull();
    expect(rayBox([0, 0, 0], [1, 0, 0], [-1, -1, -1], [1, 1, 1])).toBe(0);
  });

  it("sends a click on a building's upper wall to its door, and other clicks to the ground", () => {
    // A camera-like ray (35° pitch, 45° yaw) aimed at the middle of the bakery's second storey.
    const pitch = (35 * Math.PI) / 180;
    const dir: [number, number, number] = [-Math.cos(pitch) * Math.SQRT1_2, -Math.sin(pitch), -Math.cos(pitch) * Math.SQRT1_2];
    const door = townDoorOf("bakery");
    const aim: [number, number, number] = [door[0] - 1, 4.5, door[1] - 0.5];
    const origin: [number, number, number] = [aim[0] - dir[0] * 40, aim[1] - dir[1] * 40, aim[2] - dir[2] * 40];
    const pick = pickClick("town", origin, dir)!;
    expect(pick.door?.id).toBe("bakery:0");
    expect(pick.point).toEqual(door);
    // Straight down onto open ground.
    const ground = pickClick("town", [37, 30, 44], [0, -1, 0])!;
    expect(ground.door).toBeNull();
    expect(ground.point[0]).toBeCloseTo(37);
    expect(ground.point[1]).toBeCloseTo(44);
    // Looking up never reaches the ground.
    expect(pickClick("town", [37, 1, 44], [0, 1, 0])).toBeNull();
  });

  it("walks a clicked building's wall to its door and inside", () => {
    const p = new PlayerController(buildingExitPoint("clinic"));
    const door = townDoorOf("clinic");
    expect(p.clickRay([door[0], 30, door[1] - 0.01], [0, -1, 0])).toBe(true);
    expect(runUntilDoor(p, 10)?.to.space).toBe("clinic");
  });
});

describe("player controller", () => {
  it("walks into a door with WASD and comes back out", () => {
    const start = buildingExitPoint("bakery");
    const p = new PlayerController(start);
    const toward: Vec2 = [-Math.sin(start.heading), -Math.cos(start.heading)];
    p.setInput(toward);
    expect(runUntilDoor(p, 3)?.to.space).toBe("bakery");
    expect(p.state.space).toBe("bakery");
    // Walk straight back out through the entrance (south).
    p.setInput([0, 1]);
    expect(runUntilDoor(p, 3)?.to.space).toBe("town");
    expect(dist(p.state.pos, start.pos)).toBeLessThan(1e-9);
  });

  it("does not go through a door it only walks past", () => {
    const door = townDoorOf("general_store");
    const p = new PlayerController({ space: "town", pos: [door[0] + 0.3, door[1] - 2], heading: 0 });
    p.setInput([0, 1]);
    for (let t = 0; t < 2; t += DT) expect(p.update(DT)).toBeNull();
    expect(p.state.space).toBe("town");
  });

  it("freezes while a door transition is pending", () => {
    const p = new PlayerController(buildingExitPoint("cafe"));
    p.setInput([-Math.sin(p.state.heading), -Math.cos(p.state.heading)]);
    let door: DoorLink | null = null;
    for (let t = 0; t < 3 && !door; t += DT) door = p.update(DT);
    expect(door).not.toBeNull();
    const pos = [...p.state.pos];
    expect(p.update(DT)).toBeNull();
    expect(p.state.pos).toEqual(pos);
    expect(p.clickTo([30, 50])).toBe(false);
    expect(p.completeTransition()?.space).toBe("cafe");
    expect(p.transition).toBeNull();
  });

  it("runs faster than it walks", () => {
    const from = SPAWN_POINT;
    const a = new PlayerController({ space: "town", pos: from, heading: 0 });
    const b = new PlayerController({ space: "town", pos: from, heading: 0 });
    a.setInput([0, -1]);
    b.setInput([0, -1], true);
    a.update(0.5);
    b.update(0.5);
    expect(a.state.motion).toBe("walk");
    expect(b.state.motion).toBe("run");
    expect(dist(b.state.pos, from)).toBeGreaterThan(dist(a.state.pos, from) * 1.5);
  });

  // Build plan M13 acceptance: walk from the apartment to every building and inside it, then back.
  it("walks from the apartment to every building, inside it, and back home by click-to-move", () => {
    const p = new PlayerController(interiorArrivalPoint("apartment"));
    const visited: string[] = [];

    const leaveRoom = () => {
      const room = p.state.space;
      const exit = spaceDoors(room)[0]!;
      expect(p.clickTo(exit.centre), `click the ${room} door`).toBe(true);
      expect(runUntilDoor(p, 20)?.id, `leave ${room}`).toBe(exit.id);
      expect(p.state.space).toBe("town");
    };

    leaveRoom();
    for (const id of BUILDING_RECIPE_IDS) {
      const room = interiorForBuilding(id);
      // Click the building itself: walk to its door and through it.
      expect(p.clickTo(townDoorOf(id)), `path to ${id}`).toBe(true);
      const door = runUntilDoor(p, 120);
      expect(door?.to.space, `enter ${id}`).toBe(room);
      expect(p.state.space).toBe(room);
      // Walk to every spot in the room.
      for (const [name, spot] of Object.entries(INTERIOR_LAYOUTS[room].spots)) {
        if (name === "vendor") continue;
        expect(p.clickTo(spot), `${room}.${name}`).toBe(true);
        runUntilIdle(p, 20);
        expect(dist(p.state.pos, spot), `${room}.${name}`).toBeLessThan(0.1);
      }
      leaveRoom();
      expect(dist(p.state.pos, buildingExitPoint(id).pos)).toBeLessThan(1e-9);
      visited.push(id);
    }
    // And home again.
    expect(p.clickTo(townDoorOf("apartment_block"))).toBe(true);
    expect(runUntilDoor(p, 120)?.to.space).toBe("apartment");
    expect(p.state.space).toBe("apartment");
    expect(visited).toEqual([...BUILDING_RECIPE_IDS]);
  });

  it("walks home along an A* path with WASD-free clicks on open ground", () => {
    const p = new PlayerController({ space: "town", pos: [37, 44], heading: 0 });
    expect(p.clickTo(SPAWN_POINT)).toBe(true);
    runUntilIdle(p, 60);
    expect(dist(p.state.pos, SPAWN_POINT)).toBeLessThan(0.1);
  });

  it("refuses clicks it cannot reach", () => {
    const p = new PlayerController({ space: "town", pos: SPAWN_POINT, heading: 0 });
    // Far off the edge of the diorama.
    expect(p.clickTo([-10, 50])).toBe(false);
    expect(p.waypoints).toBeNull();
  });
});
