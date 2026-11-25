import { describe, expect, it } from "vitest";
import { NPC_IDS } from "../data/npcs";
import { interiorArrivalPoint, PlayerController } from "./player";
import { nearestInteractable } from "./interactables";
import { circleFits } from "./movement";
import { interiorNavGrid } from "./interiors";
import {
  canTalkTo,
  headingTowards,
  NPC_POSTS,
  NPC_TALK_RADIUS_M,
  NPC_WALK_AWAY_M,
  npcDistance,
  npcsInSpace,
  pickNpc,
  walkedAway,
} from "./npcPosts";

describe("NPC posts (build plan M23)", () => {
  it("puts each villager in one room, with a talk spot the player can walk to from the door", () => {
    const rooms = new Set<string>();
    for (const id of NPC_IDS) {
      const post = NPC_POSTS[id];
      expect(post.npcId).toBe(id);
      rooms.add(post.space);
      expect(npcsInSpace(post.space).map((p) => p.npcId)).toEqual([id]);
      // The talk spot is standable, within talking reach, and reachable from the entrance.
      expect(circleFits(interiorNavGrid(post.space), post.talkSpot), id).toBe(true);
      expect(npcDistance(id, post.space, post.talkSpot), id).toBeLessThanOrEqual(NPC_TALK_RADIUS_M);
      const player = new PlayerController(interiorArrivalPoint(post.space));
      expect(player.clickTo(post.talkSpot), id).toBe(true);
      for (let k = 0; k < 900 && player.waypoints; k++) player.update(1 / 60);
      expect(nearestInteractable(post.space, player.state.pos), id).toMatchObject({ kind: "npc", npcId: id });
    }
    expect(rooms.size).toBe(NPC_IDS.length);
    expect(npcsInSpace("town")).toEqual([]);
  });

  it("checks talking reach and walking away, per space", () => {
    const { pos, space } = NPC_POSTS.baker;
    expect(canTalkTo("baker", space, [pos[0], pos[1] + NPC_TALK_RADIUS_M - 0.01])).toBe(true);
    expect(canTalkTo("baker", space, [pos[0], pos[1] + NPC_TALK_RADIUS_M + 0.2])).toBe(false);
    expect(canTalkTo("baker", space, [pos[0], pos[1] + NPC_TALK_RADIUS_M + 0.2], 0.5)).toBe(true);
    expect(canTalkTo("baker", "cafe", pos)).toBe(false);
    expect(walkedAway("baker", space, [pos[0], pos[1] + NPC_WALK_AWAY_M - 0.1])).toBe(false);
    expect(walkedAway("baker", space, [pos[0], pos[1] + NPC_WALK_AWAY_M + 0.1])).toBe(true);
    expect(walkedAway("baker", "town", pos)).toBe(true);
  });

  it("picks the NPC a click ray hits", () => {
    const { pos, space } = NPC_POSTS.baker;
    // Straight down onto the baker's head, and just beside them.
    expect(pickNpc(space, [pos[0], 10, pos[1]], [0, -1, 0])).toBe("baker");
    expect(pickNpc(space, [pos[0] + 1, 10, pos[1]], [0, -1, 0])).toBeNull();
    expect(pickNpc("cafe", [pos[0], 10, pos[1]], [0, -1, 0])).toBeNull();
    // A slanted camera ray from the south-east, aimed at the chest.
    const target = [pos[0], 1, pos[1]];
    const origin = [target[0]! + 6, 8, target[2]! + 6] as const;
    const dir = [target[0]! - origin[0], target[1]! - origin[1], target[2]! - origin[2]] as const;
    expect(pickNpc(space, [...origin], [...dir])).toBe("baker");
  });

  it("turns towards a point", () => {
    expect(Math.cos(headingTowards([0, 0], [0, 1]))).toBeCloseTo(1);
    expect(Math.sin(headingTowards([0, 0], [1, 0]))).toBeCloseTo(1);
  });
});
