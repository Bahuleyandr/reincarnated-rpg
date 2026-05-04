/**
 * Singleton Drizzle client. Hot-reload-safe — under Next dev a global
 * pin keeps us from opening a new pool per HMR.
 *
 * **Pool sizing**: env DATABASE_POOL_MAX (default 10). Neon's free
 * tier caps total connections at 100; 10 per app instance leaves
 * comfortable headroom for migrations + admin tools + hot-reload
 * churn. In production with PgBouncer, the pool effectively
 * multiplexes far more concurrent client requests over these 10
 * pooled handles.
 *
 * **Two URLs in env**:
 * - `DATABASE_URL` — pooled. Used by the app. Should point at
 *   Neon's pgbouncer pooler in production
 *   (`-pooler.` host + `?pgbouncer=true`).
 * - `DATABASE_URL_DIRECT` — unpooled, optional. Used by migrations
 *   and DDL via scripts/migrate-prod.mjs because PgBouncer in
 *   transaction-pool mode breaks DDL. Falls back to DATABASE_URL
 *   in dev (where there's no pooler so the two are identical).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../util/env";

declare global {
  var __reincarnatedPg: ReturnType<typeof postgres> | undefined;
}

function getClient() {
  if (!globalThis.__reincarnatedPg) {
    const e = env();
    globalThis.__reincarnatedPg = postgres(e.DATABASE_URL, {
      max: e.DATABASE_POOL_MAX,
      idle_timeout: 30,
      max_lifetime: 60 * 30,
      onnotice: () => {},
    });
  }
  return globalThis.__reincarnatedPg;
}

// Match the actual return shape of drizzle(postgres-client) in this
// version: schema generic Record<string, unknown> plus the $client
// escape hatch property.
import type { Sql } from "postgres";

export type Db = PostgresJsDatabase<Record<string, unknown>> & {
  $client: Sql<Record<string, never>>;
};

export const db: Db = drizzle(getClient()) as Db;
