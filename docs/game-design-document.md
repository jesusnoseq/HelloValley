# HelloValley — Game Design Document

> **Where cozy village life and language learning meet.**
> hellovalley.app · Entry for the Firebase Hybrid AI hackathon.

Companion docs: [Village and NPCs](hellovalley-village-npcs.md) · [Architecture](architecture.md) · Prompt library: [build plan](prompts/build-plan.md), [NPC runtime prompts](prompts/npc-runtime.md), [art prompts](prompts/art.md).

Status: v1 design, 2026-11-25. Scope: the full game below. Features can be cut later.

---

## 1. Vision

HelloValley is a cozy multiplayer life-sim in the browser. You move into a small apartment in a miniature diorama town where every villager speaks the language you are learning. You buy bread, haggle with the shopkeeper, fish by the river with the Elder, gossip on the square and chat with other players from around the world. You learn the language by living in it, not by doing exercises dressed up as a game.

### Design pillars

1. **Living, not studying.** Every language interaction has an in-world purpose: you buy, sell, fish, eat, find and help. There are no quiz screens.
2. **Always understandable.** Hover for a translation, click a word to save it, and toggle the script. A beginner is never stuck, and an advanced player is never bored.
3. **Characters first.** NPCs are sitcom-strength personalities ([NPC doc](hellovalley-village-npcs.md)). Their personality *is* the lesson.
4. **Cozy together.** One shared world. Other players are fellow learners, and talking to them is as natural as talking to NPCs.
5. **Hybrid AI, invisible.** On-device AI makes everything instant and cheap, and the cloud adds depth. The player never sees which one answered.

### Target

- **Platform:** desktop web (Chrome first, because on-device Gemini Nano runs in Chrome desktop), keyboard and mouse.
- **Audience:** teens and adults, beginner (A1) to advanced (C1+).
- **Session length:** 10–40 minutes; a daily-return loop.

---

## 2. Player journey

### 2.1 Onboarding (first session, about 3 minutes)

1. **Google sign-in** (required, Firebase Auth).
2. **Native language**: drives UI language, translations and glosses.
3. **Target language**: any Gemini TTS-supported language (see [NPC doc § Available TTS languages](hellovalley-village-npcs.md#available-tts-languages)), different from the native language.
4. **Self-assessed level**: "I'm brand new" (A1) / "I know some basics" (A2) / "I can hold a simple chat" (B1) / "I'm comfortable" (B2) / "I'm fluent-ish" (C1). Gameplay then adjusts it silently (§ 6.4).
5. **Character creation**: name, animal, shirt colour, trousers colour (§ 3).
6. **Town style**: pre-selected from the target language (§ 7.3) and changeable at any time in Settings.
7. **Apartment assignment**: the player receives a persistent apartment number such as `6D` (§ 4.2).
8. **Intro cutscene**: the Mayor welcomes you in the target language (cached, pre-generated per language and level), hands you your key, and the camera pulls out of your apartment window to reveal the town.

Players can add more target languages later. Each target language has its own level, notebook and NPC friendships, but the same avatar and apartment.

### 2.2 Core loop

```
Wake up in apartment ─► check daily requests (Town Hall board / NPC asks)
        │
        ▼
Walk the town ─► talk to NPCs & players (target language)
        │            ├─ buy / sell / haggle
        │            ├─ fish, forage, find lost items
        │            ├─ eat & drink (buffs + NPC reactions)
        │            └─ run errands (understand instructions to complete them)
        ▼
Earn coins + friendship + new words in notebook
        │
        ▼
Decorate apartment · review notebook (SRS) · unlock NPC stories
```

### 2.3 Long-term goals

- **Friendship** with each of the 9 NPCs (0–10 hearts). Higher friendship unlocks backstory conversations, recipes, discounts and special items.
- **Language level** grows from tracked performance (§ 6.4). It is shown as a gentle CEFR badge, never as a grade.
- **Collections**: fish encyclopedia, foraged-item album, recipes cooked, and furniture.
- **Apartment** decoration.
- **Notebook mastery**: words move from *new* → *learning* → *known*.

---

## 3. Characters (player avatars)

### 3.1 Body plan

A shared chibi humanoid rig, about 2.5 heads tall, with rounded limbs and toy-like proportions. Each animal has its own head mesh (with ears), plus an optional tail, muzzle and fur pattern, all attached to the same skeleton. Clothing is a T-shirt and trousers on the base body, tinted through material parameters.

### 3.2 Animal roster (16)

| Animal | Personality hint for flavour text | Notes |
|---|---|---|
| Fox | Clever, curious | Bushy tail |
| Rabbit | Energetic, gentle | Long ears (floppy or upright variant) |
| Cat | Independent, playful | Tail; tabby / plain pattern |
| Dog (Shiba-like) | Loyal, cheerful | Curled tail |
| Bear | Warm, calm | Round ears |
| Red panda | Shy, sweet | Striped tail, face markings |
| Raccoon | Mischievous | Mask marking, ringed tail |
| Hedgehog | Cautious, kind | Soft rounded spikes |
| Otter | Playful, social | Flat tail |
| Capybara | Unbothered, zen | Optional tiny orange on head |
| Koala | Sleepy, cuddly | Fluffy ears |
| Penguin | Formal, funny | Flipper hands variant |
| Owl | Wise, bookish | Feather tufts |
| Frog | Cheerful, quirky | Wide smile |
| Sheep | Soft, dreamy | Wool cap mesh |
| Deer | Graceful, gentle | Small antlers optional |

Fur colour comes from a per-animal set of 3–4 natural tints, so there are no neon foxes.

### 3.3 Colours

- **Shirt** and **trousers**: each is picked from a 16-swatch pastel palette (cream, butter, peach, coral, blush, lilac, lavender, periwinkle, sky, mint, sage, moss, sand, terracotta, charcoal, navy) plus an "advanced" HSL picker clamped to the pastel lightness and saturation range.
- **Name**: 2–16 characters, run through the moderation filter (§ 9.3), and displayed above the avatar.

All customization can be changed later in the apartment mirror, which is also a language moment: the mirror labels the clothing items in the target language.

---

## 4. The world

### 4.1 Town layout: the "difficulty road"

The town is a compact diorama (about 120 × 90 m). Buildings line one winding road, from easy (near home) to hard (far side of the river). The difficulty of each building is shown on its sign as 1–5 leaves.

```
                    ┌──────────── HILL ─────────────┐
                    │  📚 Library     🏡 Elder's     │   ★★★★★ Advanced
                    │                    cottage     │
                    └──────────┬────────────────────┘
          ~~~~~~~~~~~~~~~~~~ 🌉 ~~~~ RIVER ~~~~~ 🎣 fishing dock ~~~~~
                               │
                         🏛 Town Hall                       ★★★★ Upper-int.
                    ┌──────────┴──────────┐
                    │   TOWN SQUARE        │
                    │  ⛲ fountain · 🌳 trees│
                    │  🪑 benches · lamps   │                ★★★ Intermediate
                    │  ☕ Café   🏠 Gossip's │
                    │           house      │
                    └──────────┬──────────┘
                 🏪 General store   🏥 Clinic                ★★ Elementary
                               │
                 🥖 Bakery     🌾 Farm (community farm plot)   ★ Beginner
                               │
                     🏢 APARTMENT BLOCK (spawn)
```

- **Apartment block** (spawn, south). A 4–6 storey modular block with balconies and a shared entrance.
- **Beginner ring**: Bakery (Baker) and the community farm with a barn (Farmer). Both are right outside the apartment door.
- **Elementary ring**: General store (Shopkeeper) and Clinic (Doctor).
- **Town square**: fountain, benches, trees, lamps, flower beds and a notice board. The Café (Barista) opens onto it, and the Gossip lives in a house on the square and usually sits on "their" bench.
- **Town Hall** (Mayor) closes the north side of the square. Its board holds the daily requests.
- **River** crosses the whole map, with one stone bridge and a fishing dock. The Elder often fishes on the dock.
- **Hill** across the river: Library (Librarian) and the Elder's cottage.

Each building has an interior scene: the camera cuts away the exterior walls and roof, diorama style.

### 4.2 Apartments

- Each player has a persistent apartment ID: floor 1–9 + door A–H (for example `6D`), assigned at random at sign-up. Uniqueness is not required, because interiors are private instances. The ID is part of identity: "I'm in 6D!" is an early beginner phrase.
- **Interior**: a small studio (bed, kitchen nook, table, window, mirror, wardrobe). Furniture is placed on a 0.5 m grid with rotation.
- **Visiting**: a door intercom in the lobby lists the players online, and the owner accepts the visit.
- **Kitchen**: cook recipes from ingredients (§ 5.4).

### 4.3 Time

- A shared server clock. **1 in-game day = 40 real minutes** (day 30 min, night 10 min).
- Lighting follows a warm day/night gradient, and lamps and windows glow at night.
- NPC schedules: each NPC has 4–6 schedule points per day (for example, the Baker opens at 6:00, eats lunch on the square at 12:00 and closes at 18:00).
- There are no seasons in v1. The weather is cosmetic (sun, light rain, fog) and conversations reference it.

### 4.4 Multiplayer: one mixed world

- **Shards**: a Colyseus `TownRoom` holds up to 40 players, and new shards (Valley #1, #2…) open when it is full. Friends can join a friend's shard.
- **Shared state**: player positions and animations, NPC positions and schedules, world time and weather, forage spawns, and fish shadows.
- **Per-player rendering**: the town *layout* is identical for everyone. The *style* (European, Mediterranean, Arabic, Japanese) is a client-side choice, so two players on the same square can see different architecture.
- **NPC conversations are 1:1.** Other players see a "💬 chatting" indicator above the pair. NPC *ambient barks* (short pre-generated lines such as the Baker shouting "Fresh bread!") are shown to every nearby player in each player's own target language, from cache.
- **Player-to-player chat**: see § 6.6.

---

## 5. Activities and economy

Currency: **coins** (🪙). Prices are deliberately round and small, so beginners can practise numbers.

### 5.1 Buying and selling

| Seller | Sells | Buys |
|---|---|---|
| Bakery | Bread, pastries, cakes (food) | Flour, eggs, berries |
| Farm | Vegetables, eggs, milk, seeds (cosmetic plants) | Foraged plants, mushrooms |
| General store | Furniture, tools (fishing rod, net), clothing colours, gifts | Almost anything, at a lowball price |
| Café | Drinks, snacks | — |
| Clinic | Remedies (cosmetic buffs) | Herbs |
| Library | Books (lore and recipes) | Rare finds (old letters, coins) |

- **Shop UI = conversation.** You ask for an item in the target language, by suggested reply or free text. The NPC proposes an `offer` action, and a confirmation card shows the item, its price and Buy / No.
- **Haggling** (Shopkeeper only, optional): the NPC opens with an inflated price, and polite, correct bargaining phrases lower it. The discount depends on how well the player expresses the request and on friendship. The LLM returns a `priceAdjustment`, which the server clamps to between −30% and +10%.

### 5.2 Fishing

- At the river dock and banks. Cast (hold to choose distance) → wait (fish shadow approaches) → bite → timing mini-game (keep a bobber in a moving zone for 2–4 s).
- About 18 fish species with rarity by time of day and weather, each labelled with its target-language name and audio when caught.
- The Elder is often on the dock and comments on your catch with proverbs. Friendship with the Elder unlocks secret fishing spots.

### 5.3 Foraging and finding things

- Daily spawns: flowers, mushrooms, shells and pebbles by the river, berries, and lost items (glasses, a letter, a hat).
- Lost items belong to NPCs. The Gossip gives cryptic hints in the target language ("I saw something shiny near the bridge…"). Returning an item earns friendship.
- **Labelled world objects**: hovering any interactable object shows its target-language word, reading and audio, and one click saves it to the notebook.

### 5.4 Eating, drinking and cooking

- Eating gives short **buffs**: Bread → +10% walk speed (5 min). Coffee → one extra suggested-reply hint per conversation (10 min). Fish stew → better fishing luck. Cake → happy emote, and the Doctor scolds you if you eat three cakes.
- Sitting at a café table or square bench to eat triggers ambient small talk opportunities.
- **Cooking**: the apartment kitchen combines 2–3 ingredients into a recipe. Recipes are learned from NPCs (the Baker teaches bread, the Farmer teaches stew). Recipe cards are written in the target language.

### 5.5 Daily requests

- The Town Hall board shows 3 daily requests, written in the target language at the player's level. Example: "The Farmer needs 3 eggs delivered to the Bakery before 12:00."
- NPCs also ask for favours directly in conversation (the `giveQuest` action).
- Completing a request requires *understanding* it. Rewards are coins, friendship and sometimes furniture.

### 5.6 Inventory

24 slots plus a hotbar of 6. Items have an id, quantity and a per-language label. Server-authoritative.

---

## 6. Language systems

### 6.1 Speech bubbles (NPC → player)

Each NPC line is delivered as:

- **Audio**: Gemini TTS in the NPC's voice (see [NPC doc § Voice](hellovalley-village-npcs.md#voice-and-speaking-tone-tts)). Played once automatically; the replay button repeats it, and the 🐢 button replays at 0.75× speed.
- **Text** in the target language, tokenized into words.
- **Word hover** → tooltip with the lemma, reading, gloss in the native language and part of speech. **Click a word** → saved to the notebook, with the sentence as example context.
- **Sentence hover** (or hovering the bubble's 🌐 icon) → full translation into the native language.
- **Script toggle** (languages with a non-Latin script) — one 3-state button that cycles:
  1. **Native script** only — `こんにちは`
  2. **Both** — native with the reading aligned under each word (romaji for JA, pinyin for ZH, Revised Romanization for KO, transliteration for AR/RU/EL/HE/HI…). For Japanese, "Both" also adds furigana over kanji.
  3. **Romanized** only — `konnichiwa`

  The preference is saved per target language. The button label shows the current state (`あ` / `あ+a` / `a`).
- Bubbles keep the last 3 lines visible, and the full log is in the conversation panel.

### 6.2 Player replies (player → NPC): hybrid input

- **Suggested replies** in the target language. How many depends on level: A1–A2 get 3 replies, each with a hover translation; B1 gets 2; B2 gets 1 starter fragment; C1 gets none (a 💡 button reveals one on demand).
- **Free input**: type in the target language, or optionally use the microphone (browser speech recognition → text). Typing in the native language is allowed but gently redirected: the NPC answers in the target language and shows "here's how to say that: …".
- **Grammar feedback** (on-device): before sending, a quick check can show a soft correction ("✨ *Je voudrais un croissant* sounds more natural"). The player can send the original anyway. This is never blocking or red-ink.

### 6.3 Notebook and spaced repetition

- The notebook holds words and phrases saved by clicking a word in a bubble, a world-object label or a chat message. Each entry stores the surface form, lemma, reading, gloss, example sentence, source (NPC or object), audio clip reference, and date.
- **SRS** uses the FSRS algorithm (fallback SM-2), with a daily review of 5–15 cards: listen to the audio, recall the meaning, rate Again / Hard / Good / Easy.
- **In-world review**: the Librarian gives "homework" review sessions, and other NPCs deliberately reuse your *learning* words in conversation (they are injected into the NPC prompt, see [NPC prompts](prompts/npc-runtime.md)).
- **Stats**: words known, streak, and words by source NPC.

### 6.4 Difficulty model

Every NPC is reachable at every level ([NPC doc § progression](hellovalley-village-npcs.md#suggested-language-learning-progression)). The language actually used is:

```
effectiveLevel = clamp(playerLevel + npcTierOffset, A1, C2)
npcTierOffset:  Baker/Farmer −1 · Shopkeeper/Doctor 0 · Barista/Gossip 0
                Mayor +½ · Librarian/Elder +1
```

The offsets are in half-CEFR steps. Below A1 the offset is absorbed: the line is simplified, keeping the personality.

- **Level adaptation**: after each conversation, the on-device summarizer also outputs signals (suggested replies used vs. free input, hover-translation rate, grammar corrections, comprehension in errands). The server keeps a moving estimate, and the player's level moves by ½ step at most once per in-game day, with a toast ("The Baker thinks you're improving! 🥐").

### 6.5 World labels

Every interactable object has a `labelKey`. Hovering shows the target-language word and reading, and a click plays its audio and saves it. Labels are generated once per language, cached in Firestore, and reviewed by spot checks.

### 6.6 Player-to-player chat

- Press Enter to type. Messages appear as proximity bubbles (radius about 12 m) and in a chat log.
- **Display rule**: each reader sees the message **in their own target language** (practice!). **Hover** shows the original text as written, plus a translation into the reader's native language.
- If the sender typed in the reader's target language, the message is shown as written, with no translation.
- Short messages are translated on-device; long ones in the cloud. Translations are cached per message id.
- **Moderation** (§ 9.3) runs before a message is shown.
- Words in chat messages can be clicked and saved to the notebook like NPC words.
- Emotes: wave, laugh, heart, thinking, clap (keys 1–5).

---

## 7. Art direction

### 7.1 Visual target

> Cozy isometric 3D miniature diorama, stylized low-to-medium-poly geometry, detailed modular architecture, pastel colour palette, soft ambient occlusion, warm lighting, lush rounded vegetation, toy-like proportions, subtle hand-painted textures.

- **Camera**: orthographic isometric (about 35° pitch, 45° yaw). Rotate in 90° steps (Q/E), zoom with the scroll wheel (3 levels), and a slight tilt-shift DOF for the miniature feel.
- **Lighting**: a warm key directional light with soft shadows (PCSS or soft shadow maps), cool sky hemisphere fill, screen-space AO (N8AO) and a gentle bloom on lamps.
- **Materials**: vertex colours plus small tiling hand-painted texture atlases (one per style), and a slight rim light. No PBR realism.
- **Vegetation**: rounded "cloud" canopies made from clustered blobs, instanced, with wind sway in the vertex shader.
- **Water**: a stylized river shader with a scrolling normal, foam at the edges and depth tint.
- **UI**: rounded pastel cards, soft shadows and a hand-drawn icon set, with a friendly rounded font that has broad script coverage (Noto Sans with per-script variants, and Noto Sans JP/SC/KR/Arabic loaded on demand).

### 7.2 Procedural asset library (Blender Python → GLB)

The heart of the art pipeline is a **semantic modular kit** generated by Blender `bpy` scripts kept in the repo (`tools/blender/`).

**Concept:** buildings are defined *once* as style-agnostic **recipes**, and each style supplies its own **module set**.

```
building recipe (JSON, style-agnostic)            style kit (GLB per style)
─────────────────────────────────────             ───────────────────────────
footprint: 3×2 cells, floors: 2                    wall.plain     wall.window
slots:                                             wall.door      wall.shopfront
  ground.front: [shopfront, door, wall.window]     corner.outer   corner.inner
  floor1.front: [window, balcony, window]          roof.gable     roof.hip
  roof: gable(ridge=x)                             roof.flat      roof.dome
props: sign(bakery), awning, flowerbox×2           balcony        awning   sign
                                                   chimney        stair    fence
         │                                                 │
         └──────────────► assembler (client) ◄─────────────┘
                     snaps modules on a 1 m × 1 m × 3 m grid
```

- **Grid**: 1 m cells, 3 m storey height, and modules pivot at the bottom-left-front corner. Every style's module for a given semantic id has an identical footprint, so recipes work in all styles.
- **Generator parameters** per style: palettes, wall thickness, window shapes, roof pitch, eave overhang, trim profiles, bevel and noise amounts, and seeded variation (3 variants per module).
- **Outputs**: `public/assets/kits/{style}/{module}.glb` plus `kit-manifest.json` (ids, sockets, bounds, variant count). The files are compressed with meshopt and textures are KTX2.
- **Budgets**: a wall module is 150–600 tris and a hero prop up to 2k. The whole town is under 300k tris on screen and under 150 draw calls (instanced, and merged by material per building).
- **Shared (style-neutral) modules**: terrain tiles, river banks, bridge supports, fishing dock, generic props (crates, barrels, baskets) and interior furniture.
- **Characters**: one generated base body rig plus 16 animal heads and tails. Animations are scripted keyframes generated in bpy: idle, walk, run, sit, talk, wave, fish-cast, fish-reel, eat, cheer and the emotes.

### 7.3 Town styles

| Style | Look | Signature modules | Default for |
|---|---|---|---|
| **Central & Northern European** | Half-timbering, steep gables, slate or red-tile roofs, flower boxes, stepped gables | Timber frame wall, dormer, stepped gable, cobblestone, linden/oak trees | German, Dutch, English, French, Polish, Czech, Danish, Norwegian, Hungarian, Russian and Slavic, Baltic, Icelandic |
| **Mediterranean** | Whitewash and ochre stucco, terracotta, blue/green shutters, arches, pergolas | Arched door, shutter window, low tile roof, bougainvillea, olive/cypress/lemon trees | Spanish, Italian, Portuguese, Greek, Catalan, Galician, Basque, Maltese, Romanian |
| **Arabic** | Sand and rose plaster, flat roofs with crenellation, horseshoe arches, mashrabiya screens, domes, zellige accents | Courtyard fountain, dome roof, mashrabiya, arcade, date palms | Arabic variants, Persian, Turkish, Hebrew, Kurdish, Urdu/Punjabi, Hausa |
| **Japanese** | Dark wood and white plaster, kawara tile roofs with curved eaves, engawa, shoji, noren curtains | Curved-eave roof, sliding door, stone lantern, sakura, pine, bamboo fence | Japanese, Korean, Chinese, Cantonese, Vietnamese, Mongolian |

Languages without an obvious match (for example Hindi, Indonesian, Swahili) default to Mediterranean until a dedicated style exists. The mapping lives in data (`shared/src/styles/defaults.ts`), and the player can change the style at any time.

---

## 8. NPC behaviour

The cast, personalities, signature phrases, voices and relationships are defined in [hellovalley-village-npcs.md](hellovalley-village-npcs.md). This section adds runtime behaviour.

### 8.1 Conversation flow

1. The player presses **F** (or clicks) near an NPC. The NPC turns, the camera eases in, and the conversation panel opens.
2. **Opener**: served from cache when possible (pre-generated greetings per NPC × language × level × time-of-day × friendship band), personalised on-device with the player name and memory summary. The result is instant and costs $0.
3. **Turns**: the player's input goes to the server, which builds the prompt (persona, level, memory, learning words, world state, inventory and prices) and calls Gemini Flash in the cloud. The structured JSON reply is validated, actions are applied authoritatively, and TTS is fetched from cache or generated.
4. **Close**: when the player says goodbye or walks away, a background on-device summarizer compacts the transcript into memory (§ 8.2).

### 8.2 Memory

- **Per-player NPC memory** (Firestore `users/{uid}/npcMemory/{npcId}`): a summary of at most 120 words in the native language (for example "Lia likes rye bread, struggles with numbers, promised to bring eggs"), plus key facts, last-seen date and hearts. It is compacted on-device after every conversation, with cloud fallback.
- **Friendship**: 0–10 hearts. It rises through conversation quality (as judged by the LLM within limits), gifts (each NPC has liked and disliked items), completed requests and daily greetings, and decays slightly after 7 days without contact.
- **Shared village memory** (Gossip and Elder only): a server-side rolling log of *public game events* per shard and globally. Examples: "a player caught a golden carp", "the bakery sold out", "Kenji (6D) decorated with 20 plants". There is no private chat content. Players can opt out of being named. The Gossip turns events into rumours (sometimes exaggerated), and the Elder turns them into legends.
- **NPC relationships** from the NPC doc show up in barks and dialogue (for example, the Librarian correcting the Mayor's notice-board posts).

### 8.3 Ambient life

NPCs follow their schedules, play idle animations, run short NPC↔NPC bark exchanges (pre-generated and cached), and react to weather and time.

### 8.4 Action protocol

NPC replies may include **actions** that the server validates against inventory, prices and rules:
`offer(itemId, price)` · `buy(itemId, price)` · `give(itemId)` · `giveQuest(questId)` · `completeQuest(questId)` · `teachRecipe(recipeId)` · `priceAdjustment(pct)` · `friendshipDelta(−1..+1)` · `endConversation`.
The LLM proposes and the server decides. The full JSON schema is in [prompts/npc-runtime.md](prompts/npc-runtime.md).

---

## 9. Technology

### 9.1 Stack

| Layer | Choice |
|---|---|
| Client | React 19 + Vite, React Three Fiber + drei, postprocessing (N8AO, bloom, tilt-shift), Zustand for UI state, `colyseus.js` |
| Shared | Headless TS: protocol types, schemas (zod), game rules (prices, recipes, items), SRS, style mapping, difficulty math |
| Server | New workspace `packages/server`: Colyseus (authoritative `TownRoom`, `ApartmentRoom`), Gemini API (dialogue + TTS), Firebase Admin. Hosted on Cloud Run (WebSockets) |
| Firebase | Auth (Google), Firestore, Cloud Storage (TTS clips, generated assets), Hosting (client), **AI Logic** (client hybrid inference), App Check |
| Asset tools | `tools/blender/` bpy generators + `gltf-transform` optimise script |

### 9.2 Hybrid AI routing

On-device inference uses Firebase AI Logic hybrid mode (Gemini Nano in Chrome). Per the current docs, on-device mode supports **single-turn** prompts only: no multi-turn chat, no tools/function calling, and the first use triggers a model download that can take minutes. So all on-device tasks are designed as single-turn prompts with short JSON outputs.

| Task | Where | Mode | Fallback |
|---|---|---|---|
| Word gloss / short sentence translation (≤ 25 words) | Client, on-device | `PREFER_ON_DEVICE` | Cloud → Firestore translation cache |
| Long translation, P2P chat ≥ 25 words | Cloud | `PREFER_IN_CLOUD` | On-device |
| Grammar feedback on player input | Client, on-device | `ONLY_ON_DEVICE` | Skip silently (feature is optional) |
| P2P chat moderation (pre-send) | Client, on-device | `PREFER_ON_DEVICE` | Server-side check always runs too |
| Conversation compaction → NPC memory + level signals | Client, on-device (background, after conversation) | `PREFER_ON_DEVICE` | Server does it in cloud |
| Conversation opener personalisation | Client, on-device over cached opener | `ONLY_ON_DEVICE` | Use the cached opener unchanged |
| NPC dialogue turns (multi-turn, actions) | Server → Gemini Flash (cloud) | — | Canned cached fallback lines + "the NPC is busy, come back later" |
| TTS | Server → Gemini TTS | — | Text only, with a "🔇" badge |
| Village memory → rumours/legends | Server, cloud, batch | — | Last good batch |

- **Warm-up**: the client checks on-device availability at login and, if supported, starts the model download in the background while the player is in character creation, with a "✨ Speeding up translations…" chip.
- **Caching**: content hash `sha256(kind, npcId, lang, level, text)` → Firestore doc + Storage clip. Repeated lines cost $0 ([architecture.md](architecture.md)).
- **Server guards**: per-user rate limits (for example 30 NPC turns per 10 min), token caps per turn, and the daily budget per user degrades gracefully to cached lines.

### 9.3 Safety

- Google sign-in is required. Display names are moderated.
- P2P chat is checked on-device before sending *and* on the server before broadcasting. Players can mute, block and report, and repeat offenders are muted shard-wide.
- **Prompt injection**: player text goes into NPC prompts as quoted data, never as instructions. NPC output must match the JSON schema, and actions are validated by server rules, so a player cannot "talk" the Shopkeeper into a 0-coin price beyond the clamp.
- Village memory stores only public game events.

### 9.4 Data model (Firestore, initial)

```
users/{uid}                      name, animal, colors, apartmentId, nativeLang, targetLangs[], style, createdAt
users/{uid}/langs/{lang}         level, levelEstimate, streak, coins, hearts{npcId}, settings{scriptMode}
users/{uid}/langs/{lang}/notebook/{entryId}   surface, lemma, reading, gloss, example, source, fsrs{…}
users/{uid}/langs/{lang}/npcMemory/{npcId}    summary, facts[], lastSeen
users/{uid}/inventory/{slot}     itemId, qty
users/{uid}/apartment/layout     furniture[{itemId, x, z, rot}]
village/{shardId}/events/{id}    type, actorName?, payload, ts       (TTL 14 days)
village/global/legends/{id}      text by lang (generated)
cache/lines/{hash}               text, reading, tokens, translation{lang}
cache/tts/{hash}                 storagePath, voice, durationMs
cache/labels/{lang}              labelKey → {word, reading, audioHash}
```

Security rules: players read and write only their own `users/{uid}` subtree, and writes to economy fields (coins, inventory, hearts) are **server-only** through the Admin SDK.

### 9.5 Performance targets

- 60 fps on an integrated GPU (Intel Iris Xe / M1) at 1080p. Time to interactive under 6 s on a 50 Mbps connection. Initial download under 15 MB, with style kits lazy-loaded (about 3–5 MB each).
- NPC first-line latency: under 150 ms from cache. Under 2.5 s for a cloud turn, with streamed text appearing first and TTS following.

---

## 10. Controls

| Input | Action |
|---|---|
| WASD / arrows | Walk (Shift = run) |
| Left click on ground | Click-to-move (pathfinding on navmesh grid) |
| F / click NPC or object | Interact / talk |
| Hover word / object | Gloss / label |
| Click word | Save to notebook |
| Q / E | Rotate camera 90° |
| Scroll | Zoom (3 levels) |
| Enter | Chat |
| 1–5 | Emotes |
| Tab | Inventory · N notebook · M map · Esc settings |

---

## 11. Audio

- NPC voice via TTS (cached clips).
- Music: a lo-fi acoustic loop per style (accordion and guitar for European, mandolin and guitar for Mediterranean, oud and qanun for Arabic, koto and shakuhachi for Japanese), with day and night variants.
- SFX: footsteps by surface, door chimes, fishing splash and reel, coins, cooking sizzle, and UI pops.
- Ambient: river, birds by day, crickets by night, distant chatter on the square.

---

## 12. Out of scope for v1 (candidates for later)

Crop farming and seasons, festivals run by the Mayor, P2P voice chat, pronunciation scoring, mobile/touch, user-generated content, and a trading market between players.

## 13. Risks and open questions

| Risk | Mitigation |
|---|---|
| On-device model unavailable (non-Chrome, low-spec hardware) | Every on-device task has a cloud or skip fallback (§ 9.2) |
| Cloud cost from free conversation | Caching, rate limits, short context (summaries instead of transcripts), cheap Flash model, budgets per user |
| LLM language quality varies for less common languages | Mark languages as "Featured" or "Experimental"; reports from native speakers; Librarian "correction" button for players to flag a line |
| Mixed world feels confusing | Clear 1:1 conversation indicators; per-reader chat translation |
| Asset generator complexity | Start with the European kit and 3 buildings; recipes are style-agnostic, so the other styles reuse the same layout |
| Romanization accuracy (JA kanji readings, AR vowels) | Ask the LLM for readings at generation time and cache them; use a dictionary-based tokenizer where available (kuromoji for JA, pinyin-pro for ZH) |

---

## 14. Prompt library

The game is too large to build in one shot, so it is built from a sequence of focused prompts:

1. **[Build plan — coding-agent prompts](prompts/build-plan.md):** about 30 ordered, self-contained milestone prompts, from the monorepo foundation to launch polish. Each has a goal, context, deliverables and acceptance criteria.
2. **[NPC runtime prompts](prompts/npc-runtime.md):** Gemini system prompts and JSON schemas for NPC dialogue, openers, translation, glosses, grammar feedback, moderation, compaction, the village rumour mill and labels.
3. **[Art prompts](prompts/art.md):** image-generation prompts for concept art, style sheets, texture atlases, characters, UI and key art, in the HelloValley diorama style.
