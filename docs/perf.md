# Performance and accessibility report (build plan M37)

Targets (GDD §9.5, §7.2): 60 fps on an integrated GPU (Intel Iris Xe / Apple M1) at 1080p; time to
interactive under 6 s on 50 Mbps; initial download under 15 MB with style kits lazy-loaded
(about 3–5 MB each); the whole town under 300k triangles on screen and under 150 draw calls.

Measured on 2026-11-26 on the development machine (Windows 11, Chrome 158). Re-run with:

```sh
npm run build
npm run perf:measure   # docs/perf/town-measurements.json (geometry, draw calls, bundle, assets)
npm run perf:browser   # docs/perf/browser-report.json (headless Chrome: load metrics, renderer.info)
```

## What was not possible here: FPS on a real integrated GPU

**No frame-rate capture on an integrated GPU was possible.** This environment has no browser
with a GPU that can be driven (the run is unattended; headless Chrome renders WebGL with
SwiftShader on the CPU, at 0–1 fps for the town, which says nothing about a GPU). The 60 fps
target on Iris Xe / M1 is therefore **unverified** and listed in `pending.md` (M37). To capture it:
open `/dev/town?style=<style>&focus=town_square&zoom=2` in `npm run dev` on the target laptop at
1920×1080, read the perf HUD (fps, worst frame, draw calls, triangles) for each style, and with
`fx=0` for the low-quality setting; add the numbers to the table below.

| Device | Style | Quality | fps | Worst frame |
|---|---|---|---|---|
| Intel Iris Xe laptop | — | — | not measured | — |
| Apple M1 | — | — | not measured | — |

## Lighthouse (production build, sign-in page)

Lighthouse 12.8.2, desktop preset, `vite preview` of `npm run build` on localhost (no network
throttling beyond the preset; no Firebase project, so the page is the sign-in screen with the
local emulator note). Full report: [`docs/perf/lighthouse-signin.html`](perf/lighthouse-signin.html).

| Category | Score |
|---|---|
| Performance | 100 |
| Accessibility | 100 (94 before the fixes below) |
| Best practices | 100 (96 before: a missing favicon logged a 404) |
| SEO | 91 (no `robots.txt` at the time; M38 added `packages/client/public/robots.txt`) |

FCP 0.6 s · LCP 0.6 s · TBT 0 ms · CLS 0.006 · Speed Index 0.6 s · 255 KiB transferred.
Lighthouse also flags unused JavaScript in the entry chunk (Firebase Auth and App Check load
before sign-in) and the missing source maps (not shipped on purpose).

The game itself (after sign-in) cannot be audited by Lighthouse here: it needs a Google
sign-in against a real Firebase project.

## Load metrics (`npm run perf:browser`)

Production entry page, headless Chrome, localhost: TTFB 6 ms, DOMContentLoaded 86 ms, FCP 360 ms,
LCP 360 ms, CLS 0, no long tasks, 15 requests, 254 KB transferred (252 KB of it JavaScript).

## Bundle and downloads (`npm run perf:measure`)

| | Raw | gzip |
|---|---|---|
| All JS + CSS chunks | 2.93 MB | 0.92 MB |
| Entry (sign-in page: `index` JS + CSS) | 0.79 MB | 0.25 MB |
| `DioramaCanvas` (three/R3F/postprocessing, after sign-in) + `three.core` | 0.69 MB | 0.23 MB |

Assets in `public/assets` (fetched on demand, never in the entry): common kit 1.68 MB, interior
kit 1.46 MB, style kits 0.87 (European), 1.24 (Mediterranean), 1.20 (Arabic), 1.21 MB
(Japanese), characters 0.57 MB, audio 1.53 MB. A first visit downloads the code above, the
common + interior kits, the player's style kit, the characters and the audio it plays: about
6–7 MB, under the 15 MB budget; another style kit loads only when chosen in Settings.

**Lazy loading (verified):** style kits load per style (`kitLoader.loadStyle`, Settings preloads a
new style before switching, M34); the scene, every HUD layer, Settings, audio and the notebook
are their own chunks after sign-in; Google Fonts for a script load only when text in that
script is shown (`ui/speech/fontLoader.ts`, `shared/language/fonts.ts`; the CSS is requested on
demand with `display=swap`). App Check stays in the entry chunk on purpose: it must start
before Firestore and AI Logic (pending.md, M37).

## Town geometry and draw calls (`npm run perf:measure`)

Everything in view at once (the overview), the local player included; draw calls are the upper
bound of `scene/drawCalls.ts` (every mesh in the main pass, every caster in the shadow pass, the
post-processing passes measured in headless Chrome).

| Style | Triangles | Draw calls (main + shadow + post) | With a full shard on the square |
|---|---|---|---|
| European | 263,043 | 48 + 23 + 36 = 107 | 139 |
| Mediterranean | 260,593 | 49 + 24 + 36 = 109 | 141 |
| Arabic | 278,411 | 49 + 24 + 36 = 109 | 141 |
| Japanese | 260,941 | 49 + 24 + 36 = 109 | 141 |

Before M37 the Arabic town was at ~305k triangles and every town at 147–149 draw calls (the
local player included), with nothing left for other characters. Tests now hold every style at
least 5 % under 300k triangles and at most 112 draw calls, and a full 40-player shard plus the
nine villagers on the square under 150.

What changed:

- **Hidden ground faces culled at build time** (`tools/optimize-assets.mjs`
  `cullHiddenGroundFaces`): terrain tiles and river banks never cast shadows and are only seen by
  the iso camera at a 35° pitch, so faces pointing down (ny < −0.83) and bank faces entirely under
  the opaque water surface are dropped; manifests carry the new counts. Common layer: 103k → 72k
  triangles. The river bed quads under the opaque water are gone too.
- **Whole-town buckets for small material slots**: glass, glow and the common layer's standing
  props (crates, rocks, trunks: ~5k triangles) are one mesh each for the whole town instead of
  one per chunk; glow no longer casts shadows. 43 → 24 meshes per town.
- **Crowd level of detail** (`scene/crowdPlan.ts`, `scene/Crowd.tsx`): remote players and
  villagers share a 36-draw-call budget, spent nearest-first around the camera focus: full detail
  (meshes + name tag) for up to 3 within 14 m, then real shadows while the budget lasts; everyone
  else is one instanced, tinted impostor batch, and characters without a real shadow get one
  instanced blob-shadow batch. The villager in the player's conversation is always full.

`renderer.info` in headless Chrome (`/dev/town`, effects on, villagers and players not mounted
on that page) reports 86–88 draw calls per frame and 443k–489k triangles: `renderer.info` adds up
every pass, so the shadow pass draws the casters (about 190k triangles) a second time; the main
pass alone is the table above.

Texture memory: each kit has one 2048² WebP atlas (16 MB as RGBA with mipmaps on the GPU), so the
town holds two (common + style), ~43 MB, plus the interior kit's when indoors. KTX2 (Basis) would
cut that by about 4–6×, but needs the KTX-Software CLI, which this environment cannot install
(pending.md, M37); `optimize-assets` already produces KTX2 when `toktx`/`ktx` is on PATH, and the
client would then need `KTX2Loader` with the Basis transcoder.

## Accessibility (WCAG 2.2 pass)

Settings (per player, on this device):

- **Text size**: Normal / Large / Larger / Largest (100–150 %) on the HUD and panels (CSS `zoom`
  on the HUD layer; the 3D scene is not scaled). Browser zoom to 200 % still works.
- **Colour-blind-safe accents**: an Okabe–Ito set (blue for success, vermillion for warnings,
  reddish purple for hearts, a sky-blue fishing zone, orange bobber) via CSS tokens
  (`ui/theme.css`); the reel hint no longer says "green zone" (WCAG 1.3.3, 1.4.1).
- **Reduced motion**: follows `prefers-reduced-motion` unless forced on or off; turns off the
  tilt-shift blur, camera easing (rotation, zoom and follow cut instead of gliding) and UI
  animations and transitions (WCAG 2.3.3).
- **Captions always on**: every voice line (TTS) is also shown as text in the speech bubble; there
  is no way to hide them. The microphone button can be turned off.
- **Remappable keys**: every game action (walk, run, interact, camera, chat, bag, notebook,
  requests, cast/eat, turn furniture); a key already in use swaps. Esc, the arrows (always walk),
  the digits (emotes) and F1–F12 stay fixed. Hints ("Pick up (F)") and `aria-keyshortcuts`
  follow the binding.
- **Graphics**: quality High / Low (Low turns post-processing off) and the tilt-shift toggle.

Fixes from the audit: a global `:focus-visible` outline (2.4.7, 2.4.11); 24 × 24 px minimum
button targets in the HUD (2.5.8); focus moves into Settings and back to its button (2.4.3);
the sign-in screen is localised from the browser language and its note has enough contrast
(1.4.3, the Lighthouse failure); a meta description and favicon; `lang` on the ambient barks and
their translations (3.1.2); the preloading screen is a labelled dialog with a progress bar, a
polite live region for tips, and a Continue button after 8 s so nobody is held (2.2.1); success
colours were darkened to reach 4.5:1 with white text.

Not verified (pending.md): screen reader runs (NVDA/VoiceOver), keyboard-only play through every
panel in a real browser, Windows High Contrast. The fishing bite window is a timed game mechanic
(WCAG 2.2.1 "essential" exception).
