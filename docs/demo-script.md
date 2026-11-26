# HelloValley: 3-minute hackathon demo

Build plan M38. The route is: sign-in → onboarding in Japanese → romaji toggle → buy bread → a second
player chats in Spanish with hover translation → offline/on-device translation fallback → fishing with the
Elder → notebook review. Each beat says **where the inference runs**: 🟢 on-device (Gemini Nano through the
Chrome Prompt API), ☁️ cloud (Gemini through Firebase AI Logic), or ⚙️ no model (game server rules).

> Status: written against the code, not rehearsed. There is no production project yet (pending.md, M38), so
> the route has not been run end to end. Rehearse it on the production URL after following docs/deploy.md.

## Setup (before the clock starts)

| What | How |
|---|---|
| Two players | **Player A** (presenter): Chrome desktop profile 1, native English, will learn **Japanese**. **Player B**: Chrome profile 2 (another Google account), already onboarded with native English, learning **Spanish**, standing on the town square. Use two real profiles, not an incognito tab of the same one. |
| On-device model ready | In Player A's Chrome (139+), open `chrome://on-device-internals` and check that the model is ready. If it is not, sign in once beforehand: the first click starts the download, and the chip in the bottom-right corner shows "✨ Speeding up translations… NN %", then "✨ Translations sped up: they now run on your computer." In the DevTools console, `await LanguageModel.availability()` should print `"available"`. |
| Show where AI runs | Open `https://<site>/?ailog` (the flag lasts for the session). DevTools → Console, filtered on `[ai]`. Every AI call then prints a line such as `[ai] translateShort → on-device (84 ms)`, `[ai] npcTurn → cloud (template npc-turn-v1-0-0)` or `[ai] translateLong → fallback`. This is `packages/client/src/ai/routeLog.ts`, and the source comes from AI Logic's `inferenceSource`. |
| Time of day | The world clock is wall time: one in-game day lasts 40 real minutes and starts at a UTC minute that is a multiple of 40 (00:00, 00:40, 01:20 … 14:00 …). The Baker is in the bakery from 06:00 to 12:00 game time, and the Elder fishes on the dock from 05:30 to 11:00 game time. That is the first **10 real minutes** of each cycle. Start the demo within 0–6 min after such a UTC minute (`(utcHours*60 + utcMinutes) % 40` ≤ 6). |
| Fresh account | Player A's Google account has never onboarded (or delete its `users/{uid}` documents in the Firestore console). |
| Second tab for the cloud block | DevTools → ⋮ → More tools → **Network request blocking**, with the pattern `firebasevertexai.googleapis.com` added but **unticked**. |

The debug overlay (top-left) shows `server: connected · NN ms` and `shard 1`. Both players must show the same
shard.

## The route

| Time | Beat | What to do (keys and UI) | Where it runs |
|---|---|---|---|
| 0:00 | **Sign-in** | Click **Sign in with Google**. | ⚙️ Firebase Auth popup. ⚙️ App Check (reCAPTCHA Enterprise) attests the page before any AI call. The click also warms Gemini Nano (`startWarmUp`). |
| 0:10 | **Onboarding in Japanese** | **Which language do you speak best?** → English. **Which language do you want to learn?** → Japanese (under **Featured**). Level → **I'm brand new**. **Create your character**: type a name and pick an animal and colours. **Pick your town's style** → Japanese (marked **Suggested**). **Move in** → "Here is your key…" → **Go to my apartment**, then walk out through the door. | ⚙️ No model. The game server checks the name against the shared blocklist, assigns the apartment and starting coins (`POST /api/onboarding`) and writes Firestore with the Admin SDK. |
| 0:40 | **Romaji toggle** | Walk with WASD to the bakery (sign label) and press **F** near the Baker ("Talk to the Baker"). The opener appears in Japanese. Click the script button on the speech bubble (tooltip "Native script → both → romanized"): あ → あ+a (kana with romaji) → a (romaji only). Leave it on **あ+a**. | ☁️ or cache: the opener comes from the seeded `cache/lines`, the player's IndexedDB, or the `npc-opener` template (`[ai] npcOpener → cloud`). 🟢 `personaliseOpener` adds the player's name on-device. 🟢 `gloss` makes the word-by-word tooltips (≤ 25 words). ☁️ Voice: Gemini TTS, or a seeded clip. The toggle itself is UI only. |
| 1:00 | **Buy bread** | In the reply box ("Write in Japanese…") type `パンをください` and press **Enter**. Gemini Nano may suggest a more natural sentence ("✨ … sounds more natural" → **Use this** / **Send mine anyway**). The Baker answers in character and an offer card appears ("The Baker offers: Bread ×1 · N coins"). Click **Buy** → "Bought! You have N coins." Click **Goodbye**. | 🟢 `grammarFeedback` (on-device only, skipped without Nano) and 🟢 `detectLanguage` before sending. ☁️ The NPC turn uses the `npc-turn` server prompt template (`[ai] npcTurn → cloud`), and the persona never ships to the client. ⚙️ **The server, not the model, sets the price**: the reply is only a proposal; the server checks the item against the Baker's list, recomputes the price from shared rules and writes coins and inventory in a Firestore transaction. 🟢 On Goodbye, `compactConversation` writes the memory summary. |
| 1:25 | **Second player chats in Spanish, hover translation** | Walk back to the square, near Player B. On Player B: **Enter**, type `¡Hola! ¿Quieres pescar conmigo en el río?`, then **Enter**. On Player A, the line appears **in Japanese** in the chat log and in a bubble over Player B. Hover it: "Original: ¡Hola!…" and "In English: …". | 🟢 The sender's `moderateOutgoing` and 🟢 the reader's `moderateIncoming` (on-device; the server blocklist always runs too). 🟢 `translateShort` into the reader's target language, and again into English for the hover (≤ 25 words, on-device first). The console shows `[ai] translateShort → on-device`. |
| 1:50 | **Offline / on-device fallback** | On Player A, tick the `firebasevertexai.googleapis.com` block. Player B sends a long line (more than 25 words, for example two or three sentences about the weather and fishing). Player A still gets it in Japanese, and hovering still shows English. Untick the block afterwards. Optional: talk to an NPC while blocked. The NPC answers with a canned line in Japanese instead of failing. | Long text normally goes ☁️ first (`translateLong`, PREFER_IN_CLOUD). With the cloud blocked, AI Logic falls back to 🟢 Gemini Nano: the console shows `[ai] translateLong → on-device`. NPC turns are cloud-only templates, so they degrade to a canned line (⚙️). Without Nano, the same tasks fall back the other way, to the cloud (architecture §5.2). |
| 2:15 | **Fishing with the Elder** | Walk to the river dock where the Elder is fishing. **F** → a short chat with the Elder (cloud). Then stand on the dock: "Hold Space to cast" → hold and release **Space** → "Bite! Press Space now!" → **Space** → hold **Space** to keep the bobber in the catch zone → "You caught a fish!" The card shows "The Elder says:" with his comment, plus **Hear the Elder**. | ⚙️ The server decides the bite timing, the fish and the bag. ☁️ or cache: the Elder's comment is seeded (`cache/lines`), or else the `elderBark` task (cloud first, cached per player). ☁️ The Elder's turn uses the `npc-turn` template, with legends from server-supplied village events. ☁️ Gemini TTS for **Hear the Elder**. |
| 2:40 | **Notebook review** | Click a word in any speech bubble ("Click to save to your notebook") → "📓 Saved "…" to your notebook". Press **N** → the notebook shows Known / Learning / New and the day streak. Click **Review N words**, answer two cards, and finish. | ⚙️ FSRS scheduling in `shared/srs` (no model). ☁️ or 🟢 earlier: the saved entry's gloss came from the bubble (on-device for short lines). ⚙️ `POST /api/review` → the server updates the streak. |
| 3:00 | Close | "Small tasks on-device, NPCs in the cloud, the server owns the economy." | |

## Talking points (if asked)

- **Routing table**: `packages/shared/src/ai/routing.ts` (`ROUTING_TABLE`). Each task is one short prompt
  that returns a small JSON object, and each has a cloud or skip fallback (architecture §5.2). Gemini Nano
  has no chat, tools or templates, so NPC dialogue is cloud-only.
- **Trust**: model output reaches the server as an untrusted `npc:reply` proposal. The server clamps it,
  ignores the model's prices, and only accepts turn ids that it issued (architecture §6.1).
- **Prompt safety**: player text is quoted as `<player_text>…</player_text>` data, and every answer is
  validated with zod before use.
- **Cost**: on-device first, then seeded shared content, then per-player IndexedDB caches. The cloud is
  called only on a miss. App Check and the per-user AI Logic quota are the hard caps.
- **Prompt changes without a release**: the active template ids come from Remote Config
  (`npc_turn_template_id`, docs/deploy.md §7).

## If something goes wrong

| Symptom | Recovery |
|---|---|
| No `on-device` lines; everything says `cloud` | Nano is not ready on this machine. Say "it falls back to the cloud" and go on. The fallback beat then shows the reverse direction. |
| NPCs answer only with canned lines ("…didn't catch that", "…is busy") | The cloud is blocked or over quota, or the templates are missing in the console. Untick the request block, and check AI Logic usage and the template ids (docs/deploy.md §5). |
| Players are in different shards | Both reload. The matchmaker fills `Valley #1` first. |
| The Elder is not on the dock | The game day moved on (see Time of day). Fishing works without him, and the catch card still shows his comment. |
| `server: reconnecting` | The Fly Machine restarted. Clients rejoin by themselves within a few seconds, and nothing is lost. |
