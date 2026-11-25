# HelloValley — Build Plan (coding-agent prompts)

Ordered prompts for building HelloValley milestone by milestone with a coding agent (for example Claude Code). Each prompt is self-contained: run it in a fresh session, review the result, then commit before moving on.

**Source of truth:** [game-design-document.md](../game-design-document.md) (GDD), [hellovalley-village-npcs.md](../hellovalley-village-npcs.md), [npc-runtime.md](npc-runtime.md), [art.md](art.md).

## Standing preamble (prepend to every prompt)

```text
You are working in the HelloValley repo (npm workspaces: packages/client = React 19 + Vite,
packages/shared = headless TypeScript, packages/server = Colyseus once created).
Read CLAUDE.md, docs/game-design-document.md and any doc this task names before coding.
Rules:
- Use `npm ci` for installs. Pin exact versions; .npmrc enforces a 7-day release-age policy.
  If you add or change dependencies, follow docs/dependency-security.md and run `npm run deps:check`.
- Game rules, schemas and data live in packages/shared (no DOM, no Three.js there).
- Server is authoritative for economy, inventory, friendship and positions.
- Before finishing: `npm run typecheck`, `npm test`, `npm run build` must pass. Add unit tests for
  shared logic. Summarise what you built, what you skipped, and any follow-ups.
- Do not implement features from later milestones; leave clear TODO(Mxx) markers instead.
```

---

## Phase 0 — Foundation

### M01 · Server workspace and protocol skeleton
```text
Create packages/server: a Colyseus server in TypeScript (exact pinned versions) with a health
endpoint, a placeholder TownRoom, and a dev script. Wire it into root `npm run dev` so client and
server start together. In packages/shared, create src/protocol/ with message type names and zod
schemas for: join options, player input (move dir / click target), chat message, interact request.
Client: connect to the server from a debug overlay showing connection status and ping.
Acceptance: `npm run dev` starts both; the client shows "connected"; protocol schemas have tests.
```

### M02 · Shared domain data
```text
In packages/shared, implement the data registries described in GDD §3, §5, §6.4, §7.3:
- languages.ts: every Gemini TTS language from docs/hellovalley-village-npcs.md, with
  {code, englishName, nativeName, script, romanization: 'romaji'|'pinyin'|'rr'|'translit'|null,
  rtl, defaultStyle, tier: 'featured'|'experimental'}. Featured = EN ES FR DE IT PT JA.
- styles.ts: the 4 style ids, and defaultStyleFor(lang).
- animals.ts (16 animals with fur tint options), palette.ts (16 pastel swatches, clamp function).
- npcs.ts: 9 NPCs {id, building, tier offset, voice, likedItems, dislikedItems, schedule[]}.
- items.ts, recipes.ts, fish.ts, forage.ts: ids, base prices, buff effects, rarity tables.
- difficulty.ts: effectiveLevel(playerLevel, npcId) per GDD §6.4 using half-CEFR steps.
- apartment.ts: randomApartmentId() → floor 1–9 + door A–H.
Acceptance: full test coverage of difficulty math, style defaults and the palette clamp.
```

### M03 · Firebase Auth, Firestore and emulators
```text
Set up Firebase for the client: Google sign-in (required), the Firestore data model from GDD §9.4,
and the Firebase emulator suite for local dev (auth, firestore, storage). Create a sign-in screen
and an auth gate. Server: verify Firebase ID tokens in Colyseus onAuth using firebase-admin.
Author firestore.rules: players read/write only their own users/{uid} profile and settings;
coins, inventory, hearts, npcMemory and level fields are server-only (Admin SDK). cache/* and
village/* are readable by signed-in users and writable only by the server. Delegate the
firestore.rules authoring to the firestore-rules-author subagent, and add rules unit tests
run against the emulator.
Acceptance: sign in with Google in the emulator, join the TownRoom with a verified uid, and the
rules tests pass.
```

---

## Phase 1 — Asset pipeline (Blender Python → GLB)

### M04 · Blender generator framework
```text
Create tools/blender/: a headless Blender Python generator framework run with
`blender --background --python tools/blender/build.py -- --style europe --out packages/client/public/assets/kits`.
Implement: grid constants (1 m cell, 3 m storey; modules pivot bottom-left-front), a Module base
class (semantic id, footprint, sockets, seeded variants), material helpers (vertex colours plus
one tiling texture atlas per style, a subtle hand-painted noise bevel), and helpers for rounded
bevels and soft low-poly shapes. Export each module as GLB and write kit-manifest.json
{id, variants, bounds, sockets, tris}. Add tools/optimize-assets script using gltf-transform
(meshopt + KTX2 or WebP fallback). Add an npm script `assets:build`. Document setup in
tools/blender/README.md (required Blender version, how to run).
Acceptance: generating a test cube module produces a GLB plus manifest that loads in the client.
```

### M05 · Central & Northern European kit
```text
Using the M04 framework, implement the "europe" style kit (GDD §7.2–7.3, art prompts in
docs/prompts/art.md §Style sheets). Modules: wall.plain, wall.window, wall.door, wall.shopfront,
wall.timber (half-timber), corner.outer, corner.inner, roof.gable, roof.hip, roof.stepped_gable,
dormer, chimney, balcony, awning, flowerbox, shutters, sign.hanging, stair, fence, lamp, bench,
cobble tile. 3 seeded variants each. Palette: pastel cream/butter/sage walls, brick-red and slate
roofs, dark wood timbering. Budgets: walls 150–600 tris, hero props ≤ 2k.
Acceptance: a contact-sheet scene renders every module; all manifests validate; budgets respected.
```

### M06 · Shared modules: terrain, water, vegetation, props
```text
Generate style-neutral modules: grass/path/cobble/sand terrain tiles (with edge pieces), river bank
pieces (straight, curve, inner/outer), stone bridge, wooden fishing dock, fountain, rounded
"cloud" trees (deciduous, conifer, cypress, palm, sakura, olive), bushes, flowers, rocks,
crates/barrels/baskets, notice board, market stall. Trees expose a trunk/canopy split so the
client can sway the canopy in a vertex shader.
Acceptance: contact sheet; tree canopies are a separate mesh/material slot.
```

### M07 · Character generator
```text
Generate the player/NPC characters (GDD §3): one chibi humanoid base body (~2.5 heads), a
skeleton shared by all animals, 16 animal head meshes plus tails/accessories attached by named
sockets, and separate material slots for fur, shirt, trousers, eyes. Script keyframe animations in
bpy: idle, walk, run, sit, talk, wave, fish_cast, fish_reel, eat, cheer, laugh, heart, think,
clap. Export one body GLB with animations plus one GLB per head. NPCs get unique outfits
(apron for the Baker, sash for the Mayor, glasses for the Librarian, and so on); pick an animal
per NPC and record it in shared/npcs.ts.
Acceptance: a client test page shows every animal running each animation with tintable clothes.
```

### M08 · Interior and furniture kit
```text
Generate interior modules: floor/wall panels for interiors, and furniture (bed, table, chairs,
sofa, wardrobe, mirror, kitchen nook with stove, shelves, plants, rugs, lamps, paintings) plus
shop interiors (bakery counter and ovens, store shelves, café bar, clinic desk, library shelves,
town hall desk, farm barn). Each furniture piece declares its grid footprint for placement.
Acceptance: a contact sheet; footprints are in the manifest.
```

---

## Phase 2 — Rendering and world

### M09 · Diorama renderer
```text
In packages/client, build the React Three Fiber scene (GDD §7.1): an orthographic isometric
camera (35° pitch, 45° yaw) with 90° rotation steps and 3 zoom levels (smooth easing), a warm key
light with soft shadows, a hemisphere fill, N8AO, light bloom and an optional tilt-shift DOF. Add a
day/night lighting gradient driven by a `worldTime` value (0–1). Add a perf HUD (fps, draw calls,
tris) in dev.
Acceptance: a test scene with placeholder blocks at 60 fps on an integrated GPU; rotation and
zoom feel smooth.
```

### M10 · Kit loader and building assembler
```text
Implement a style-aware kit loader (lazy-load kits/{style}/kit-manifest.json and GLBs, cache
geometries) and a building assembler that turns a style-agnostic recipe JSON (GDD §7.2) into an
instanced/merged mesh group. Recipes live in shared/src/buildings/*.json, validated by zod. Write
recipes for: apartment block (5 floors, balconies), bakery, farm barn, general store, clinic,
café, gossip house, town hall, library, elder cottage. Switching the style at runtime swaps the
kit without moving anything.
Acceptance: all 10 buildings render in the europe kit; there are style-switch hooks for future kits.
```

### M11 · Town map and navigation
```text
Create shared/src/world/town.ts: the town layout from GDD §4.1 (the difficulty road from the
apartments → bakery/farm → store/clinic → square with café and gossip house → town hall → river
with bridge and dock → hill with library and elder cottage). Include terrain tiles, the river path,
the square (fountain, benches, trees, lamps, flower beds, notice board), building placements with
door positions and difficulty signs (1–5 leaves), and spawn points. Generate a walkability grid
(0.5 m) and an A* pathfinder in shared (tested). Render the town in the client.
Acceptance: the whole town renders; every door is reachable by A* from the spawn point.
```

### M12 · Water and vegetation
```text
Add a stylized river shader (scrolling normals, edge foam, depth tint, soft reflections of the sky
colour) and vegetation instancing with vertex-shader wind sway on canopies, flower and grass
clusters. Add cosmetic weather (sun, light rain particles, fog) driven by a world-state value.
Acceptance: the river and trees animate; the whole town stays < 150 draw calls.
```

### M13 · Player controller and interiors
```text
Implement local player movement: WASD/arrows (Shift = run) and click-to-move using the M11 A*
pathfinder, with collisions against the walkability grid. Camera follows smoothly; Q/E rotate.
Doors: walking into a door triggers a fade into that building's interior scene, with a diorama
cut-away (walls facing the camera are hidden). The apartment block door leads to the player's own
apartment interior.
Acceptance: walk from the apartment to every building and inside it, then back.
```

---

## Phase 3 — Onboarding and characters

### M14 · Onboarding flow
```text
Build onboarding (GDD §2.1) after Google sign-in: native language → target language (searchable
list, featured first, experimental badge) → self-assessed level (5 friendly options → CEFR) →
character creation (name with moderation hook stub, animal carousel with a live 3D preview, shirt
and trousers swatches plus a clamped HSL picker, fur tint) → town style (pre-selected by
defaultStyleFor) → apartment number reveal. Persist to Firestore through a server endpoint
(server assigns the apartmentId). The UI is localised in the native language (start with an i18n
key system and EN/ES strings; others fall back to EN).
Acceptance: a new user completes onboarding, refreshes, and lands in their apartment.
```

### M15 · Character rendering and animation state
```text
Render avatars from profile data: body plus the chosen animal head, tinted clothes and fur, and a
name tag. Build an animation state machine (idle/walk/run/sit/talk/emotes) with crossfades. Add
the apartment mirror interaction to edit appearance (reuses the onboarding components).
Acceptance: appearance changes appear live and persist.
```

---

## Phase 4 — Multiplayer

### M16 · TownRoom networking
```text
Implement the authoritative Colyseus TownRoom (GDD §4.4): max 40 players, shard creation when
full, join a friend's shard by uid, server-side movement validation (speed caps, walkability),
client-side interpolation and prediction for the local player, remote avatars with animation
states, and a world clock (1 day = 40 real minutes) plus weather broadcast. Emotes 1–5.
Acceptance: two browsers see each other move smoothly; time of day is in sync; shards work.
```

### M17 · Apartments and visits
```text
Implement ApartmentRoom (a private instance per owner) and the lobby intercom: list online
players, request a visit, owner accepts or declines. Furniture placement mode: a 0.5 m grid,
rotate, move, store; the layout is saved server-side to users/{uid}/apartment/layout.
Acceptance: a friend visits and sees the same furniture; layout edits persist.
```

### M18 · Player-to-player chat
```text
Implement proximity chat (GDD §6.6): Enter to type, bubbles within 12 m, and a chat log. Display
rule: each reader sees the message in their target language; hover shows the original plus a
translation into the reader's native language; no translation if the sender wrote in the
reader's target language. Translation is done through the hybrid AI module (stub now, real in
M20) and cached per messageId. Moderation: client pre-check hook plus a mandatory server check
(stub now, real in M20/M36). Add mute, block and report.
Acceptance: two players with different target languages each see the message in their own
target language.
```

---

## Phase 5 — Language core

### M19 · Language text rendering
```text
Build the speech bubble component (GDD §6.1): input is a tokenized line
{tokens:[{surface, reading, lemma, gloss, pos}], translation}. Features: per-word hover tooltip
(lemma, reading, gloss in native language, POS), click-to-save (emits event), sentence hover
translation, and a 3-state script toggle (native / both / romanized) for scripts where
romanization != null, with furigana over kanji in "both" for Japanese. Support RTL (Arabic,
Hebrew, Persian). Load Noto fonts per script on demand. Save the toggle state per target language.
Storybook-like test page with fixtures for EN, ES, JA, ZH, KO, AR, RU.
Acceptance: all fixtures render correctly, including RTL and ruby text.
```

### M20 · Hybrid AI client module
```text
Implement packages/client/src/ai/hybrid.ts using Firebase AI Logic hybrid inference (read the
current Firebase AI Logic web hybrid docs first). Encode the routing table from GDD §9.2 as code:
gloss, translateShort, grammarFeedback, moderate, compactConversation, personaliseOpener, each
with its InferenceMode (PREFER_ON_DEVICE / ONLY_ON_DEVICE / PREFER_IN_CLOUD) and fallback. Note
that on-device supports single-turn prompts only (no multi-turn chat, no tools), so every task is
one prompt with a short JSON answer, validated with zod and retried once. Use the prompts from
docs/prompts/npc-runtime.md §On-device. Add an availability check and a background model
download warm-up during onboarding, with a status chip. Add a two-level cache (memory LRU +
Firestore cache/lines) keyed by content hash.
Acceptance: unit tests with a mocked model; manual test in Chrome with on-device enabled and
disabled (the fallbacks work).
```

### M21 · NPC dialogue service (server)
```text
In packages/server, implement the NPC dialogue service: a prompt builder (persona from
hellovalley-village-npcs.md, effectiveLevel, memory summary, learning words from the notebook,
world state, NPC inventory and prices, conversation history of the last 8 turns), a Gemini Flash
call with structured JSON output (schema in docs/prompts/npc-runtime.md §NPC turn), zod
validation with one repair retry, and action validation (offer, buy, give, giveQuest,
completeQuest, teachRecipe, priceAdjustment clamped to −30..+10%, friendshipDelta −1..+1,
endConversation). Stream text to the client as soon as it arrives. Treat player text as quoted
data. Enforce rate limits and a per-turn token cap. Add canned fallback lines when the model fails.
Cache openers: pre-generate per NPC × language × level band × time band × friendship band on
first request.
Acceptance: talk to the Baker in ES at A1 and in JA at B2, and buy bread through an `offer`
action; malformed model output is repaired or falls back.
```

### M22 · TTS service
```text
Implement server TTS with Gemini TTS (model and voice mapping from hellovalley-village-npcs.md
§Voice). Put the style in speech metadata, keep inline tags in the transcript, and slow the pace
slightly for A1–A2. Cache by sha256(npcId, lang, level, text) → Cloud Storage clip + Firestore
cache/tts doc, and return a signed URL. The client plays the clip when it arrives, with replay and
0.75× buttons. Text is shown before the audio.
Acceptance: the same line twice → the second play is served from cache (verified in logs).
```

### M23 · Conversation UI
```text
Build the conversation panel (GDD §6.2, §8.1): F or click to talk, camera ease-in, NPC bubble (M19), audio
(M22), suggested replies (count by level; hover translations), free text input, optional mic input
using browser speech recognition, an on-device grammar feedback chip before sending (soft, can
send anyway), native-language input gently redirected, action confirmation cards (buy/sell/quest)
and goodbye/walk-away handling. Bystanders see a "chatting" indicator over the pair.
Acceptance: a full shop conversation playable by keyboard only and by mouse only.
```

### M24 · Memory, friendship and level adaptation
```text
Implement per-player NPC memory and friendship (GDD §8.2, §6.4): after each conversation, the
client runs compactConversation on-device (prompt in npc-runtime.md §Compaction); if that is
unavailable, the server runs it in the cloud. The server stores the summary, facts and lastSeen,
applies hearts changes (gifts with liked/disliked items, daily greeting, quest completion, decay
after 7 days) and updates the level estimate from the compaction signals (max ½ step per in-game
day, toast). Show hearts in an NPC profile card.
Acceptance: the NPC remembers a fact from the previous session; hearts change by the documented
rules (tested in shared).
```

### M25 · Notebook, SRS and world labels
```text
Implement the notebook (GDD §6.3, §6.5): saving from NPC bubbles, chat and world objects; entries
with example sentence, audio and source; the FSRS scheduler in shared (tested); a review session
UI (listen → recall → rate); stats (known words, streak). Feed up to 5 "learning" words into NPC
prompts. World labels: every interactable has a labelKey; generate labels per language once
(server, cloud), cache them in cache/labels/{lang}, and show them on hover with audio.
Acceptance: save 10 words, review them, and see an NPC reuse one in conversation.
```

---

## Phase 6 — Gameplay

### M26 · Inventory, economy and shops
```text
Implement a server-authoritative inventory (24 slots + 6 hotbar) and coins (GDD §5.1, §5.6). Shops
as conversations: NPC `offer`/`buy` actions → confirmation card → server transaction. Per-NPC buy
and sell lists from shared/items.ts. Shopkeeper haggling: the model's priceAdjustment is clamped
and scaled by friendship. Inventory UI (Tab) with target-language labels.
Acceptance: buy at the bakery, sell forage at the farm, haggle at the store; coins cannot go
negative and the client cannot forge transactions.
```

### M27 · Fishing
```text
Implement fishing (GDD §5.2): equip rod, hold to cast (distance), approaching fish shadow, bite,
and a timing mini-game; server-side roll on fish.ts rarity by time and weather. A catch card shows
the target-language name and audio with save-to-notebook. Fish encyclopedia UI. The Elder reacts
when nearby (bark via cache).
Acceptance: catch at least 5 species across day and night; the encyclopedia updates.
```

### M28 · Foraging and lost items
```text
Implement daily forage spawns (server, per shard, seeded per in-game day) and lost NPC items with
Gossip hint dialogue (an NPC turn with a "hint" context listing the lost item location). Returning
a lost item gives friendship. Forage album UI.
Acceptance: spawns reset each in-game day; returning a lost item adds hearts.
```

### M29 · Eating, cooking and buffs
```text
Implement eating (GDD §5.4): consume food from the hotbar, sit at benches or café tables, timed
buffs (walk speed, extra reply hint, fishing luck, emote), and NPC reactions (for example the
Doctor after 3 cakes, via an NPC context flag). Apartment kitchen cooking: combine 2–3 ingredients
using recipes learned from NPCs (teachRecipe action); recipe cards in the target language.
Acceptance: learn bread from the Baker, cook it, eat it, and see the buff in the HUD.
```

### M30 · Daily requests and quests
```text
Implement a quest system (GDD §5.5): quest templates in shared (deliver, fetch, catch, cook,
find), the Town Hall board with 3 daily requests per player, text generated at the player's level
and cached per template × language × level, NPC-given quests via the giveQuest action, progress
tracking, completion via completeQuest or automatic triggers, and rewards.
Acceptance: complete one request of each template type.
```

### M31 · NPC life and village memory
```text
Implement NPC schedules (server moves NPCs along schedule points with A*), idle behaviours,
cached ambient barks (NPC↔NPC exchanges reflecting the relationships in the NPC doc), and shown
to each nearby player in their target language. Shared village memory (GDD §8.2): log public game
events per shard (with name opt-out), and run a periodic cloud batch that turns events into
Gossip rumours and Elder legends (prompts in npc-runtime.md §Village memory) injected into those
two NPCs' prompts.
Acceptance: an event (rare fish caught) is later mentioned as a rumour by the Gossip.
```

---

## Phase 7 — Additional styles

### M32 · Mediterranean kit
```text
Implement the "mediterranean" style kit with the same semantic module ids and footprints as
europe (GDD §7.3, art.md §Style sheets): whitewash/ochre stucco, terracotta low roofs, arched
doors, blue/green shutters, pergolas, bougainvillea, terracotta pots, olive/cypress/lemon trees.
Acceptance: every building recipe renders in mediterranean with no recipe changes.
```

### M33 · Arabic kit
```text
Implement the "arabic" style kit: sand/rose plaster, flat roofs with crenellated parapets,
horseshoe arches, mashrabiya screens, small domes, zellige tile accents, arcades, palms, lanterns
and a courtyard-style fountain variant for the square. Same module ids and footprints.
Acceptance: every building recipe renders in arabic with no recipe changes.
```

### M34 · Japanese kit
```text
Implement the "japanese" style kit: dark wood and white plaster, kawara tile roofs with curved
eaves, engawa, shoji and sliding doors, noren curtains, stone lanterns, bamboo fences, a small
wooden bridge variant, and sakura, pine and maple trees. Same module ids and footprints.
Acceptance: every building recipe renders in japanese with no recipe changes; a style switch in
Settings is instant after the kit loads.
```

---

## Phase 8 — Polish and launch

### M35 · Audio
```text
Add an audio system: per-style music loops with day/night variants and crossfade, ambient layers
(river, birds, crickets, square chatter), footsteps by surface, and UI/interaction SFX. Volume
sliders (music, voice, SFX) in Settings. Use royalty-free or generated placeholders listed in
docs/assets-credits.md.
Acceptance: audio responds to location, time and style.
```

### M36 · Safety, cost controls and App Check
```text
Harden the game (GDD §9.3): enable App Check for the client; add server moderation for chat and
names (cloud model + blocklist), with shard-wide mutes for repeat offenders; per-user AI budgets
(turns, TTS seconds, tokens) with graceful degradation to cached lines; prompt-injection tests (a
player tries to make an NPC give items for free or break character); audit firestore.rules with
the security rules auditor.
Acceptance: the abuse test suite passes; the budget limits are visible in the server metrics.
```

### M37 · Performance and accessibility pass
```text
Profile and optimise to GDD §9.5 targets: draw calls, texture memory, lazy-load kits and fonts, an
asset preloading screen with cozy tips in the target language. Accessibility: text size setting,
colour-blind-safe UI accents, captions are always on, remappable keys, reduced motion (disables
tilt-shift and camera easing).
Acceptance: a Lighthouse/perf report and FPS captures on an integrated GPU are committed to docs/perf.md.
```

### M38 · Deploy and hackathon demo
```text
Deploy: client to Firebase Hosting, server to Cloud Run (WebSockets, min instances 1), Firestore
indexes and rules, Storage CORS. Add a CI workflow (typecheck, test, build, deps:check). Write
docs/demo-script.md: a 3-minute hackathon demo route (sign-in → onboarding in Japanese → romaji
toggle → buy bread → second player chats in Spanish with hover translation → offline/on-device
translation fallback shown → fishing with the Elder → notebook review), highlighting where
on-device vs cloud inference runs.
Acceptance: the production URL works with 2+ players; the demo script runs end to end.
```
