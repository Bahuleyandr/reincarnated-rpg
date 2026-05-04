/**
 * Phase 7 Day 40-41: provider_health round-trip + transition rules.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  adminSetStatus,
  getAllHealth,
  getHealth,
  recordFailure,
  recordSuccess,
} from "@/lib/ai/health";

let client: postgres.Sql;
let db: Db;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client) as unknown as Db;
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  // Reset all rows to healthy before each test.
  await client.unsafe(
    "UPDATE provider_health SET status='healthy', consecutive_failures=0, last_success_at=NULL, last_failure_at=NULL",
  );
});

describe("recordSuccess", () => {
  test("flips degraded → healthy and resets counter", async () => {
    await recordFailure(db, "anthropic");
    await recordFailure(db, "anthropic");
    await recordFailure(db, "anthropic");
    let h = await getHealth(db, "anthropic");
    expect(h?.status === "degraded" || h?.status === "healthy").toBe(true);
    await recordSuccess(db, "anthropic");
    h = await getHealth(db, "anthropic");
    expect(h?.status).toBe("healthy");
    expect(h?.consecutiveFailures).toBe(0);
  });

  test("does NOT override manual_down", async () => {
    await adminSetStatus(db, "bedrock", "manual_down");
    await recordSuccess(db, "bedrock");
    const h = await getHealth(db, "bedrock");
    expect(h?.status).toBe("manual_down");
  });
});

describe("recordFailure transitions", () => {
  test("3 failures within 60s → degraded", async () => {
    await recordFailure(db, "anthropic");
    await recordFailure(db, "anthropic");
    const r = await recordFailure(db, "anthropic");
    expect(r.status).toBe("degraded");
    expect(r.consecutiveFailures).toBe(3);
  });

  test("10 failures → down", async () => {
    let last;
    for (let i = 0; i < 10; i++) {
      last = await recordFailure(db, "vertex");
    }
    expect(last?.status).toBe("down");
  });

  test("manual_down sticky after recordFailure", async () => {
    await adminSetStatus(db, "anthropic", "manual_down");
    const r = await recordFailure(db, "anthropic");
    expect(r.status).toBe("manual_down");
  });
});

describe("getAllHealth", () => {
  test("returns 3 seeded providers", async () => {
    const rows = await getAllHealth(db);
    const ids = new Set(rows.map((r) => r.providerId));
    expect(ids.has("anthropic")).toBe(true);
    expect(ids.has("bedrock")).toBe(true);
    expect(ids.has("vertex")).toBe(true);
  });
});
