import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import {
  createMemory,
  mockEmbedding,
  retrieveMemories,
} from "@/lib/memory/episodic";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let sessionId: string;

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
  await client.unsafe(
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("mockEmbedding", () => {
  test("returns 512 dimensions", () => {
    expect(mockEmbedding("hello").length).toBe(512);
  });

  test("is deterministic for the same input", () => {
    expect(mockEmbedding("foo")).toEqual(mockEmbedding("foo"));
  });

  test("differs for different inputs", () => {
    const a = mockEmbedding("the rat panicked");
    const b = mockEmbedding("the cavern dripped");
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same += 1;
    // Should be < 5% identical components on a 512-dim hash-based vector.
    expect(same).toBeLessThan(25);
  });

  test("is unit-magnitude", () => {
    const v = mockEmbedding("test");
    let mag = 0;
    for (const x of v) mag += x * x;
    expect(Math.sqrt(mag)).toBeCloseTo(1, 5);
  });
});

describe("createMemory + retrieveMemories", () => {
  test("createMemory returns a UUIDv7 id", async () => {
    const id = await createMemory(db, {
      sessionId,
      summary: "First taste of iron in the dark",
      eventSeqRange: [1, 4],
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("retrieves at least one memory when memories exist", async () => {
    // Mock embedding is hash-based (no semantic similarity). We assert
    // plumbing — the SQL pgvector query returns something — not ranking.
    // The Voyage path will rank semantically when wired.
    await createMemory(db, {
      sessionId,
      summary: "The rat panicked across your boundary and fled.",
      eventSeqRange: [1, 4],
    });
    await createMemory(db, {
      sessionId,
      summary: "The pool tastes of rust and oil.",
      eventSeqRange: [5, 8],
    });
    const top = await retrieveMemories(db, sessionId, "the rat is back");
    expect(top.length).toBeGreaterThan(0);
    expect(top[0].summary).toBeTruthy();
  });

  test("retrieves an exact-match self-similar memory at the top", async () => {
    // mockEmbedding is deterministic — embedding(X) === embedding(X) →
    // cosine similarity 1.0. So an exact-text query reliably ranks
    // itself first.
    const target = "The rat panicked across your boundary and fled.";
    await createMemory(db, {
      sessionId,
      summary: "Generic ambient observation about the cavern",
      eventSeqRange: [1, 2],
    });
    await createMemory(db, {
      sessionId,
      summary: target,
      eventSeqRange: [3, 4],
    });
    const top = await retrieveMemories(db, sessionId, target, { k: 1 });
    expect(top[0].summary).toBe(target);
  });

  test("respects k", async () => {
    for (let i = 0; i < 6; i++) {
      await createMemory(db, {
        sessionId,
        summary: `Memory number ${i}`,
        eventSeqRange: [i, i + 1],
      });
    }
    const r = await retrieveMemories(db, sessionId, "memory query", { k: 2 });
    expect(r.length).toBeLessThanOrEqual(2);
  });

  test("only returns memories for the queried session", async () => {
    const other = uuidv7();
    await db.insert(sessions).values({
      id: other,
      cookieHmac: `t-${other}`,
      formId: "lesser-slime",
    });
    await createMemory(db, {
      sessionId: other,
      summary: "Belongs to the other session",
      eventSeqRange: [1, 2],
    });
    await createMemory(db, {
      sessionId,
      summary: "Belongs to this session",
      eventSeqRange: [1, 2],
    });

    const r = await retrieveMemories(db, sessionId, "session");
    expect(r).toHaveLength(1);
    expect(r[0].summary).toMatch(/this session/);
  });

  test("entitySlug overlap boosts matching memories", async () => {
    await createMemory(db, {
      sessionId,
      summary: "Generic ambient observation about the cavern",
      eventSeqRange: [1, 2],
    });
    await createMemory(db, {
      sessionId,
      summary: "tunnel-rat fled, leaving a streak of fur",
      eventSeqRange: [3, 4],
    });

    const withBoost = await retrieveMemories(db, sessionId, "what was here", {
      entitySlugs: ["tunnel-rat"],
      k: 2,
    });
    expect(withBoost[0].summary).toMatch(/rat/);
  });
});
