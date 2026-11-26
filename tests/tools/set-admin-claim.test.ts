import { afterEach, describe, expect, it, vi } from "vitest";
import { main, nextClaims, planClaim } from "../../tools/admin/set-admin-claim";

// Build plan M38: the admin claim tool. Only the planning and the dry run are exercised; nothing
// here talks to a Firebase project or the Auth emulator.
afterEach(() => vi.restoreAllMocks());

describe("set-admin-claim", () => {
  it("plans a grant or a revoke for a uid or an e-mail", () => {
    expect(planClaim(["u_123-abc"])).toEqual({ user: { uid: "u_123-abc" }, admin: true });
    expect(planClaim(["ops@example.com", "--revoke"])).toEqual({ user: { email: "ops@example.com" }, admin: false });
    expect(planClaim([])).toMatch(/usage/);
    expect(planClaim(["not a uid"])).toMatch(/not a uid/);
  });

  it("changes only the admin claim", () => {
    expect(nextClaims({ beta: true }, true)).toEqual({ beta: true, admin: true });
    expect(nextClaims({ beta: true, admin: true }, false)).toEqual({ beta: true });
    expect(nextClaims(undefined, false)).toEqual({});
  });

  it("writes nothing without --write, and needs a project to write", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["u1"])).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toMatch(/dry run/);
    expect(await main(["u1", "--write"])).toBe(2);
    expect(error.mock.calls.flat().join("\n")).toMatch(/--project/);
  });
});
