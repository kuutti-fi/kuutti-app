# syntax=docker/dockerfile:1
# Built for linux/arm64 in CI (t4g is arm64). Two stages: build with pnpm, run with node only.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/schema/package.json packages/schema/
RUN pnpm install --frozen-lockfile --filter @kuutti/api...
COPY tsconfig.base.json ./
COPY packages/schema packages/schema
COPY apps/api apps/api
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
RUN pnpm --filter @kuutti/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILT_AT=unknown
ENV APP_VERSION=$APP_VERSION GIT_COMMIT=$GIT_COMMIT BUILT_AT=$BUILT_AT
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
