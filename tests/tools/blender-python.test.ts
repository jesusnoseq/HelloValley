import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Runs the pure-Python unit tests of the Blender generator (tools/blender/tests) when a
// Python 3 interpreter is on PATH; skips otherwise. Blender itself is not needed.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function findPython(): string[] | null {
  for (const cmd of [["python3"], ["python"], ["py", "-3"]]) {
    const [exe = "", ...pre] = cmd;
    const r = spawnSync(exe, [...pre, "--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && /^Python 3\./.test(`${r.stdout}${r.stderr}`.trim())) return cmd;
  }
  return null;
}

const python = findPython();

describe.skipIf(!python)("tools/blender Python tests", () => {
  it("pass under unittest", () => {
    const [exe = "", ...pre] = python ?? [];
    const r = spawnSync(
      exe,
      [...pre, "-B", "-m", "unittest", "discover", "-s", "tools/blender/tests", "-t", "tools/blender"],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
    );
    expect(r.error).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/\nOK/);
  }, 130_000);
});
