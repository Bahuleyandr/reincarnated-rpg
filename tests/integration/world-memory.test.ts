/**
 * World-memory integration test.
 *
 * Drives a single ended-session through persistRunToWorld, then
 * recallWorld, asserting that NPCs and run-summary memories survive
 * across the simulated boundary.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  campaigns,
  sessions,
  users,
  worldMemories,
  worldNpcs,
} from "@/lib/db/schema";
import { appendEvents } from "@/lib/game/events";
import { persistRunToWorld, recallWorld } from "@/lib/memory/world";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
let sessionId: string;
let campaignId: string;

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
    "TRUNCATE world_memories, world_npcs, memories, entities, projections, events, sessions, campaigns, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    email: `t${Date.now()}@x.com`,
    username: `t${Date.now()}`,
    passwordHash: "x",
  });
  campaignId = uuidv7();
  await db.insert(campaigns).values({
    id: campaignId,
    userId,
    title: "test run",
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
    campaignId,
  });
});

describe("persistRunToWorld", () => {
  test("no-op when no session.ended event present", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 42 },
      { kind: "turn.begun", turn: 1, input: "hi", inputSanitized: "hi" },
    ]);
    const r = await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    expect(r).toBeNull();
    const npcs = await db.select().from(worldNpcs);
    const mems = await db.select().from(worldMemories);
    expect(npcs).toHaveLength(0);
    expect(mems).toHaveLength(0);
  });

  test("rolls up NPCs and writes a run summary on session.ended", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 42 },
      { kind: "turn.begun", turn: 1, input: "wait", inputSanitized: "wait" },
      {
        kind: "npc.introduced",
        npcId: "berra-the-smith",
        data: { name: "Berra the Smith", attitude: 0, relationship: 0 },
      },
      {
        kind: "relationship.updated",
        npcId: "berra-the-smith",
        delta: 2,
        reason: "saved her",
      },
      {
        kind: "narration.emitted",
        text: "She nods her thanks. The night settles, briefly safe.",
        toolCallsApplied: 1,
      },
      { kind: "session.ended", reason: "win" },
    ]);
    const r = await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    expect(r).not.toBeNull();
    expect(r?.npcsUpserted).toBe(1);
    expect(r?.memoriesWritten).toBe(1);

    const npcs = await db.select().from(worldNpcs);
    expect(npcs).toHaveLength(1);
    expect(npcs[0].slug).toBe("berra-the-smith");
    expect(npcs[0].name).toBe("Berra the Smith");
    expect(npcs[0].relationshipScore).toBe(2);
    expect(npcs[0].timesHelped).toBe(1);

    const mems = await db.select().from(worldMemories);
    expect(mems).toHaveLength(1);
    expect(mems[0].tags).toContain("outcome:win");
    expect(mems[0].tags).toContain("met:berra-the-smith");
    expect(mems[0].salience).toBeGreaterThan(0.9); // win bump
    expect(mems[0].summary).toMatch(/lesser slime/);
    expect(mems[0].summary).toMatch(/win/);
  });

  test("idempotent — calling twice does not double-insert", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "death" },
    ]);
    await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    const mems = await db.select().from(worldMemories);
    expect(mems).toHaveLength(1);
  });

  test("subsequent run with same NPC bumps timesMet + accumulates relationship", async () => {
    // First run.
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      {
        kind: "npc.introduced",
        npcId: "berra-the-smith",
        data: { name: "Berra the Smith", attitude: 0, relationship: 0 },
      },
      { kind: "relationship.updated", npcId: "berra-the-smith", delta: 1, reason: "" },
      { kind: "session.ended", reason: "cap" },
    ]);
    await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });

    // Second run: new session + campaign, same user, same NPC.
    const c2 = uuidv7();
    await db.insert(campaigns).values({
      id: c2,
      userId,
      title: "run 2",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    const s2 = uuidv7();
    await db.insert(sessions).values({
      id: s2,
      cookieHmac: `t-${s2}`,
      formId: "lesser-slime",
      campaignId: c2,
    });
    await appendEvents(db, s2, [
      { kind: "session.started", formId: "lesser-slime", seed: 2 },
      {
        kind: "npc.introduced",
        npcId: "berra-the-smith",
        data: { name: "Berra the Smith", attitude: 0, relationship: 0 },
      },
      { kind: "relationship.updated", npcId: "berra-the-smith", delta: 2, reason: "" },
      { kind: "session.ended", reason: "win" },
    ]);
    await persistRunToWorld(db, {
      userId,
      sessionId: s2,
      campaignId: c2,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });

    const npcs = await db.select().from(worldNpcs);
    expect(npcs).toHaveLength(1);
    expect(npcs[0].timesMet).toBe(2);
    expect(npcs[0].relationshipScore).toBe(3); // 1 + 2
    expect(npcs[0].timesHelped).toBe(2);
  });
});

describe("recallWorld", () => {
  test("returns NPC + memory for a returning player", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      {
        kind: "npc.introduced",
        npcId: "berra-the-smith",
        data: { name: "Berra the Smith", attitude: 0, relationship: 0 },
      },
      { kind: "relationship.updated", npcId: "berra-the-smith", delta: 1, reason: "" },
      {
        kind: "narration.emitted",
        text: "The forge cools. Berra mutters thanks.",
        toolCallsApplied: 0,
      },
      { kind: "session.ended", reason: "win" },
    ]);
    await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });

    const recall = await recallWorld(db, userId, "the smith with the forge");
    expect(recall.length).toBeGreaterThan(0);
    // Should include something about Berra.
    const joined = recall.map((m) => m.summary).join(" | ");
    expect(joined).toMatch(/Berra/);
  });

  test("empty for a fresh user", async () => {
    const freshUser = uuidv7();
    await db.insert(users).values({
      id: freshUser,
      email: `f${Date.now()}@x.com`,
      username: `f${Date.now()}`,
      passwordHash: "x",
    });
    const r = await recallWorld(db, freshUser, "anything");
    expect(r).toHaveLength(0);
  });
});
