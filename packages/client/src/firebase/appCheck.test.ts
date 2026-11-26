import { describe, expect, it, vi } from "vitest";
import { readAppCheckConfig } from "./appCheck";
import { postReview } from "../net/api";
import { currentAppCheckToken, setAppCheckTokenSource } from "../net/appCheckToken";

/** Build plan M36: App Check configuration (reCAPTCHA Enterprise, debug token in dev) and the token on server calls. */

describe("readAppCheckConfig", () => {
  const real = { projectId: "hellovalley-dev" };

  it("is off for the demo emulator project and without a site key", () => {
    expect(readAppCheckConfig({ VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "key", DEV: true }, { projectId: "demo-hellovalley" })).toBeNull();
    expect(readAppCheckConfig({ DEV: true }, real)).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readAppCheckConfig({ DEV: false }, real)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("uses the site key, and a debug token only in development", () => {
    expect(readAppCheckConfig({ VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: " key ", DEV: false, VITE_APPCHECK_DEBUG_TOKEN: "dbg" }, real)).toEqual({ siteKey: "key", debugToken: null });
    expect(readAppCheckConfig({ VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "key", DEV: true, VITE_APPCHECK_DEBUG_TOKEN: "dbg" }, real)).toEqual({ siteKey: "key", debugToken: "dbg" });
    // No registered debug token yet: the SDK prints a new one to register.
    expect(readAppCheckConfig({ VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "key", DEV: true }, real)).toEqual({ siteKey: "key", debugToken: true });
  });
});

describe("the App Check token on server calls", () => {
  it("is sent as X-Firebase-AppCheck when there is one", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ streak: 1, day: 1, counted: true }) }));
    const user = { getIdToken: async () => "tok" };
    setAppCheckTokenSource(async () => "ac-token");
    try {
      await postReview(user, { lang: "es", day: 1 }, { fetchImpl, baseUrl: "http://x" }).catch(() => undefined);
      const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.headers).toMatchObject({ authorization: "Bearer tok", "x-firebase-appcheck": "ac-token" });
      await postReview(user, { lang: "es", day: 1 }, { fetchImpl, baseUrl: "http://x", appCheckToken: async () => null }).catch(() => undefined);
      const plain = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
      expect(plain.headers).not.toHaveProperty("x-firebase-appcheck");
    } finally {
      setAppCheckTokenSource(async () => null);
    }
  });

  it("a failing provider means no token (the server decides)", async () => {
    setAppCheckTokenSource(() => Promise.reject(new Error("recaptcha blocked")));
    expect(await currentAppCheckToken()).toBeNull();
    setAppCheckTokenSource(async () => null);
  });
});
