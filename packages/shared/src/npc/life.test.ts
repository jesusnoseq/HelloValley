import { describe, expect, it } from "vitest";
import { getNpc, NPC_IDS } from "../data/npcs";
import { clockToMinutes } from "../data/world";
import { elderDockSpot } from "../fishing/spots";
import { circleFits } from "../world/movement";
import { canTalkTo, NPC_POSTS, npcsInSpace, pickNpc, talkSpotFor, walkedAway } from "../world/npcPosts";
import { nearestInteractable } from "../world/interactables";
import { spaceGrid } from "../world/player";
import {
  activityState,
  atTarget,
  exchangePairs,
  NPC_RADIUS_M,
  pickIdle,
  placeWalker,
  planNpcRoute,
  relationshipOf,
  retarget,
  scheduleIndexAt,
  stepWalker,
  targetAt,
  targetFor,
  visitorSpots,
  walkerWhere,
} from "./life";

/** Steps a walker until it arrives (or gives up after `maxS` simulated seconds). */
function walk(w: ReturnType<typeof placeWalker>, maxS = 400): { seconds: number; spaces: Set<string> } {
  const spaces = new Set<string>([w.space]);
  let t = 0;
  for (; t < maxS; t += 0.2) {
    const r = stepWalker(w, 0.2);
    spaces.add(w.space);
    if (r === "arrived" || r === "standing") break;
  }
  return { seconds: t, spaces };
}

describe("NPC life (build plan M31)", () => {
  it("gives every schedule point a standable target; work and home are the NPC's own post", () => {
    for (const id of NPC_IDS) {
      const npc = getNpc(id);
      for (const point of npc.schedule) {
        const t = targetFor(id, point);
        expect(circleFits(spaceGrid(t.space), t.pos, NPC_RADIUS_M), `${id} ${point.at} ${point.place}`).toBe(true);
        if (point.place === npc.building) expect(t.pos).toEqual(NPC_POSTS[id].pos);
      }
    }
    // The Elder fishes on the dock's north end, as in M27.
    expect(targetAt("elder", clockToMinutes("06:00")!).pos).toEqual(elderDockSpot());
  });

  it("keeps visitors clear of the owner's counter and of each other", () => {
    const spots = visitorSpots("cafe");
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const s of spots) expect(Math.hypot(s[0] - NPC_POSTS.barista.talkSpot[0], s[1] - NPC_POSTS.barista.talkSpot[1])).toBeGreaterThanOrEqual(1);
    const mayor = targetAt("mayor", clockToMinutes("12:30")!);
    const gossip = targetAt("gossip", clockToMinutes("12:30")!);
    expect(mayor.space).toBe("cafe");
    expect(gossip.space).toBe("cafe");
    expect(Math.hypot(mayor.pos[0] - gossip.pos[0], mayor.pos[1] - gossip.pos[1])).toBeGreaterThan(0.8);
  });

  it("walks every villager through a whole day with A*, through the doors, to each target", () => {
    for (const id of NPC_IDS) {
      const points = getNpc(id).schedule;
      const w = placeWalker(id, clockToMinutes(points[points.length - 1]!.at)!);
      for (let i = 0; i < points.length; i++) {
        const minute = clockToMinutes(points[i]!.at)!;
        expect(scheduleIndexAt(id, minute)).toBe(i);
        const target = targetAt(id, minute);
        retarget(w, i, target);
        const { seconds } = walk(w);
        expect(atTarget(w), `${id} → ${points[i]!.place}`).toBe(true);
        expect(w.motion).toBe("idle");
        expect(w.heading).toBeCloseTo(target.facing);
        // A walk across town takes well under an in-game hour (100 s).
        expect(seconds, `${id} → ${points[i]!.place}`).toBeLessThan(120);
      }
    }
  });

  it("plans routes across an exit and an entrance door", () => {
    const from = NPC_POSTS.baker;
    const legs = planNpcRoute(from, { space: "library", pos: NPC_POSTS.librarian.talkSpot })!;
    expect(legs.map((l) => l.space)).toEqual(["bakery", "town", "library"]);
    expect(legs[0]!.exit?.space).toBe("town");
    expect(legs[1]!.exit?.space).toBe("library");
    expect(legs[2]!.exit).toBeNull();
    // Inside one room it is one leg.
    expect(planNpcRoute(from, { space: "bakery", pos: [1, 3] })!).toHaveLength(1);
  });

  it("is walking mid-route and checks talking against the live position", () => {
    const w = placeWalker("baker", clockToMinutes("11:00")!);
    expect(w.space).toBe("bakery");
    retarget(w, 1, targetAt("baker", clockToMinutes("12:00")!));
    for (let k = 0; k < 40; k++) stepWalker(w, 0.2);
    expect(w.motion).toBe("walk");
    const where = walkerWhere(w);
    const locate = (id: (typeof NPC_IDS)[number]) => (id === "baker" ? where : NPC_POSTS[id]);
    const near: [number, number] = [where.pos[0] + 1, where.pos[1]];
    expect(canTalkTo("baker", where.space, near, 0, locate)).toBe(true);
    expect(canTalkTo("baker", where.space, near)).toBe(where.space === "bakery" && canTalkTo("baker", "bakery", near));
    expect(walkedAway("baker", where.space, [where.pos[0] + 5, where.pos[1]], locate)).toBe(true);
    expect(npcsInSpace(where.space, locate).map((n) => n.npcId)).toContain("baker");
    expect(pickNpc(where.space, [where.pos[0], 10, where.pos[1]], [0, -1, 0], locate)).toBe("baker");
    expect(nearestInteractable(where.space, near, locate)).toMatchObject({ kind: "npc", npcId: "baker" });
    // A click on a walking NPC walks to a point in front of them; at the post, the talk spot.
    const spot = talkSpotFor(where, [where.pos[0] + 4, where.pos[1]]);
    expect(Math.hypot(spot[0] - where.pos[0], spot[1] - where.pos[1])).toBeCloseTo(1.2);
    expect(talkSpotFor(NPC_POSTS.baker, [0, 0])).toEqual(NPC_POSTS.baker.talkSpot);
  });

  it("picks idle behaviours by activity: strolls on a walk, emotes otherwise, nothing asleep", () => {
    const strolling = placeWalker("mayor", clockToMinutes("19:00")!);
    expect(strolling.target.activity).toBe("walk");
    const idle = pickIdle(strolling, () => 0.3);
    expect(idle?.kind).toBe("stroll");
    if (idle?.kind === "stroll") expect(circleFits(spaceGrid(idle.goal.space), idle.goal.pos, NPC_RADIUS_M)).toBe(true);
    expect(pickIdle(placeWalker("baker", clockToMinutes("07:00")!), () => 0)).toEqual({ kind: "emote", emote: "think" });
    expect(pickIdle(placeWalker("baker", clockToMinutes("23:00")!), () => 0)).toBeNull();
    expect(activityState("fish")).toBe("fishing");
    expect(activityState("eat")).toBe("eating");
    expect(activityState("work")).toBe("");
  });

  it("finds related villagers close enough for an exchange", () => {
    // 15:00: the Barista reads at the library, where the Librarian works (a secret crush).
    const at = clockToMinutes("15:30")!;
    const walkers = NPC_IDS.map((id) => walkerWhere(placeWalker(id, at)));
    expect(exchangePairs(walkers)).toContainEqual({ a: "barista", b: "librarian" });
    expect(relationshipOf("librarian", "barista")?.kind).toBe("secret_crush");
    expect(relationshipOf("baker", "doctor")).toBeNull();
  });
});
