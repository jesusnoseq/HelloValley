#!/usr/bin/env node
// npm run perf:browser [-- --out <file.json>] [--chrome <path>] [--wait <seconds>]
//
// Build plan M37: browser measurements for docs/perf.md, with no extra dependencies (Chrome
// DevTools Protocol over Node's built-in WebSocket):
// - the production build (`vite preview`): load metrics of the entry page (first contentful
//   paint, largest contentful paint, layout shift, long tasks, bytes transferred);
// - the dev town page (`vite` dev server, /dev/town) per style: draw calls, triangles and frame
//   rate as the dev perf HUD reports them, at the overview and at the far gameplay zoom on the
//   square.
// Headless Chrome renders WebGL with SwiftShader (on the CPU), so draw calls and triangles are
// real but frame rates say nothing about a GPU. Run `npm run build` first.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLIENT = join(ROOT, "packages", "client");
const STYLES = ["european", "mediterranean", "arabic", "japanese"];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

export function findChrome() {
  const explicit = arg("--chrome", process.env.CHROME);
  if (explicit) return explicit;
  const candidates =
    process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((b) => join(b, "Google", "Chrome", "Application", "chrome.exe"))
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`${url} did not come up`);
}

function startVite(args, port) {
  const vite = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, ...args, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: CLIENT, stdio: "ignore" });
  return child;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.addEventListener("open", ok, { once: true });
      ws.addEventListener("error", fail, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

async function launchChrome(chrome, port) {
  const profile = mkdtempSync(join(tmpdir(), "hv-perf-chrome-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--window-size=1920,1080",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitForHttp(`http://127.0.0.1:${port}/json/version`);
  return { child, profile };
}

async function openPage(port, url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const target = await r.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { cdp, id: target.id };
}

const LOAD_METRICS = `new Promise((done) => {
  const out = { lcp: null, cls: 0, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { out.longTasks++; out.longTaskMs += Math.max(0, e.duration - 50); } }).observe({ type: "longtask", buffered: true });
  } catch {}
  setTimeout(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const res = performance.getEntriesByType("resource");
    const bytes = res.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) + (nav ? nav.transferSize || 0 : 0);
    done({
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      lcpMs: out.lcp === null ? null : Math.round(out.lcp),
      cls: Math.round(out.cls * 1000) / 1000,
      longTasks: out.longTasks,
      totalBlockingMs: Math.round(out.longTaskMs),
      requests: res.length + 1,
      transferKB: Math.round(bytes / 1024),
      jsKB: Math.round(res.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
    });
  }, 4000);
})`;

const HUD = `(() => {
  const el = document.querySelector('[data-testid="perf-stats"]');
  if (!el) return null;
  const text = el.textContent || "";
  const num = (re) => { const m = re.exec(text); return m ? Number(m[1].replace(/[,\\s]/g, "").replace(/k$/i, "e3")) : null; };
  return { text, fps: num(/([\\d.]+) fps/), drawCalls: num(/([\\d.,]+k?) draw calls/), triangles: num(/([\\d.,]+k?) tris/) };
})()`;

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("perf:browser needs Google Chrome (set CHROME or pass --chrome <path>).");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(join(CLIENT, "dist", "index.html"))) {
    console.error("Run `npm run build` first (perf:browser measures the production build).");
    process.exitCode = 1;
    return;
  }
  const waitS = Number(arg("--wait", "14"));
  const out = resolve(ROOT, arg("--out", "docs/perf/browser-report.json"));
  const report = { measuredAt: new Date().toISOString(), chrome: "", renderer: "", production: null, town: [] };
  const preview = startVite(["preview"], 4173);
  const dev = startVite([], 5199);
  const { child, profile } = await launchChrome(chrome, 9333);
  try {
    report.chrome = (await (await fetch("http://127.0.0.1:9333/json/version")).json()).Browser;
    await waitForHttp("http://127.0.0.1:4173/");
    const prod = await openPage(9333, "http://127.0.0.1:4173/");
    await sleep(500);
    report.production = await prod.cdp.evaluate(LOAD_METRICS);
    prod.cdp.close();
    await waitForHttp("http://127.0.0.1:5199/");
    for (const style of STYLES) {
      for (const [view, query] of [
        ["overview", "focus=overview"],
        ["square, far zoom", "focus=town_square&zoom=2"],
      ]) {
        const page = await openPage(9333, `http://127.0.0.1:5199/dev/town?style=${style}&speed=0&t=0.2&${query}`);
        await sleep(waitS * 1000);
        if (!report.renderer) report.renderer = await page.cdp.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const d = gl && gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
        const hud = await page.cdp.evaluate(HUD);
        report.town.push({ style, view, ...(hud ?? { text: "no perf HUD" }) });
        console.log(style, view, hud?.text ?? "no perf HUD");
        page.cdp.close();
        await fetch(`http://127.0.0.1:9333/json/close/${page.id}`).catch(() => {});
      }
    }
  } finally {
    child.kill();
    preview.kill();
    dev.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold the profile for a moment.
    }
    if (process.platform === "win32") for (const p of [preview, dev]) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.production));
  console.log(`wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
