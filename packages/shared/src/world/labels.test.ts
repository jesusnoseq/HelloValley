import { describe, expect, it } from "vitest";
import { ITEM_IDS, itemLabelKey } from "../data/items";
import { NotebookSourceSchema } from "../firestore/schemas";
import { estimateTokens, ON_DEVICE_PROMPT_TOKEN_BUDGET, parseTaskAnswer, ROUTING_TABLE, WORLD_LABELS_BATCH, worldLabelsPrompt } from "../ai/index";
import { INTERIOR_IDS } from "./interiors";
import { spaceInteractables } from "./interactables";
import {
  isLabelKey,
  LABEL_KEY_PATTERN,
  LABEL_KEYS,
  LABEL_REGISTRY,
  labelEnglish,
  labelledObjects,
  npcLabelKey,
  pickLabel,
} from "./labels";
import { npcPost } from "./npcPosts";
import type { SpaceId } from "./player";

const SPACES: SpaceId[] = ["town", ...INTERIOR_IDS];

describe("world labels (GDD §6.5, build plan M25)", () => {
  it("every key is a valid notebook object source with an English word", () => {
    expect(LABEL_KEYS.length).toBeGreaterThan(50);
    for (const key of LABEL_KEYS) {
      expect(key).toMatch(LABEL_KEY_PATTERN);
      expect(NotebookSourceSchema.safeParse(`object:${key}`).success).toBe(true);
      expect(LABEL_REGISTRY[key]!.trim().length).toBeGreaterThan(0);
    }
  });

  it("every interactable has a registered labelKey", () => {
    for (const space of SPACES) for (const it of spaceInteractables(space)) expect(isLabelKey(it.labelKey), `${space} ${it.id}`).toBe(true);
    expect(spaceInteractables("apartment").find((i) => i.kind === "mirror")?.labelKey).toBe("furniture.mirror");
    expect(spaceInteractables("town").find((i) => i.kind === "intercom")?.labelKey).toBe("object.intercom");
  });

  it("every item and every labelled object has a registered key", () => {
    for (const id of ITEM_IDS) expect(isLabelKey(itemLabelKey(id))).toBe(true);
    for (const space of SPACES) {
      const objects = labelledObjects(space);
      expect(objects.length, space).toBeGreaterThan(0);
      for (const o of objects) {
        expect(isLabelKey(o.labelKey), `${space} ${o.id}`).toBe(true);
        expect(o.max[1]).toBeGreaterThan(o.min[1]);
      }
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    }
    expect(labelEnglish("item.bread")).toBe("bread");
    expect(labelEnglish("npc.baker")).toBe("baker");
    expect(labelEnglish("unknown.big_thing")).toBe("big thing");
  });

  it("picks the nearest object along a ray", () => {
    const post = npcPost("baker");
    const objects = labelledObjects(post.space);
    // Straight down onto the Baker's head.
    const hit = pickLabel(objects, [post.pos[0], 10, post.pos[1]], [0, -1, 0]);
    expect(hit?.labelKey).toBe(npcLabelKey("baker"));
    expect(pickLabel(objects, [post.pos[0], 10, post.pos[1]], [0, 1, 0])).toBeNull();
    const fountain = labelledObjects("town").find((o) => o.labelKey === "prop.fountain")!;
    const centre = [(fountain.min[0] + fountain.max[0]) / 2, (fountain.min[2] + fountain.max[2]) / 2] as const;
    expect(pickLabel(labelledObjects("town"), [centre[0], 30, centre[1]], [0, -1, 0])?.labelKey).toBe("prop.fountain");
  });

  it("names town props as the player's style shows them (M34 dressing)", () => {
    const keys = (style: "european" | "japanese" | "arabic") => new Set(labelledObjects("town", undefined, undefined, style).map((o) => o.labelKey));
    expect(keys("japanese").has("prop.lantern.stone")).toBe(true);
    expect(keys("japanese").has("prop.bridge.wooden")).toBe(true);
    expect(keys("european").has("prop.lantern.stone")).toBe(false);
    expect(keys("arabic").has("prop.fountain.courtyard")).toBe(true);
    expect(keys("arabic").has("prop.fountain")).toBe(false);
    for (const k of keys("japanese")) expect(isLabelKey(k), k).toBe(true);
  });

  it("uses the apartment's live layout when given", () => {
    const objects = labelledObjects("apartment", [{ module: "bed", variant: 0, at: [1, 1], rot: 0 }]);
    expect(objects.filter((o) => o.labelKey.startsWith("furniture."))).toHaveLength(1);
  });
});

describe("world labels prompt and schema", () => {
  const items = LABEL_KEYS.slice(0, WORLD_LABELS_BATCH).map((key) => ({ key, english: labelEnglish(key) }));

  it("asks for one batch in the target language, near the on-device budget", () => {
    const prompt = worldLabelsPrompt({ targetLang: "ja", items });
    expect(prompt).toContain("Japanese");
    expect(prompt).toContain(`"key":"${items[0]!.key}"`);
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(ON_DEVICE_PROMPT_TOKEN_BUDGET * 1.5);
    expect(() => worldLabelsPrompt({ targetLang: "es", items: LABEL_KEYS.map((key) => ({ key, english: key })) })).toThrow();
    expect(ROUTING_TABLE.worldLabels).toMatchObject({ cache: "persist" });
  });

  it("drops bad entries and keeps the reading only when it differs", () => {
    const parsed = parseTaskAnswer(
      "worldLabels",
      JSON.stringify({
        labels: [
          { key: "item.bread", word: " パン ", reading: "pan" },
          { key: "item.milk", word: "leche", reading: "leche" },
          { key: "BAD KEY", word: "x" },
          { key: "item.egg", word: "" },
          { key: "item.honey", word: "miel", reading: null },
        ],
      }),
    );
    expect(parsed.labels).toEqual([
      { key: "item.bread", word: "パン", reading: "pan" },
      { key: "item.milk", word: "leche" },
      { key: "item.honey", word: "miel" },
    ]);
    expect(() => parseTaskAnswer("worldLabels", '{"nope":1}')).toThrow();
  });
});
