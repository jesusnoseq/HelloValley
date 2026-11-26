# syntax=docker/dockerfile:1
# HelloValley game server (Colyseus + Express, build plan M38, architecture §3.1): one Fly.io Machine.
# Build from the repository root, because the server imports packages/shared:
#   docker build -f packages/server/Dockerfile -t hellovalley-server .
# The server runs its TypeScript through tsx (a runtime dependency), as in `npm start`.

ARG NODE_VERSION=26.13.0

# --- deps: production dependencies of the server workspace only, from the lockfile -------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# docs/dependency-security.md: npm 11.16+, lockfile installs, no install scripts (.npmrc).
RUN npm install --global npm@11.16.0 --ignore-scripts
COPY package.json package-lock.json .npmrc ./
# npm ci needs every workspace manifest named in the lockfile, even the ones it does not install.
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --workspace @hellovalley/server --ignore-scripts \
  && npm cache clean --force

# --- runtime: Node, node_modules and the TypeScript sources; runs as the unprivileged `node` user -
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.base.json ./
COPY --chown=node:node packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY --chown=node:node packages/shared/src packages/shared/src
COPY --chown=node:node packages/server/package.json packages/server/tsconfig.json packages/server/
COPY --chown=node:node packages/server/src packages/server/src
USER node
WORKDIR /app/packages/server
EXPOSE 8080
# Liveness for plain Docker; Fly uses the [[http_service.checks]] in fly.toml.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
