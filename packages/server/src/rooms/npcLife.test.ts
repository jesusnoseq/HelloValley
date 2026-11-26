import { clockToMinutes, NPC_POSTS, NPC_TICK_MS, phaseForClockMinutes, targetAt, WORLD_DAY_MS, WORLD_EPOCH_MS } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import { type LifeEvents, NpcLife } from "./npcLife";

/** The NPC life of one shard on its own (build plan M31): pausing, jumps, idle emotes and small talk. */

const atMinute = (minutes: number) => WORLD_EPOCH_MS + 100 * WORLD_DAY_MS + Math.round(phaseForClockMinutes(minutes) * WORLD_DAY_MS);

function setup(minute: number) {
  const clock = { now: atMinute(minute) };
  const life = new NpcLife({ now: () => clock.now, random: () => 0 });
  const tick = (talking = new Map(), listeners: { space: "town" | "bakery"; pos: [number, number] }[] = []) => {
    clock.now += NPC_TICK_MS;
    return life.tick(talking, listeners);
  };
  /** Ticks for `seconds` of game time, collecting what happened. */
  const run = (seconds: number, listeners: { space: "town" | "bakery"; pos: [number, number] }[] = []) => {
    const all: LifeEvents = { emotes: [], barks: [] };
    for (let t = 0; t < seconds * 1000; t += NPC_TICK_MS) {
      const e = tick(new Map(), listeners);
      all.emotes.push(...e.emotes);
      all.barks.push(...e.barks);
    }
    return all;
  };
  return { clock, life, tick, run };
}

describe("NpcLife", () => {
  it("places everyone at their schedule target and walks them on when the point changes", () => {
    const { clock, life, tick } = setup(11 * 60 + 59);
    expect(life.locate("baker")).toMatchObject({ space: "bakery", pos: NPC_POSTS.baker.pos });
    clock.now = atMinute(12 * 60);
    tick();
    expect(life.walker("baker").motion).toBe("walk");
    for (let k = 0; k < 400 && life.walker("baker").legs.length > 0; k++) tick();
    const target = targetAt("baker", clockToMinutes("12:00")!);
    expect(life.locate("baker")).toMatchObject({ space: target.space });
    expect(Math.hypot(life.locate("baker").pos[0] - target.pos[0], life.locate("baker").pos[1] - target.pos[1])).toBeLessThan(0.3);
  });

  it("stops a villager someone talks to and turns it towards them", () => {
    const { clock, life, tick } = setup(11 * 60 + 59);
    clock.now = atMinute(12 * 60);
    const player: [number, number] = [NPC_POSTS.baker.talkSpot[0], NPC_POSTS.baker.talkSpot[1]];
    for (let k = 0; k < 20; k++) tick(new Map([["baker", player]]));
    expect(life.locate("baker")).toMatchObject({ space: "bakery", pos: NPC_POSTS.baker.pos });
    expect(life.walker("baker").motion).toBe("idle");
    // Free again: off to lunch.
    tick();
    expect(life.walker("baker").motion).toBe("walk");
  });

  it("puts everyone where their schedule says after a clock jump", () => {
    const { clock, life, tick } = setup(7 * 60);
    clock.now = atMinute(19 * 60 + 30);
    tick();
    expect(life.locate("mayor").space).toBe("town");
    expect(life.locate("barista").space).toBe("cafe");
  });

  it("plays idle emotes and gives a seated player small talk from the nearest villager", () => {
    const { life, run } = setup(7 * 60);
    const emotes = run(13).emotes;
    expect(emotes).toContainEqual({ npcId: "baker", emote: "think", space: "bakery" });
    const near: [number, number] = [NPC_POSTS.baker.pos[0] + 1, NPC_POSTS.baker.pos[1] + 1];
    expect(life.smallTalk("bakery", near, new Map())).toMatchObject({ bark: { kind: "solo", npcId: "baker", activity: "work" }, space: "bakery" });
    expect(life.smallTalk("town", [1, 1], new Map())).toBeNull();
    // A listener next to the Baker hears a solo line once the cooldowns allow.
    const barks = run(50, [{ space: "bakery", pos: near }]).barks;
    expect(barks[0]).toMatchObject({ bark: { kind: "solo", npcId: "baker" }, space: "bakery" });
    // Nobody to hear: no barks.
    expect(run(60).barks).toEqual([]);
  });
});
