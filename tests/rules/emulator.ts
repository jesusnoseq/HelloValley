import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The demo project the emulators run under (`.firebaserc`). `demo-*` ids never reach production. */
export const PROJECT_ID = "demo-hellovalley";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const readRules = (file: string) => readFileSync(`${root}${file}`, "utf8");

export interface EmulatorTarget {
  host: string;
  port: number;
  /** True when the emulator answered. */
  available: boolean;
}

/**
 * Finds an emulator from its env var (set by `firebase emulators:exec`) or the default port in
 * `firebase.json`. When the env var is set the emulator is required and an unreachable one fails
 * the tests; otherwise (plain `npm test` without emulators) the rules suites are skipped.
 */
export async function findEmulator(envVar: string, fallback: string): Promise<EmulatorTarget> {
  const configured = process.env[envVar];
  const [host = "127.0.0.1", port = "0"] = (configured || fallback).split(":");
  const target = { host, port: Number(port) };
  try {
    await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) });
    return { ...target, available: true };
  } catch (err) {
    if (configured) throw new Error(`${envVar}=${configured} is set but the emulator is not reachable`, { cause: err });
    console.warn(`[rules tests] no emulator on ${host}:${port}; skipping (run \`npm run test:rules\`).`);
    return { ...target, available: false };
  }
}
