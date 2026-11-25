import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ttsKeyMaterial } from "../../packages/shared/src/index";
import { main, planTtsSeed, sha256Hex } from "../../tools/seed/seed-tts";

// The seeding tool stub (build plan M22). Only the dry run is exercised: nothing here talks to a
// Firebase project or the emulators.
let dir = "";
const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60, 1)]);
const line = { npcId: "baker", lang: "es", level: "A1", text: "¡Buenos días!", clip: "hola.ogg", durationMs: 900 };

async function manifest(lines: unknown[]) {
  const path = join(dir, "manifest.json");
  await writeFile(path, JSON.stringify({ lines }));
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hv-seed-"));
  await writeFile(join(dir, "hola.ogg"), ogg);
  await writeFile(join(dir, "bad.ogg"), Buffer.from("RIFF0000"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("seed-tts plan", () => {
  it("keys each clip like the client does and points the doc at its own clip", async () => {
    const [entry] = await planTtsSeed(await manifest([line]));
    // The client hashes the same material with Web Crypto.
    const web = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ttsKeyMaterial(line as never)))).toString("hex");
    expect(entry!.hash).toBe(web);
    expect(entry!.hash).toBe(sha256Hex(ttsKeyMaterial(line as never)));
    expect(entry!.storagePath).toBe(`tts/${web}.ogg`);
    expect(entry!.docPath).toBe(`cache/tts/${web}`);
    expect(entry!.doc).toEqual({ storagePath: `tts/${web}.ogg`, voice: "Sulafat", durationMs: 900 });
  });

  it("rejects bad manifests and clips", async () => {
    await expect(planTtsSeed(await manifest([{ ...line, npcId: "ghost" }]))).rejects.toThrow();
    await expect(planTtsSeed(await manifest([{ ...line, clip: "hola.wav" }]))).rejects.toThrow(/Ogg/);
    await expect(planTtsSeed(await manifest([{ ...line, clip: "bad.ogg" }]))).rejects.toThrow(/not an Ogg/);
    await expect(planTtsSeed(await manifest([line, line]))).rejects.toThrow(/duplicate/);
  });

  it("is a dry run unless --write, and --write needs a project", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = await manifest([line]);
    expect(await main([path])).toBe(0);
    expect(await main([path, "--write"])).toBe(2);
    expect(await main([])).toBe(2);
  });
});
