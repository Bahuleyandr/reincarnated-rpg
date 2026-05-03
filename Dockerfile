# Multi-stage build for Next.js 16 + Drizzle + postgres-js on Fly.io.
#
# Stage 1: install deps (cacheable on package-lock.json changes only).
# Stage 2: build the Next standalone output.
# Stage 3: minimal runtime image (just node + the standalone bundle +
#          public/ + content/ since the app reads JSON from disk at runtime).

ARG NODE_VERSION=22.22.2

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
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build --turbopack=false 2>/dev/null || npm run build

FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone Next output bundles its own server.js + minimal node_modules.
# We additionally need:
#   - public/        — static assets
#   - .next/static/  — client chunks
#   - content/       — form/location/beat JSONs read at runtime
#   - src/lib/db/migrations/ — applied via drizzle-kit on boot or via a
#     separate one-off `fly ssh console -C "npm run db:migrate"`
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/content ./content
COPY --from=builder /app/src/lib/db/migrations ./src/lib/db/migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/scripts/load-env.ts ./scripts/load-env.ts

# Run as non-root.
RUN groupadd -r app && useradd -r -g app -s /sbin/nologin app
USER app

EXPOSE 3000
CMD ["node", "server.js"]
