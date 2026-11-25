# Pending questions and blocked items

Questions and decisions that came up while working through `docs/prompts/build-plan.md` unattended.
Each entry gives the question, the default that was chosen so work could continue, and anything that
could not be verified in this environment.

## Environment (2026-11-25)

- Blender is not installed, so the bpy generators (M04–M08, M32–M34) can be written but not run. Which Blender version should be installed, and should generated GLBs be committed?
- The Firebase CLI is not installed and the only Java on PATH is Java 8 (Corretto). The emulator suite needs a newer JDK, so emulator-based tests (rules tests, auth flow) cannot run here.
- No Firebase project, credentials or API keys are configured, so live Gemini, TTS, Auth and Firestore calls cannot be exercised. The code uses emulator/mock paths and placeholders.
- Manual browser acceptance checks (60 fps, two-browser multiplayer, on-device Gemini Nano in Chrome) were not performed.
- Deployment (M38) is outward-facing and was not run: config and CI were prepared only.
- The repo had no linter. A lint step was added (M00) so "tests and linters" can run before each commit.

## M00

- Lint tooling: ESLint 10.15.0, @eslint/js 10.0.1, typescript-eslint 8.73.0 (non-type-checked `recommended`), eslint-plugin-react-hooks 7.1.1 (`flat.recommended`, client only) and globals 17.14.0, all at least 7 days old. Default: no type-aware linting and no Prettier, to keep `npm run lint` fast and simple. Should type-checked rules be turned on later?
- `npm run deps:audit` reports 4 high-severity advisories in `@grpc/grpc-js` that come in through `firebase` 13.4.0. They were there before M00. The only automatic fix (`npm audit fix --force`) would downgrade to firebase 9, so it was not applied.
- `npm test` failed on the scaffold because there were no test files. M00 adds `scripts/eslint-config.test.ts`, which checks the lint config, so the suite now has real tests.

## M01

- Packages: `@colyseus/core` 0.18.28, `@colyseus/ws-transport` 0.18.5, `@colyseus/schema` 5.0.49 and `express` 5.3.0 (server); `@colyseus/sdk` 0.18.10 (client, and a server devDependency for the join/ping integration test); `zod` 4.6.7 (shared); `concurrently` 10.0.7 (root, for `npm run dev`). All are at least 7 days old. The build plan and CLAUDE.md say `colyseus.js`, but on Colyseus 0.18 the client SDK is `@colyseus/sdk` (`colyseus.js` stops at 0.16), so that is what was used. The `colyseus` meta-package was not used because it pulls in redis, auth, monitor and playground packages.
- Server: Colyseus and Express share one HTTP server (Colyseus `express` option), per architecture §3.1/§7.2. `GET /healthz` returns `{ ok: true }`. Colyseus also serves its own `/__healthcheck`. The server runs from TypeScript through `tsx` (`dev` = `tsx watch`, `start` = `tsx`); there is no compiled build yet. Should the Fly image run `tsx` or a compiled bundle? Default: decide in M38.
- Listen address: `PORT` (default 2567) and `HOST` (default 127.0.0.1). Fly needs `PORT=8080` and `HOST=0.0.0.0` in `fly.toml` (M38). The client reads `VITE_SERVER_URL` (default `http://127.0.0.1:2567`).
- Protocol decisions (shared/src/protocol): message names `player:input` (discriminated union: `move` with a ground-plane `dir` of length ≤ 1 and optional `run`, or `click` with a ground `target`), `chat:send` (trimmed, 1–200 characters, no control characters), `interact:request` (`targetKind` npc|object plus a slug `targetId`). Join options hold only an optional `idToken` for now (required in M03). The 200-character chat limit and the ±1000 m coordinate bound are defaults that the GDD does not specify.
- Invalid client messages are dropped and logged by TownRoom (it validates with `parseClientMessage` itself), instead of using Colyseus's built-in schema validation, which disconnects the client. Should repeat offenders be kicked? Default: count them toward the rate limit in M36.
- The room keeps only a placeholder `players` map (x, z at 0,0). Movement, chat broadcast and interactions are TODO(M16/M18/M19/M21).
- Not verified: the browser check that the overlay shows "connected". `npm run dev` was started and both Vite (5173) and the server (`/healthz` on 2567) responded, and CORS preflight from the Vite origin passes. A Vitest integration test joins the TownRoom with the real SDK and pings it.
- CLAUDE.md still describes `packages/server` as "planned" and the client as a placeholder. It was not edited by the unattended run.

## M02

- Location: the registries live in `packages/shared/src/data/` (one file per milestone name: `languages.ts`, `styles.ts`, `animals.ts`, `palette.ts`, `npcs.ts`, `items.ts`, `recipes.ts`, `fish.ts`, `forage.ts`, `difficulty.ts`, `apartment.ts`, plus `world.ts` for time bands, weather and place ids and `rarity.ts` for rarity weights). GDD §7.3 names `shared/src/styles/defaults.ts` for the style mapping. Default: the mapping is the `defaultStyle` field of each language in `languages.ts`, and `defaultStyleFor` is in `styles.ts`, as the build plan says.
- Languages: 103 entries, which is the "Full list" of Flash-Lite TTS languages in the NPC doc. Flash-only languages (Finnish, Swedish, Thai, Swahili, …) are left out. Codes are BCP 47 tags, with a script subtag only where the list names a non-default script (`ace-Arab`, `ks-Arab`, `ks-Deva`, `min-Arab`, `ar-Latn`, `zh-Hans`, `zh-Hant`). Halh Mongolian uses `mn`, Persian (Afghanistan) uses `fa-AF`. Native names for the less common languages (Acehnese, Minangkabau and Kashmiri in Arabic script, Manipuri, Santali and others) were written without a native speaker and should be checked.
- Romanization comes from the script: Latin → `null`, Japanese → `romaji`, Chinese → `pinyin`, Korean → `rr`, everything else → `translit`. Cantonese uses `translit` (Jyutping), because the allowed values have no Jyutping option. `rtl` is true for Arabic and Hebrew script.
- Style defaults beyond the GDD table: Slavic and Baltic languages (including Estonian) and Afrikaans → european; Azerbaijani (both), Uzbek, Pashto, Dari, Kashmiri (both scripts), and Acehnese and Minangkabau in Arabic script → arabic; Halh Mongolian → japanese (the GDD names Mongolian); Kazakh, Kyrgyz, Georgian, Armenian, the Indic, African and Southeast Asian languages → the Mediterranean fallback. Unknown codes fall back to Mediterranean, and region subtags are stripped (`pt-BR` → `pt`).
- Levels are half-CEFR steps stored as strings: `A1`, `A1+`, `A2`, …, `C1+`, `C2`. NPC tier offsets are in half steps (Baker/Farmer −2, Mayor +1, Librarian/Elder +2). `effectiveLevelInfo` also returns `simplified: true` when the offset would go below A1 (GDD §6.4 "the offset is absorbed").
- Palette clamp range: saturation 0.20–0.70, lightness 0.60–0.90 (the GDD gives no numbers). Charcoal and navy are curated swatches outside that range on purpose. Non-finite picker values fall back to the middle of the range and the hue wraps rather than clamps.
- The GDD gives no per-NPC likes and dislikes, schedule details, fish list, forage list, recipe list, prices or heart thresholds. All of these are first drafts made to fit the personas. Defaults that affect later milestones: bread (Baker) and the omelette (Farmer) need 0 hearts, and fish stew (Farmer) needs 2. The General store also sells flour, sugar and butter so that recipes can be cooked. Buff durations are in real seconds (bread 5 min, coffee 10 min, fish stew 10 min).
- `SHOPS` holds per-NPC buy and sell lists from GDD §5.1 because the server checks `offer`/`buy` against them (architecture §6.1). Buy-back prices, the Shopkeeper's lowball multiplier and clothing colours are TODO(M26). NPC gift tables (`give`) are not defined yet (TODO(M24/M26)).
- `InteractRequestSchema` now accepts only registered NPC ids for `targetKind: "npc"`. This resolves the M02 half of the M01 TODO.
- `packages/shared/package.json` now sets `"sideEffects": false`. Without it the client bundle grew past Vite's 500 kB warning once the data registries were exported. With it the bundle is 393 kB.
- Acceptance asks for "full test coverage" of the difficulty math, the style defaults and the palette clamp. The tests cover every level × NPC pair, every language's default style and the clamp edge cases (out-of-range, NaN and Infinity values, hue wrapping, idempotence). No coverage tool (`@vitest/coverage-v8`) is installed, so a coverage percentage was not measured.
