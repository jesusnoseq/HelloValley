/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { STYLE_IDS, townPlaces } from "@hellovalley/shared";
import { crowdDrawItems, planCrowd } from "./crowdPlan";
import { DRAW_CALL_BUDGET, estimateDrawCalls, TRIANGLE_BUDGET } from "./drawCalls";
import { createKitLoader } from "./kitLoader";
import { playerDrawItems } from "./playerDraw";
import { townDrawItems } from "./Town";
import { buildCommonLayer, buildStyleLayer, castsShadow, disposeTownLayer, sampleFlats } from "./townMeshes";
import { buildVegetation, disposeVegetation } from "./vegetation";

/**
 * Automated town measurements per style for docs/perf.md (build plan M37): triangles of every
 * layer, meshes, and the draw-call estimate (main pass, shadow pass, post-processing) with the
 * local player, and with a full 40-player shard plus the nine villagers on the square.
 * `npm run perf:measure` sets HV_PERF_REPORT to write them as JSON; as a test it only checks the
 * budgets hold.
 */

const PUBLIC = new URL("../../public/", import.meta.url);
const present = ["common", ...STYLE_IDS].every((k) => existsSync(fileURLToPath(new URL(`assets/kits/${k}/kit-manifest.json`, PUBLIC))));

function fetchFromPublic(url: string) {
  const file = fileURLToPath(new URL(url.replace(/^\//, ""), PUBLIC));
  const ok = existsSync(file);
  const bytes = ok ? readFileSync(file) : Buffer.alloc(0);
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8"))),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  });
}

describe.skipIf(!present)("perf report", () => {
  it("measures every style's town", async () => {
    const loader = createKitLoader({ baseUrl: "/", fetchImpl: fetchFromPublic, loadTexture: () => Promise.resolve(new Texture()) });
    const kit = await loader.load("common");
    const common = await buildCommonLayer(kit);
    const vegetation = await buildVegetation(kit, (await sampleFlats(kit)).ground.grass);
    const square = townPlaces().town_square;
    const crowd = planCrowd(
      square,
      Array.from({ length: 49 }, (_, i) => ({ id: `c${i}`, x: square[0] + (i % 7) - 3, z: square[1] + Math.floor(i / 7) - 3 })),
    );
    const styles = [];
    for (const style of STYLE_IDS) {
      const layer = await buildStyleLayer(await loader.loadStyle(style), kit);
      const items = [...townDrawItems(common, layer, vegetation), ...playerDrawItems()];
      const town = estimateDrawCalls(items);
      const crowded = estimateDrawCalls([...items, ...crowdDrawItems(crowd)]);
      const triangles = common.triangles + layer.triangles + vegetation.triangles;
      styles.push({
        style,
        triangles: { total: triangles, common: common.triangles, style: layer.triangles, vegetation: vegetation.triangles, budget: TRIANGLE_BUDGET },
        meshes: { common: common.parts.length, style: layer.parts.length, shadowCasters: [...common.parts, ...layer.parts].filter(castsShadow).length },
        drawCalls: { town, fullShard: crowded, budget: DRAW_CALL_BUDGET },
      });
      expect(triangles).toBeLessThan(TRIANGLE_BUDGET);
      expect(crowded.total).toBeLessThan(DRAW_CALL_BUDGET);
      disposeTownLayer(layer);
    }
    disposeTownLayer(common);
    disposeVegetation(vegetation);
    const out = process.env.HV_PERF_REPORT;
    if (out) writeFileSync(out, `${JSON.stringify({ measuredAt: new Date().toISOString(), crowd: { members: 49, draws: crowd.draws, full: crowd.lod.size - crowd.impostors.length }, styles }, null, 2)}\n`);
  }, 120_000);
});
