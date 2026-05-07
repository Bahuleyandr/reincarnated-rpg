import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

// Migrations need a DIRECT (unpooled) URL because PgBouncer in
// transaction-pool mode breaks DDL — DDL relies on session-scoped
// state (locks, search_path) that the pooler doesn't keep stable
// across transactions. DATABASE_URL_DIRECT is the dedicated env
// var for this; falls back to DATABASE_URL in dev where there's
// no pooler.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL (or DATABASE_URL_DIRECT) is not set");
  process.exit(1);
}
if (process.env.DATABASE_URL_DIRECT) {
  console.log("[migrate] using DATABASE_URL_DIRECT (unpooled)");
} else if (url.includes("-pooler.") || url.includes("pgbouncer")) {
  console.warn(
    "[migrate] WARNING: DATABASE_URL appears pooled but DATABASE_URL_DIRECT is unset. DDL may fail.",
  );
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const migrationsDir = join(process.cwd(), "src", "lib", "db", "migrations");
const journalPath = join(migrationsDir, "meta", "_journal.json");

function listMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
}

function listJournalFiles() {
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (!Array.isArray(journal.entries)) return [];
  return journal.entries
    .slice()
    .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
    .map((entry) => `${entry.tag}.sql`);
}

async function tableExists(schema, table) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = ${schema}
      AND table_name = ${table}
    LIMIT 1
  `;
  return rows.length > 0;
}

try {
  await sql`
    CREATE TABLE IF NOT EXISTS runtime_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = listMigrationFiles();
  const runtimeRows = await sql`SELECT count(*)::int AS count FROM runtime_migrations`;
  if (
    runtimeRows[0]?.count === 0 &&
    (await tableExists("drizzle", "__drizzle_migrations"))
  ) {
    const drizzleRows = await sql`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    const drizzleCount = drizzleRows[0]?.count ?? 0;
    if (drizzleCount > 0) {
      const journalFiles = listJournalFiles();
      const orderedFiles = journalFiles.length > 0 ? journalFiles : files;
      const existing = orderedFiles
        .filter((name) => files.includes(name))
        .slice(0, drizzleCount);

      await sql.begin(async (tx) => {
        for (const name of existing) {
          await tx`
            INSERT INTO runtime_migrations (name)
            VALUES (${name})
            ON CONFLICT (name) DO NOTHING
          `;
        }
      });
      console.log(`[migrate] bootstrapped ${existing.length} migrations from drizzle.__drizzle_migrations`);
    }
  }

  for (const name of files) {
    const existing = await sql`
      SELECT name FROM runtime_migrations WHERE name = ${name}
    `;
    if (existing.length > 0) continue;

    const raw = readFileSync(join(migrationsDir, name), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO runtime_migrations (name) VALUES (${name})
      `;
    });
    console.log(`[migrate] applied ${name}`);
  }

  console.log("[migrate] complete");
} finally {
  await sql.end({ timeout: 5 });
}
