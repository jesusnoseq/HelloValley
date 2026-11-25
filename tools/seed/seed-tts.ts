/**
 * Admin seeding tool for shared TTS clips (build plan M22, architecture §6.3, §8.2). A stub: it
 * takes clips that were already generated and encoded (Ogg/Opus) and publishes each one as
 * Storage `tts/{hash}.ogg` plus Firestore `cache/tts/{hash}` with the Admin SDK. Players only read
 * these; play-time audio is cached per player in IndexedDB, never here.
 *
 *   npm run seed:tts -- <manifest.json>                         dry run: validate and print the plan
 *   npm run seed:tts -- <manifest.json> --write --project <id>  publish (needs admin credentials)
 *
 * The manifest: `{ "lines": [{ "npcId", "lang", "level", "text", "clip": "<path>.ogg", "durationMs" }] }`,
 * clip paths relative to the manifest. The hash is `sha256(ttsKeyMaterial(line))`, the same key
 * the client computes, so a seeded line is found by the text it shows.
 *
 * TODO(seeding tool, no milestone yet, see pending.md): generate the lines and their audio
 * (seeded openers, barks, labels, intro) with the voice mapping in shared `ai/tts.ts`, encode PCM to
 * Opus, and set the `admin: true` custom claim for the seeding account.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type CachedTts, CachedTtsSchema, FirestorePaths, getNpc, LevelSchema, NpcIdSchema, ttsKeyMaterial, ttsStoragePath } from "../../packages/shared/src/index";

/** `storage.rules` caps a clip at 1 MB. */
export const MAX_CLIP_BYTES = 1024 * 1024;

export const SeedManifestSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        npcId: NpcIdSchema,
        lang: z.string().min(2).max(20),
        level: LevelSchema,
        text: z.string().trim().min(1).max(800),
        clip: z.string().regex(/\.ogg$/i, "clips are Ogg/Opus files"),
        durationMs: z.number().int().min(1).max(60_000),
      }),
    )
    .min(1)
    .max(5000),
});
export type SeedManifest = z.infer<typeof SeedManifestSchema>;

export interface SeedEntry {
  hash: string;
  storagePath: string;
  docPath: string;
  doc: CachedTts;
  clipFile: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Validates the manifest and the clip files, and computes where each clip goes. */
export async function planTtsSeed(manifestPath: string): Promise<SeedEntry[]> {
  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = SeedManifestSchema.parse(raw);
  const base = dirname(resolve(manifestPath));
  const seen = new Set<string>();
  const entries: SeedEntry[] = [];
  for (const line of manifest.lines) {
    const hash = sha256Hex(ttsKeyMaterial(line));
    if (seen.has(hash)) throw new Error(`duplicate line: ${line.npcId} ${line.lang} ${line.level} "${line.text}"`);
    seen.add(hash);
    const clipFile = resolve(base, line.clip);
    const size = (await stat(clipFile)).size;
    if (size === 0 || size > MAX_CLIP_BYTES) throw new Error(`${line.clip}: ${size} bytes (1..${MAX_CLIP_BYTES} allowed)`);
    const head = (await readFile(clipFile)).subarray(0, 4).toString("latin1");
    if (head !== "OggS") throw new Error(`${line.clip}: not an Ogg file`);
    const storagePath = ttsStoragePath(hash);
    const doc = CachedTtsSchema.parse({ storagePath, voice: getNpc(line.npcId).voice.prebuiltVoice, durationMs: line.durationMs });
    entries.push({ hash, storagePath, docPath: FirestorePaths.cacheEntry("tts", hash), doc, clipFile });
  }
  return entries;
}

/** Uploads every clip, then writes its doc (so a doc never points at a missing clip). */
export async function writeTtsSeed(entries: readonly SeedEntry[], projectId: string, bucket: string): Promise<void> {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getStorage } = await import("firebase-admin/storage");
  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const app = initializeApp(emulated ? { projectId, storageBucket: bucket } : { projectId, storageBucket: bucket, credential: applicationDefault() }, "hellovalley-seed");
  const db = getFirestore(app);
  const files = getStorage(app).bucket();
  for (const e of entries) {
    await files.file(e.storagePath).save(await readFile(e.clipFile), { contentType: "audio/ogg", resumable: false });
    await db.doc(e.docPath).set(e.doc);
    console.log(`seeded ${e.docPath} → ${e.storagePath}`);
  }
}

function arg(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(args: readonly string[]): Promise<number> {
  const manifest = args[0];
  if (!manifest || manifest.startsWith("--")) {
    console.error("usage: seed-tts <manifest.json> [--write --project <id> [--bucket <name>]]");
    return 2;
  }
  const entries = await planTtsSeed(manifest);
  for (const e of entries) console.log(`${e.hash}  ${e.doc.voice.padEnd(14)} ${e.doc.durationMs} ms  ${e.clipFile}`);
  if (!args.includes("--write")) {
    console.log(`dry run: ${entries.length} clip(s) validated, nothing written (add --write --project <id>)`);
    return 0;
  }
  const projectId = arg(args, "--project");
  if (!projectId) {
    console.error("--write needs --project <id>");
    return 2;
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("--write needs GOOGLE_APPLICATION_CREDENTIALS (an admin service account) or the emulators");
    return 2;
  }
  await writeTtsSeed(entries, projectId, arg(args, "--bucket") ?? `${projectId}.appspot.com`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
