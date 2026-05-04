import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const migrationsDir = join(process.cwd(), "src", "lib", "db", "migrations");

try {
  await sql`
    CREATE TABLE IF NOT EXISTS runtime_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

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
