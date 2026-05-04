/**
 * Singleton Drizzle client. Hot-reload-safe — under Next dev a global
 * pin keeps us from opening a new pool per HMR.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../util/env";

declare global {
  var __reincarnatedPg: ReturnType<typeof postgres> | undefined;
}

function getClient() {
  if (!globalThis.__reincarnatedPg) {
    globalThis.__reincarnatedPg = postgres(env().DATABASE_URL, {
      max: 4,
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
