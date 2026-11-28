# HelloValley: production deploy runbook

Build plan M38. The production Firebase project `hellovalley-app` exists and is linked locally as `prod`.
The production deploy has not been run (see `pending.md`, M38). Follow this runbook once, then use the
"Redeploy" section for later updates.

The topology comes from [architecture.md §3](architecture.md#3-deployment), which overrides the build plan's
Cloud Run:

| Piece | Where | Config in the repo |
|---|---|---|
| Client (React + R3F, every AI call) | Firebase Hosting | `firebase.json` → `hosting`, `packages/client/.env.production.local` (not committed) |
| Game server (Colyseus + `/api/*`) | **One** Fly.io Machine | `fly.toml`, `packages/server/Dockerfile`, `.dockerignore` |
| Firestore rules, indexes, TTL | Firebase | `firestore.rules`, `firestore.indexes.json` |
| Storage rules, CORS | Firebase / GCS | `storage.rules`, `storage.cors.json` |
| Active prompt template ids | Remote Config | `remoteconfig.template.json` |
| Server prompt templates | AI Logic console (copied by hand) | `packages/shared/src/ai/templates/*.prompt` |
| CI (no deploys) | GitHub Actions | `.github/workflows/ci.yml` |

`tests/deploy/deploy-config.test.ts` checks that these files agree with each other: the CSP allows the Fly
host named in `fly.toml`, the Remote Config defaults match the bundled template ids, the cache headers
match the build output names, and the CI actions are pinned.

## Names used below

Pick these first. The repo assumes the defaults; if you change one, change every file listed.

| Name | Default | Appears in |
|---|---|---|
| Firebase project id (`$PROJECT`) | `hellovalley-app` | `storage.cors.json` origins, `.firebaserc` alias (step 1) |
| Fly app (`$FLY_APP`) | `hellovalley` → `https://hellovalley.fly.dev` | `fly.toml` `app`, the `firebase.json` CSP `connect-src` (https and wss), `VITE_SERVER_URL` |
| Firestore and Storage location | `europe-west1` (Belgium) | chosen in the console, cannot change later |
| Fly region | `ams` (Amsterdam, close to `europe-west1`) | `fly.toml` `primary_region` |

The game server makes a Firestore round trip for every economy change, so keep the Fly region next to the
Firestore location (architecture §3.1, §12).

Set `PROJECT=hellovalley-app` in your Bash session before running commands that use `$PROJECT`.

## 0. Prerequisites

- Node 26.13+ and npm 11.16+ (`.nvmrc`; `npm install --global npm@11.16.0 --ignore-scripts`).
- Firebase CLI 15.x (`firebase --version`) and `firebase login`.
- Google Cloud CLI (`gcloud`), for Storage CORS, IAM and the service account key: `gcloud auth login`.
- `flyctl` and `fly auth login`.
- A billing account. The project must be on **Blaze**: new projects need it for Cloud Storage, reCAPTCHA
  Enterprise needs billing, and the free Gemini quotas are too small for a multiplayer demo (architecture §9).
- From the repo root: `npm ci`, then `npm run typecheck && npm test && npm run build` pass.

## 1. Set up the Firebase project

1. Open [hellovalley-app in the Firebase console](https://console.firebase.google.com/project/hellovalley-app/overview).
   If setting up a different project, click **Add project**, choose its project ID and leave Google Analytics off
   (the game does not use it).
2. Click **Upgrade** and pick **Blaze**. In Google Cloud **Billing → Budgets & alerts**, add a budget for the
   project (for example 20 EUR with alerts at 50/90/100 %).
3. `.firebaserc` already maps `prod` to `hellovalley-app` and keeps `default` on `demo-hellovalley` for the
   emulators. If you switch production projects, update the `prod` alias:
   ```bash
   firebase use --add        # pick $PROJECT, alias: prod
   ```
   The resulting alias in `.firebaserc` is not a secret.
4. Under **Project settings → General → Your apps**, add a **Web app** (no Hosting setup there). Keep its
   config (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`) for step 9.

## 2. Authentication

1. Go to **Build → Authentication → Get started**. Under **Sign-in method**, enable **Google** only. Do **not**
   enable Anonymous: the rules treat `request.auth != null` as a signed-in player (pending.md, M36 audit).
2. Under **Settings → Authorized domains**, check that `$PROJECT.web.app` and `$PROJECT.firebaseapp.com` are listed.
   Add any custom domain, and add a preview channel domain only while you use it (step 11).

## 3. Firestore

1. Go to **Build → Firestore Database → Create database**. Choose **Standard edition**, **Native mode** and
   location `europe-west1`, and start in production mode (the repo's rules replace the default ones).
2. Deploy the rules, the indexes and the TTL policy:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes --project prod
   ```
   - **Indexes**: every query in the code uses a single field, so the built-in single-field indexes cover
     them and there are no composite indexes:
     - `users/{uid}/langs/{lang}/notebook`, ordered by `createdAt` desc with a limit (client notebook, server
       `npcStore`);
     - the same collection filtered on `fsrs.lastReview >= …` (server `streakStore`);
     - `village/{shard}/events`, filtered on `ts >= …` and ordered by `ts` desc (server `villageStore`).

     If the console ever logs "The query requires an index" with a link, follow the link and copy the result
     into `firestore.indexes.json` with `firebase firestore:indexes --project prod`.
   - **TTL**: the `fieldOverrides` entry turns on a TTL policy for collection group `events`, field
     `expiresAt`. The server sets that field to 14 days after the event (architecture §8.1). The policy can
     take up to a day to turn on. Check its state under **Firestore → Time-to-live**, or with
     `gcloud firestore fields ttls list --project $PROJECT`. TTL deletes run within about 24 h after expiry;
     the server ignores events older than its own windows, so the delay does not matter.
     If the CLI refuses the TTL override, create the policy by hand:
     `gcloud firestore fields ttls update expiresAt --collection-group=events --enable-ttl --project $PROJECT`.

## 4. Cloud Storage

1. Go to **Build → Storage → Get started**, use the same location as Firestore and start in production mode.
   Note the bucket name: `$PROJECT.firebasestorage.app` on new projects, or `$PROJECT.appspot.com` on older ones.
2. Deploy the rules: `firebase deploy --only storage --project prod`.
3. Apply CORS so that the client's `getBytes` (seeded voice clips) works from the Hosting origins:
   ```bash
   gcloud storage buckets update gs://$BUCKET --cors-file=storage.cors.json
   gcloud storage buckets describe gs://$BUCKET --format="default(cors_config)"
   ```
   `storage.cors.json` allows `GET`/`HEAD` from `https://$PROJECT.web.app` and `https://$PROJECT.firebaseapp.com`.
   Add a custom domain there if you use one. A dev project that is used from `npm run dev` also needs
   `http://127.0.0.1:5173`.

## 5. Firebase AI Logic and the server prompt templates

1. Go to **Build → AI Logic → Get started** and pick the **Gemini Developer API**. The console enables the
   APIs and creates the key that AI Logic uses on the server side. That key never reaches the client.
2. Upload the **server prompt templates** (architecture §3.2, §5.3). For each file, create a template in
   **AI Logic → Prompt templates** whose id is the file name plus the version suffix, and paste the whole
   file (frontmatter included):

   | Template id | Source file |
   |---|---|
   | `npc-turn-v1-0-0` | `packages/shared/src/ai/templates/npc-turn.prompt` |
   | `npc-opener-v1-0-0` | `packages/shared/src/ai/templates/npc-opener.prompt` |

   The ids must match `PROMPT_TEMPLATE_IDS` in `packages/shared/src/ai/dotprompt.ts` and the defaults in
   `remoteconfig.template.json`. Paste the files as they are in git: the shared tests check the variables
   against the builders. Lock or protect the templates if the console offers it.
3. Lower the **per-user rate limit**. In Google Cloud **IAM & Admin → Quotas**, filter on the Firebase AI Logic
   API (`firebasevertexai.googleapis.com`) and set the per-user generate-content quota to about **20 RPM**
   (the default is 100). Also review the Gemini API project quotas (architecture §9).
4. The models are `gemini-3.8-flash` (NPC turns, templates), `gemini-3.5-flash-lite` (cloud fallback for the
   small tasks) and the TTS model in `packages/shared/src/ai/models.ts`. Check that the project can call all
   of them.

## 6. App Check (reCAPTCHA Enterprise)

1. In Google Cloud **Security → reCAPTCHA**, create a **website** key (score-based, no checkbox). Add the
   domains `$PROJECT.web.app` and `$PROJECT.firebaseapp.com`, plus any custom domain.
2. In Firebase go to **Build → App Check → Apps**, register the web app with **reCAPTCHA Enterprise**, and
   paste the site key. The site key also goes into `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` (step 9).
3. For development: under **App Check → Apps → ⋮ → Manage debug tokens**, add a token. Put it in the dev
   machine's `packages/client/.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`. It never goes into the production env.
4. **Enforce**, but only after the client is live and the App Check metrics show mostly verified requests:
   **App Check → APIs**, then **Enforce** for **Firebase AI Logic**, **Cloud Firestore** and **Cloud Storage**.
   The game server enforces App Check on its own (`APP_CHECK=enforce` in `fly.toml`).

## 7. Remote Config (active template ids)

```bash
firebase deploy --only remoteconfig --project prod
```

This publishes `remoteconfig.template.json`: `npc_turn_template_id` and `npc_opener_template_id`. A deploy
**replaces the whole Remote Config template**, so keep every parameter in that file. The client
(`packages/client/src/firebase/remoteConfig.ts`) fetches the values once per 12 h. It only accepts a
well-formed id of the same template (`npc-turn-vX-Y-Z`). Anything else, or no answer, falls back to the
bundled id.

**To change a prompt later**: copy the edited `.prompt` file to the console under a new id (for example
`npc-turn-v1-1-0`), test it with a dev client, then set the parameter to the new id in the console or in
`remoteconfig.template.json` and deploy again. No client release is needed. Leave the old template in place
so you can roll back.

## 8. Game server on Fly.io

### 8.1 Service account (least privilege)

```bash
gcloud iam service-accounts create game-server --display-name="HelloValley game server" --project $PROJECT
SA=game-server@$PROJECT.iam.gserviceaccount.com
# Firestore read/write (authoritative economy writes, architecture §6.2).
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
# verifyIdToken(checkRevoked) reads the user record.
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/firebaseauth.viewer
gcloud iam service-accounts keys create game-server-key.json --iam-account=$SA
```

App Check token verification uses Google's public keys and needs no role. If an organisation policy blocks
key creation (`iam.disableServiceAccountKeyCreation`), allow it for this project, or use workload identity
federation (not set up here). **Never commit the key**. `.gitignore` covers `*-key.json` and
`*service-account*.json`, but still keep the key outside the repo and delete it right after step 8.2.

### 8.2 App, secrets, deploy

```bash
fly apps create $FLY_APP                      # the name must match fly.toml "app"
fly secrets set --app $FLY_APP --stage \
  FIREBASE_PROJECT_ID=$PROJECT \
  FIREBASE_SERVICE_ACCOUNT="$(base64 -w0 game-server-key.json)"
rm game-server-key.json
fly deploy --ha=false                         # builds packages/server/Dockerfile from the repo root
fly scale count 1 --yes                       # exactly ONE Machine (in-memory shards and matchmaker)
fly status
curl -fsS https://$FLY_APP.fly.dev/healthz    # {"ok":true}
```

- `fly.toml` sets `PORT=8080`, `HOST=0.0.0.0`, `NODE_ENV=production` and `APP_CHECK=enforce`. It also keeps the
  Machine running (`auto_stop_machines = "off"`, `min_machines_running = 1`), so WebSockets are never cut
  off for looking idle. The health check is `GET /healthz`.
- `FIREBASE_SERVICE_ACCOUNT` takes the JSON key raw or base64-encoded (`packages/server/src/config.ts`). The
  server refuses to start if the key's `project_id` is not `FIREBASE_PROJECT_ID`.
- The image runs the TypeScript through `tsx` as the `node` user. The CI workflow builds it and
  smoke-tests `/healthz`, but never pushes it.
- A deploy or restart drops every connection. Clients reconnect, and no state is lost (architecture §3.1).
  For a demo, deploy before you start, not during it.
- Logs: `fly logs`. The budget and abuse counters are at `GET /api/metrics`, which needs an ID token with the
  admin claim (step 10).

## 9. Client build environment

Create `packages/client/.env.production.local`. It is gitignored (`.env.*`), and Vite reads it for
`npm run build`. Use the web app config from step 1.4:

```dotenv
VITE_FIREBASE_PROJECT_ID=$PROJECT
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=$PROJECT.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=$BUCKET            # new projects: $PROJECT.firebasestorage.app
VITE_FIREBASE_APP_ID=…
VITE_SERVER_URL=https://$FLY_APP.fly.dev
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=…
# Never set VITE_APPCHECK_DEBUG_TOKEN or VITE_FIREBASE_EMULATORS here.
```

The web API key and the site key are public identifiers (App Check and the rules protect the data). They
stay out of git because they belong to one project.

## 10. Admin account and seeded content (optional for a first deploy)

The game works without seeded content: every opener, label, bark and notice is then generated for each
player on first use and cached in that player's IndexedDB (architecture §6.3). Seeding shared content first
saves cloud calls and makes the first conversation faster.

1. Sign in to the production site once with the operator's Google account. Then use a service account that
   can manage users (`roles/firebaseauth.admin`) and write Firestore and Storage (`roles/datastore.user`,
   `roles/storage.objectAdmin`). The seeding tools and the claim tool use the Admin SDK through
   `GOOGLE_APPLICATION_CREDENTIALS`:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/secure/place/seed-admin-key.json
   npm run admin:claim -- operator@example.com                          # dry run
   npm run admin:claim -- operator@example.com --write --project $PROJECT
   ```
   The operator then signs out and in again. The `admin: true` claim unlocks `GET /api/metrics`.
2. Seed per featured language (each tool prints its prompts with `--prompts`, validates a content file
   without `--write`, and publishes with `--write --project $PROJECT`):
   ```bash
   npm run seed:labels  -- --prompts ja            # world labels → cache/labels/{lang}
   npm run seed:labels  -- labels.ja.json --write --project $PROJECT
   npm run seed:barks   -- barks.ja.json --write --project $PROJECT     # Elder catch comments
   npm run seed:quests  -- notices.ja.A1.json --write --project $PROJECT
   npm run seed:ambient -- ambient.ja.json --write --project $PROJECT
   npm run seed:tts     -- tts-manifest.json --write --project $PROJECT --bucket $BUCKET
   ```
   The content files are not in the repo. Generate them from the printed prompts with `gemini-3.8-flash`
   and spot-check them before writing (each tool's header comment explains the format). There is no
   opener seeding tool yet: openers are generated per player (pending.md).
3. Delete or disable the admin key when you are done.

## 11. Deploy the client

```bash
npm ci
npm run build                                   # reads packages/client/.env.production.local
firebase hosting:channel:deploy preview --expires 7d --project prod   # optional dry run on a preview URL
firebase deploy --only hosting --project prod
```

- `firebase.json` → `hosting` serves `packages/client/dist` as an SPA (every path is rewritten to
  `/index.html`).
- **Cache**: HTML is `no-cache`. Vite's hashed files (`/assets/<name>-<hash8>.<ext>`) are cached for a
  year as `immutable`. The kits, characters and audio under `/assets/{kits,characters,audio}/` keep their
  names across builds, so they are cached for 1 h with `stale-while-revalidate` of 1 day. Their
  `*.json` manifests are `no-cache`.
- **Security headers** on every response: CSP, `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (Google sign-in uses a popup), `X-Content-Type-Options`, `Referrer-Policy`, HSTS and a
  `Permissions-Policy` that allows only the microphone (speech input).
- **CSP** (one line in `firebase.json`; what each source is for):

  | Directive | Sources | For |
  |---|---|---|
  | `script-src` | `'self' 'wasm-unsafe-eval'`, `https://apis.google.com`, `https://www.google.com/recaptcha/`, `https://www.gstatic.com/recaptcha/` | the bundle, the meshopt WebAssembly decoder for the kits, the Firebase Auth popup helper, reCAPTCHA Enterprise. No `'unsafe-inline'` or `'unsafe-eval'` (the Vite build sets zod's `jitless` in every chunk so zod never probes `new Function`) |
  | `style-src` | `'self' 'unsafe-inline'`, `https://fonts.googleapis.com` | the CSS, React/drei inline styles, the Noto font stylesheets (`shared/src/language/fonts.ts`) |
  | `font-src` | `'self' data:`, `https://fonts.gstatic.com` | Noto font files |
  | `connect-src` | `'self' data: blob:`, `https://*.googleapis.com`, `https://www.google.com/recaptcha/`, `https://$FLY_APP.fly.dev`, `wss://$FLY_APP.fly.dev` | Auth, Firestore, Storage, AI Logic, Remote Config, Installations, App Check; reCAPTCHA; the game server's HTTP API and WebSocket |
  | `frame-src` | `'self'`, `https://*.firebaseapp.com`, `https://www.google.com/recaptcha/`, `https://recaptcha.google.com/recaptcha/` | the Auth iframe on the auth domain, reCAPTCHA |
  | `img-src`, `media-src`, `worker-src` | `'self' data: blob:` (+ `https://www.gstatic.com` for images) | textures, voice clips played from blobs |
  | others | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` | hardening |

  The policy was loaded in headless Chrome against the production build (M38). The sign-in page, WebAssembly,
  Google Fonts, blob audio, the reCAPTCHA and `apis.google.com` scripts all loaded with no violations. It was
  **not** checked against a live project: if the console shows `Refused to connect/load …`, add that origin to
  the matching directive in `firebase.json` and in the table above.

## 12. Post-deploy checks (acceptance)

1. `curl https://$FLY_APP.fly.dev/healthz` returns `{"ok":true}`, and `fly status` shows exactly one Machine.
2. Open `https://$PROJECT.web.app` in desktop Chrome, sign in with Google and finish onboarding. The debug
   overlay shows `server: connected · NN ms` and `shard 1`.
3. **Two players**: sign in with a second Google account in another Chrome profile (not an incognito tab of the
   same profile). Both should be in `shard 1`, see each other and chat (docs/demo-script.md, step 5).
4. NPC conversation: talking to the Baker gets a cloud reply. Firebase console **AI Logic → Usage** shows the
   requests; **App Check → Metrics** shows them as verified.
5. On-device: in `chrome://on-device-internals`, the model is ready, and with `?ailog` the console prints
   `[ai] translateShort → on-device`.
6. Admin: `GET /api/metrics` with the operator's ID token shows non-zero turn counters.
7. After a day: **Firestore → Time-to-live** shows the `events.expiresAt` policy as serving.

## 13. Redeploy and rollback

| What | Redeploy | Roll back |
|---|---|---|
| Client | `npm run build && firebase deploy --only hosting --project prod` | Hosting console → **Release history** → **Rollback** |
| Game server | `fly deploy --ha=false` (drops connections; clients reconnect) | `fly releases --image`, then `fly deploy --image <previous image ref>` |
| Rules / indexes | `firebase deploy --only firestore,storage --project prod` | deploy the previous git revision of the file |
| Prompt template | new id in the console + Remote Config parameter | set the parameter back to the old id |
| Remote Config | `firebase deploy --only remoteconfig --project prod` | console → Remote Config → **Version history** |

## 14. Cost controls checklist (architecture §9)

- [ ] Blaze budget alert set (step 1.2).
- [ ] AI Logic per-user quota lowered to about 20 RPM (step 5.3).
- [ ] App Check enforced for AI Logic, Firestore and Storage (step 6.4); the server has `APP_CHECK=enforce`.
- [ ] One Fly Machine, `shared-cpu-1x`, 512 MB (`fly.toml`).
- [ ] Anonymous auth stays disabled (step 2.1).
- [ ] Moderation reports (`reports/*`) are reviewed in the Firestore console. There is no moderator tool yet
  (TODO(backlog) in `TownRoom.ts`).
