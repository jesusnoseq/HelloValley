import { describe, expect, it } from "vitest";
import { CROWD_OPTIONS, crowdDrawItems, crowdDraws, CrowdRegistry, planCrowd, type CrowdMember } from "./crowdPlan";
import { estimateDrawCalls } from "./drawCalls";

const ring = (n: number, r: number, prefix = "p"): CrowdMember[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, x: Math.cos((i / n) * Math.PI * 2) * r, z: Math.sin((i / n) * Math.PI * 2) * r }));

describe("crowd level of detail", () => {
  it("keeps a lone character in full detail with its real shadow", () => {
    const plan = planCrowd([0, 0], [{ id: "a", x: 3, z: 0 }]);
    expect(plan.lod.get("a")).toEqual({ full: true, shadow: true });
    expect(plan.impostors).toEqual([]);
    expect(plan.blobs).toEqual([]);
    expect(plan.draws).toBe(crowdDraws(1, 1, 0, 0));
  });

  it("spends the budget nearest first: full detail, then real shadows", () => {
    const plan = planCrowd([0, 0], [
      { id: "far", x: 10, z: 0 },
      { id: "near", x: 2, z: 0 },
    ]);
    expect(plan.lod.get("near")).toEqual({ full: true, shadow: true });
    expect(plan.lod.get("far")).toEqual({ full: true, shadow: false });
    expect(plan.blobs).toEqual(["far"]);
    expect(plan.draws).toBeLessThanOrEqual(CROWD_OPTIONS.drawBudget);
  });

  it("draws characters beyond the radius as impostors", () => {
    const plan = planCrowd([0, 0], [{ id: "a", x: CROWD_OPTIONS.fullRadiusM + 1, z: 0 }]);
    expect(plan.lod.get("a")).toEqual({ full: false, shadow: false });
    expect(plan.impostors).toEqual(["a"]);
    expect(plan.blobs).toEqual(["a"]);
  });

  it("keeps a full 40-player shard and the nine villagers in one place inside the budget", () => {
    const members = [...ring(40, 3), ...ring(9, 5, "npc")];
    const plan = planCrowd([0, 0], members);
    const full = [...plan.lod.values()].filter((l) => l.full).length;
    expect(full).toBe(CROWD_OPTIONS.fullMax);
    expect(plan.impostors).toHaveLength(members.length - full);
    expect(plan.blobs.length + [...plan.lod.values()].filter((l) => l.shadow).length).toBe(members.length);
    expect(plan.draws).toBeLessThanOrEqual(CROWD_OPTIONS.drawBudget);
    const estimate = estimateDrawCalls(crowdDrawItems(plan), { post: false });
    expect(estimate.total).toBe(plan.draws);
  });

  it("puts the villager in the conversation first, however far", () => {
    const plan = planCrowd([0, 0], [...ring(10, 1), { id: "baker", x: 30, z: 0, pinned: true }]);
    expect(plan.lod.get("baker")?.full).toBe(true);
  });

  it("does not flicker between two characters at the same distance", () => {
    const first = planCrowd([0, 0], [...ring(3, 2), { id: "x", x: 2.4, z: 0 }]);
    const fullBefore = [...first.lod].filter(([, l]) => l.full).map(([id]) => id);
    // "x" moves a little closer than one of the full ones, but not past the hysteresis.
    const second = planCrowd([0, 0], [...ring(3, 2), { id: "x", x: 1.6, z: 0 }], first.lod);
    expect([...second.lod].filter(([, l]) => l.full).map(([id]) => id)).toEqual(fullBefore);
  });

  it("plans at a limited rate and forgets characters that stop reporting", () => {
    const registry = new CrowdRegistry();
    registry.report({ id: "a", x: 1, z: 0, visible: true, color: "#fff" }, 0);
    expect(registry.lod("a")).toEqual({ full: true, shadow: true });
    registry.update([0, 0], 0);
    for (let i = 0; i < 5; i++) registry.report({ id: `b${i}`, x: 2, z: i, visible: true, color: "#fff" }, 100);
    // Too soon: the previous plan holds.
    expect(registry.update([0, 0], 100).lod.size).toBe(1);
    expect(registry.update([0, 0], 400).lod.size).toBe(6);
    // Hidden characters (another space) are not planned; stale ones drop.
    registry.report({ id: "a", x: 1, z: 0, visible: false, color: "#fff" }, 700);
    expect(registry.update([0, 0], 700).lod.has("a")).toBe(false);
    expect(registry.update([0, 0], 2000).lod.size).toBe(0);
  });
});
