import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_CSS_ORIGIN, FONT_FILE_ORIGIN, PROMPT_TEMPLATE_IDS, TEMPLATE_ID_PARAMS } from "../../packages/shared/src/index";

/**
 * Build plan M38: the deploy configuration is well-formed and its parts agree with each other
 * (firebase.json Hosting headers and CSP, fly.toml, the Dockerfile, Remote Config, indexes, CORS,
 * the CI workflow). Nothing here deploys or talks to a cloud project.
 */

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string): unknown => JSON.parse(read(path));

interface HeaderRule {
  source?: string;
  regex?: string;
  headers: { key: string; value: string }[];
}
interface FirebaseJson {
  hosting: { public: string; rewrites: { source: string; destination: string }[]; headers: HeaderRule[] };
  remoteconfig: { template: string };
  firestore: { rules: string; indexes: string };
  storage: { rules: string };
}

const firebase = json("firebase.json") as FirebaseJson;
const flyToml = read("fly.toml");
const flyApp = /^app\s*=\s*"([a-z0-9-]+)"/m.exec(flyToml)?.[1];

function header(rule: HeaderRule | undefined, key: string): string | undefined {
  return rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

const csp = header(firebase.hosting.headers.find((r) => r.source === "**"), "Content-Security-Policy") ?? "";
const directives = new Map(
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map(([name, ...values]) => [name!, values]),
);
const directive = (name: string) => directives.get(name) ?? [];

/** Which header rules apply to a request path (globs approximated for the patterns used here). */
function rulesFor(path: string): HeaderRule[] {
  return firebase.hosting.headers.filter((rule) => {
    if (rule.regex) return new RegExp(rule.regex).test(path);
    const glob = rule.source!;
    if (glob === "**") return true;
    const re = glob
      .replace(/[.+^${}[\]\\]/g, "\\$&")
      .replace(/@\(([^)]+)\)/g, "(?:$1)")
      .replace(/\*\*\//g, "(?:.*/)?")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^${re}$`).test(path);
  });
}

describe("firebase.json Hosting", () => {
  it("serves the client build as an SPA", () => {
    expect(firebase.hosting.public).toBe("packages/client/dist");
    expect(firebase.hosting.rewrites).toEqual([{ source: "**", destination: "/index.html" }]);
    expect(firebase.remoteconfig.template).toBe("remoteconfig.template.json");
  });

  it("uses RE2-compatible regexes (no lookaround or backreferences)", () => {
    for (const rule of firebase.hosting.headers) {
      expect(Boolean(rule.source) !== Boolean(rule.regex)).toBe(true);
      if (rule.regex) {
        expect(rule.regex).not.toMatch(/\(\?[=!<]|\\[1-9]/);
        expect(() => new RegExp(rule.regex!)).not.toThrow();
      }
    }
  });

  it("never caches the HTML, caches hashed build files forever and kits briefly", () => {
    const cache = (path: string) => rulesFor(path).map((r) => header(r, "Cache-Control")).filter(Boolean);
    for (const page of ["/", "/index.html", "/dev/town"]) expect(cache(page)).toEqual(["no-cache"]);
    for (const file of ["/assets/index-TbkKOKPd.js", "/assets/index-Cnxq9d2O.css", "/assets/events-e51d7528.esm-DdxQHnYN.js"]) {
      expect(cache(file)).toEqual(["public, max-age=31536000, immutable"]);
    }
    for (const file of ["/assets/kits/european/roof.gable.glb", "/assets/kits/common/atlas.webp", "/assets/characters/animal.fox.glb", "/assets/audio/amb-birds.ogg"]) {
      expect(cache(file)).toEqual(["public, max-age=3600, stale-while-revalidate=86400"]);
    }
    for (const manifest of ["/assets/kits/european/kit-manifest.json", "/assets/characters/character-manifest.json"]) {
      expect(cache(manifest)).toEqual(["no-cache"]);
    }
  });

  it("sends the security headers on every response", () => {
    const all = firebase.hosting.headers.find((r) => r.source === "**");
    expect(header(all, "X-Content-Type-Options")).toBe("nosniff");
    // signInWithPopup needs the opener: same-origin-allow-popups, not same-origin.
    expect(header(all, "Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(header(all, "Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
    expect(header(all, "Permissions-Policy")).toMatch(/microphone=\(self\)/);
    expect(header(all, "Referrer-Policy")).toBeTruthy();
  });
});

describe("the Content-Security-Policy", () => {
  it("keeps scripts strict", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
    // The meshopt decoder compiles WebAssembly.
    expect(directive("script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'self'"]);
  });

  it("is not tripped by zod's eval probe (every client chunk turns its JIT off first)", () => {
    const vite = read("packages/client/vite.config.ts");
    expect(vite).toContain(`"globalThis.__zod_globalConfig??={jitless:true};"`);
    expect(vite).toMatch(/output: \{ banner: ZOD_JITLESS_BANNER \}/);
  });

  it("allows Google Fonts (shared language/fonts.ts)", () => {
    expect(directive("style-src")).toContain(FONT_CSS_ORIGIN);
    expect(directive("font-src")).toContain(FONT_FILE_ORIGIN);
  });

  it("allows Firebase Auth, Firestore, Storage, AI Logic, Remote Config and reCAPTCHA Enterprise", () => {
    expect(directive("connect-src")).toContain("https://*.googleapis.com");
    expect(directive("script-src")).toEqual(expect.arrayContaining(["https://apis.google.com", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"]));
    expect(directive("frame-src")).toEqual(expect.arrayContaining(["https://*.firebaseapp.com", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"]));
    expect(directive("media-src")).toContain("blob:");
  });

  it("allows the game server on Fly.io (HTTPS and WebSocket) named in fly.toml", () => {
    expect(flyApp).toBeTruthy();
    expect(directive("connect-src")).toEqual(expect.arrayContaining([`https://${flyApp}.fly.dev`, `wss://${flyApp}.fly.dev`]));
  });
});

describe("fly.toml and the server image", () => {
  it("runs one always-on Machine with WebSockets and the /healthz check", () => {
    expect(flyToml).toMatch(/^\s*internal_port = 8080$/m);
    expect(flyToml).toMatch(/^\s*PORT = "8080"$/m);
    expect(flyToml).toMatch(/^\s*HOST = "0\.0\.0\.0"$/m);
    expect(flyToml).toMatch(/^\s*auto_stop_machines = "off"$/m);
    expect(flyToml).toMatch(/^\s*min_machines_running = 1$/m);
    expect(flyToml).toMatch(/^\s*path = "\/healthz"$/m);
    expect(flyToml).toMatch(/^\s*dockerfile = "packages\/server\/Dockerfile"$/m);
    // Secrets are named, never given values.
    expect(flyToml).not.toMatch(/FIREBASE_SERVICE_ACCOUNT\s*=/);
    expect(flyToml).not.toMatch(/PRIVATE KEY/);
  });

  it("builds on the .nvmrc Node version, with npm ci, as a non-root user", () => {
    const dockerfile = read("packages/server/Dockerfile");
    const nvmrc = read(".nvmrc").trim();
    expect(dockerfile).toContain(`ARG NODE_VERSION=${nvmrc}`);
    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/npm ci --omit=dev --workspace @hellovalley\/server/);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^CMD \["node", "--import", "tsx", "src\/index\.ts"\]$/m);
    // tsx runs the server in production, so it must be a runtime dependency of the server.
    const server = json("packages/server/package.json") as { dependencies: Record<string, string> };
    expect(server.dependencies.tsx).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("Firebase data configuration", () => {
  it("has a Remote Config template with the bundled template ids as defaults", () => {
    const template = json("remoteconfig.template.json") as { parameters: Record<string, { defaultValue: { value: string }; valueType: string }> };
    for (const [name, param] of Object.entries(TEMPLATE_ID_PARAMS)) {
      expect(template.parameters[param]?.defaultValue.value).toBe(PROMPT_TEMPLATE_IDS[name as keyof typeof PROMPT_TEMPLATE_IDS]);
      expect(template.parameters[param]?.valueType).toBe("STRING");
    }
  });

  it("declares the village events TTL (expiresAt, 14 days)", () => {
    const indexes = json("firestore.indexes.json") as { indexes: unknown[]; fieldOverrides: { collectionGroup: string; fieldPath: string; ttl?: boolean }[] };
    expect(indexes.fieldOverrides).toContainEqual(expect.objectContaining({ collectionGroup: "events", fieldPath: "expiresAt", ttl: true }));
    // Every query in the code is on one field (single-field indexes): no composite index needed.
    expect(indexes.indexes).toEqual([]);
  });

  it("lets the Hosting origins read Storage clips", () => {
    const cors = json("storage.cors.json") as { origin: string[]; method: string[] }[];
    expect(cors[0]!.method).toEqual(["GET", "HEAD"]);
    for (const origin of cors[0]!.origin) expect(origin).toMatch(/^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/);
  });
});

describe("the CI workflow", () => {
  const ci = read(".github/workflows/ci.yml");

  it("pins every action to a full commit SHA", () => {
    const uses = [...ci.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("runs the dependency policy, lint, typecheck, test and build", () => {
    for (const step of ["npm run deps:check", "npm ci", "npm run lint", "npm run typecheck", "npm test", "npm run build"]) expect(ci).toContain(step);
    expect(ci).toMatch(/permissions:\s*\n\s*contents: read/);
  });
});
