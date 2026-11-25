# HelloValley

Entry for the Firebase Hybrid AI hackathon (https://firebasehybridaihackathon.devpost.com/).

A cozy multiplayer life-sim in the browser for language learning: the player lives in a miniature isometric diorama town where every NPC speaks their target language. Desktop Chrome first, because on-device Gemini Nano runs there.

## Docs (source of truth)

Read the docs a task touches before coding. They take precedence over assumptions.

- `docs/game-design-document.md` (GDD): gameplay, systems, stack, hybrid AI routing (§9.2), Firestore data model (§9.4), performance targets (§9.5).
- `docs/hellovalley-village-npcs.md`: the 9 NPCs (personas, voices, relationships), CEFR progression, and the list of supported TTS languages.
- `docs/prompts/build-plan.md`: ordered milestones M01–M38. Each has a goal, deliverables and acceptance criteria. Work one milestone at a time.
- `docs/prompts/npc-runtime.md`: Gemini system prompts and JSON schemas (NPC turn, openers, on-device tasks, compaction, village memory).
- `docs/prompts/art.md`: image-generation prompts and the style anchor.
- `docs/architecture.md`: components, deployment, AI routing, NPC turn flow, trust model, data ownership and cost controls. It overrides GDD §9.1–9.2 where they disagree (see its §11).
- `docs/dependency-security.md`: install and dependency update policy.

## Architecture

npm workspaces under `packages/`. The stack was adapted from the navecitas project.

- `client`: React 19 + Vite, Firebase web SDK, hosted on Firebase Hosting. It makes **every AI call** through Firebase AI Logic in `src/ai/`: hybrid on-device/cloud tasks, NPC turns through server prompt templates, and TTS. Planned: React Three Fiber + drei, postprocessing, Zustand, `colyseus.js`.
- `shared`: headless TypeScript with no DOM and no Three.js. It holds protocol types, zod schemas, game data and rules (items, prices, recipes, NPCs, languages, styles), action validation, difficulty math, SRS (FSRS), the town layout, A*, model IDs and prompt template sources. The client depends on it through `file:../shared`.
- `server` (planned, M01): Colyseus (`TownRoom`, `ApartmentRoom`) plus Express `/api/*` in one process, using the Firebase Admin SDK. It runs on **one Fly.io Machine** and never calls a model.
- `tools/blender/` (planned, M04): bpy generators that output GLB kits to `packages/client/public/assets/kits/{style}/`.

Current state: scaffold only. The client renders a placeholder and `shared` exports nothing yet.

## Rules

- The server is authoritative for economy (coins, prices), inventory, friendship, quests and positions. Model output reaches it from the client as an untrusted proposal (`npc:reply`). The server validates and clamps it with shared rules and recomputes prices itself (architecture §6.1).
- Economy fields in Firestore are written server-only through the Admin SDK. Players may write only their own `users/{uid}` profile, settings and notebook.
- Delegate `firestore.rules` authoring to the `firebase:firestore-rules-author` subagent.
- Player text enters prompts as quoted data (`<player_text>`), never as instructions. Model output must be schema-validated (zod) before it is used.
- On-device AI (Gemini Nano) supports single-turn prompts only, with no chat, no tools and no server prompt templates. Every on-device task is one short prompt that returns a small JSON object, and every one has a cloud or skip fallback (architecture §5.2).
- Shared caches (`cache/*`, Storage `tts/`) are written only by the admin seeding tool. Content generated during play is cached per player (memory + IndexedDB), keyed by `sha256(kind, npcId, lang, level, text)`.
- Do not implement features from later milestones. Leave `TODO(Mxx)` markers instead.
- Add unit tests for shared logic.

## Commands

`npm run dev`, `npm run typecheck`, `npm test` (Vitest, run from the root), `npm run build`, `npm run deps:check`, `npm run deps:audit`.

Before finishing a task, `npm run typecheck`, `npm test` and `npm run build` must pass.

## Dependencies

Use Node 26.13+ (`.nvmrc`) and npm 11.16+. Use `npm ci` for installs. Dependency versions are exact, `.npmrc` blocks install scripts and enforces a 7-day release-age policy, and git and URL dependencies are blocked. Run `npm run deps:check` when changing manifests or the lockfile, and follow `docs/dependency-security.md` for updates (an explicit reviewed version, scoped with `-w @hellovalley/<pkg>`). Prefer `npm run …` scripts over unpinned `npx`.
