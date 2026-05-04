/**
 * NPC dialogue thread persistence + recall.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { dialogueTurns, sessions } from "@/lib/db/schema";
import {
  appendExchange,
  fillReply,
  listSessionDialoguePartners,
  recentExchanges,
  UTTERANCE_MAX_LEN,
} from "@/lib/dialogue/thread";
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
    "TRUNCATE dialogue_turns, sessions, users RESTART IDENTITY CASCADE",
  );
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("appendExchange", () => {
  test("inserts a row and returns id", async () => {
    const r = await appendExchange(db, {
      sessionId,
      npcId: "halrik-aabbccdd",
      npcTemplateId: "master-halrik",
      utterance: "morning",
      turn: 3,
    });
    expect(r?.id).toBeDefined();
    const rows = await db.select().from(dialogueTurns);
    expect(rows.length).toBe(1);
    expect(rows[0].playerUtterance).toBe("morning");
    expect(rows[0].npcReply).toBe("");
  });

  test("returns null for blank utterance", async () => {
    const r = await appendExchange(db, {
      sessionId,
      npcId: "x",
      npcTemplateId: "x",
      utterance: "   ",
      turn: 1,
    });
    expect(r).toBeNull();
  });

  test(`caps utterance at ${UTTERANCE_MAX_LEN} chars`, async () => {
    const long = "a".repeat(UTTERANCE_MAX_LEN + 50);
    const r = await appendExchange(db, {
      sessionId,
      npcId: "x",
      npcTemplateId: "x",
      utterance: long,
      turn: 1,
    });
    expect(r).not.toBeNull();
    const [row] = await db.select().from(dialogueTurns);
    expect(row.playerUtterance.length).toBe(UTTERANCE_MAX_LEN);
  });
});

describe("fillReply + recentExchanges", () => {
  test("fills the reply, returns chronological order", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await appendExchange(db, {
        sessionId,
        npcId: "n1",
        npcTemplateId: "n1",
        utterance: `q${i}`,
        turn: i + 1,
      });
      if (r) ids.push(r.id);
    }
    await fillReply(db, ids[2], "answer-2");
    const out = await recentExchanges(db, {
      sessionId,
      npcId: "n1",
      limit: 5,
    });
    expect(out.length).toBe(5);
    // Chronological: oldest first.
    expect(out[0].playerUtterance).toBe("q0");
    expect(out[4].playerUtterance).toBe("q4");
    expect(out[2].npcReply).toBe("answer-2");
  });

  test("filters by npcId", async () => {
    await appendExchange(db, {
      sessionId,
      npcId: "n1",
      npcTemplateId: "n1",
      utterance: "x",
      turn: 1,
    });
    await appendExchange(db, {
      sessionId,
      npcId: "n2",
      npcTemplateId: "n2",
      utterance: "y",
      turn: 2,
    });
    const out = await recentExchanges(db, {
      sessionId,
      npcId: "n1",
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0].playerUtterance).toBe("x");
  });
});

describe("listSessionDialoguePartners", () => {
  test("returns distinct npcIds", async () => {
    await appendExchange(db, {
      sessionId,
      npcId: "n1",
      npcTemplateId: "n1",
      utterance: "hi",
      turn: 1,
    });
    await appendExchange(db, {
      sessionId,
      npcId: "n1",
      npcTemplateId: "n1",
      utterance: "again",
      turn: 2,
    });
    await appendExchange(db, {
      sessionId,
      npcId: "n2",
      npcTemplateId: "n2",
      utterance: "hi",
      turn: 3,
    });
    const partners = await listSessionDialoguePartners(db, sessionId);
    expect(new Set(partners)).toEqual(new Set(["n1", "n2"]));
  });
});

void eq;
