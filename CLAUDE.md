# HelloValley

Entry for the Firebase Hybrid AI hackathon (https://firebasehybridaihackathon.devpost.com/).

## Architecture

- npm workspaces under `packages/`: `client` (React 19 + Vite, Firebase web SDK) depends on `shared` (headless TypeScript, no DOM). Stack adapted from the navecitas project.

## Commands

`npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run deps:check`.

Use `npm ci` for installs. Dependency versions are exact, `.npmrc` blocks install scripts and enforces a 7-day release-age policy. Run `npm run deps:check` when changing manifests or the lockfile; follow `docs/dependency-security.md` for updates.
