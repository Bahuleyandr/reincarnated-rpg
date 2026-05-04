import "./load-env";

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Start the test database with npm run dev:up or set DATABASE_URL to a reachable Postgres+pgvector instance.",
    );
  }

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 3,
    onnotice: () => {},
  });
  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[test:db] ${message}`);
  console.error("[test:db] Run npm run dev:up, or point DATABASE_URL at the CI Postgres service.");
  process.exit(1);
});
