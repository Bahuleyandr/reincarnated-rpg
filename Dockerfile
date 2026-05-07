# Multi-stage build for Next.js 16 + Drizzle + postgres-js on Fly.io.
#
# Stage 1: install deps (cacheable on package-lock.json changes only).
# Stage 2: build the Next standalone output.
# Stage 3: minimal runtime image (just node + the standalone bundle +
#          public/ + content/ since the app reads JSON from disk at runtime).

ARG NODE_VERSION=22.22.2
ARG GIT_COMMIT_SHA=unknown

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts has serverExternalPackages — voyageai + Anthropic SDK
# stay external rather than bundled into the standalone server.
ARG GIT_COMMIT_SHA=unknown
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
# Next collects route metadata during `next build`, which evaluates
# server modules that validate env. These are build-only placeholders;
# the runtime container gets real values from k8s secrets.
ENV DATABASE_URL=postgres://reincarnated:reincarnated@127.0.0.1:5432/reincarnated
ENV SESSION_SECRET=build-time-placeholder-session-secret
ENV AI_PROVIDER=openai-compatible
ENV NARRATOR=template
RUN npx next build --turbopack=false 2>/dev/null || npm run build

FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone Next output bundles its own server.js + minimal node_modules.
# We additionally need:
#   - public/        — static assets
#   - .next/static/  — client chunks
#   - content/       — form/location/beat JSONs read at runtime
#   - src/lib/db/migrations/ — applied with production-safe Node scripts
#     copied below (no dev dependencies required in the runtime image)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/content ./content
COPY --from=builder /app/src/lib/db/migrations ./src/lib/db/migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/scripts/migrate-prod.mjs ./scripts/migrate-prod.mjs
COPY --from=builder /app/scripts/seed-runtime.mjs ./scripts/seed-runtime.mjs
COPY --from=builder /app/scripts/smoke.mjs ./scripts/smoke.mjs

# Run as non-root.
RUN groupadd -r app && useradd -r -g app -s /sbin/nologin app
USER app

EXPOSE 3000
CMD ["node", "server.js"]
