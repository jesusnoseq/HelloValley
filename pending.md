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
