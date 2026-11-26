/// <reference types="node" />
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_BUDGET_BYTES, AUDIO_CLIPS } from "@hellovalley/shared";

// The committed placeholder clips (build plan M35), generated with `npm run assets:audio`.
const DIR = new URL("../../public/assets/audio/", import.meta.url);
const path = (file: string) => fileURLToPath(new URL(file, DIR));

describe("audio clips (public/assets/audio)", () => {
  it("has every catalog clip as Ogg/Opus, inside the download budget", () => {
    let total = 0;
    for (const clip of Object.values(AUDIO_CLIPS)) {
      const bytes = readFileSync(path(clip.file));
      expect(bytes.subarray(0, 4).toString("latin1"), clip.file).toBe("OggS");
      expect(bytes.includes(Buffer.from("OpusHead")), clip.file).toBe(true);
      total += statSync(path(clip.file)).size;
    }
    expect(total).toBeLessThan(AUDIO_BUDGET_BYTES);
  });
});
