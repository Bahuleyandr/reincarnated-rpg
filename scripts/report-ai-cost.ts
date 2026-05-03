import "./load-env";

/**
 * Aggregates ai_calls into a usage report. Run via:
 *   npm run report:ai-cost           # last 7 days
 *   npm run report:ai-cost -- --days 30
 *   npm run report:ai-cost -- --session <session_id>
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  estimateCostUsd,
  MODEL_RATES,
} from "../src/lib/util/ai-telemetry";

interface Row {
  call_type: string;
  model: string;
  count: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_create_tokens: string;
  total_duration_ms: string;
  errors: string;
}

async function main() {
  const args = process.argv.slice(2);
  let days = 7;
  let sessionId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days") days = parseInt(args[++i] ?? "7", 10);
    if (args[i] === "--session") sessionId = args[++i] ?? null;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const window = sessionId
    ? sql`session_id = ${sessionId}`
    : sql`created_at >= ${since.toISOString()}`;

  const rows = (await db.execute(sql`
    SELECT call_type, model,
           COUNT(*)::text AS count,
           SUM(input_tokens)::text AS input_tokens,
           SUM(output_tokens)::text AS output_tokens,
           SUM(cache_read_tokens)::text AS cache_read_tokens,
           SUM(cache_create_tokens)::text AS cache_create_tokens,
           SUM(duration_ms)::text AS total_duration_ms,
           SUM(CASE WHEN success='false' THEN 1 ELSE 0 END)::text AS errors
    FROM ai_calls
    WHERE ${window}
    GROUP BY call_type, model
    ORDER BY model, call_type
  `)) as unknown as Row[];

  if (rows.length === 0) {
    console.log(
      sessionId
        ? `[ai-cost] no rows for session ${sessionId}`
        : `[ai-cost] no rows in last ${days} days`,
    );
    await client.end();
    return;
  }

  console.log(
    sessionId
      ? `[ai-cost] session ${sessionId}\n`
      : `[ai-cost] last ${days} days (since ${since.toISOString()})\n`,
  );
  console.log(
    "model".padEnd(20) +
      "callType".padEnd(14) +
      "count".padStart(8) +
      "in".padStart(10) +
      "cacheR".padStart(10) +
      "cacheC".padStart(10) +
      "out".padStart(10) +
      "errors".padStart(8) +
      "  cost(USD)",
  );
  let totalCost = 0;
  for (const r of rows) {
    const inputTokens = Number(r.input_tokens);
    const outputTokens = Number(r.output_tokens);
    const cacheRead = Number(r.cache_read_tokens);
    const cacheCreate = Number(r.cache_create_tokens);
    const cost = estimateCostUsd({
      model: r.model,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
      cacheCreateTokens: cacheCreate,
    });
    totalCost += cost;
    const rate = MODEL_RATES[r.model] ? "" : "?";
    console.log(
      r.model.padEnd(20) +
        r.call_type.padEnd(14) +
        r.count.padStart(8) +
        r.input_tokens.padStart(10) +
        r.cache_read_tokens.padStart(10) +
        r.cache_create_tokens.padStart(10) +
        r.output_tokens.padStart(10) +
        r.errors.padStart(8) +
        `  $${cost.toFixed(4)}${rate}`,
    );
  }
  console.log(`\ntotal: $${totalCost.toFixed(4)}`);
  if (rows.some((r) => !MODEL_RATES[r.model])) {
    console.log(
      "(? = model not in MODEL_RATES; cost shown as $0. Update src/lib/util/ai-telemetry.ts.)",
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error("[ai-cost] error:", err);
  process.exit(1);
});
