# syntax=docker/dockerfile:1
# Built for linux/arm64 in CI (t4g is arm64). Two stages: build with pnpm, run with node only.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/schema/package.json packages/schema/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
RUN pnpm install --frozen-lockfile --filter @kuutti/api...
COPY tsconfig.base.json ./
COPY packages/schema packages/schema
COPY packages/db packages/db
COPY packages/i18n packages/i18n
COPY apps/api apps/api
RUN pnpm --filter @kuutti/api build

FROM node:22-bookworm-slim AS runtime
# One region (TD-4); the SDK never reads it from instance metadata. The RDS
# bundle (apps/api/certs, sha256 in its README) lets pg verify the database.
ENV NODE_ENV=production PORT=3000 MIGRATIONS_DIR=/app/drizzle \
    AWS_REGION=eu-central-1 DB_SSL_ROOT_CERT=/app/certs/rds-eu-central-1-bundle.pem
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILT_AT=unknown
ENV APP_VERSION=$APP_VERSION GIT_COMMIT=$GIT_COMMIT BUILT_AT=$BUILT_AT
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./drizzle
COPY --chown=node:node apps/api/certs ./certs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
