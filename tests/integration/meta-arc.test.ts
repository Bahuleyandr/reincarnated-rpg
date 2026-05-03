/**
 * Long Wyrm meta-arc integration: contribution accounting, phase
 * advancement, and idempotency under the persistRunToWorld path.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  campaigns,
  metaArcs,
  metaContributions,
  sessions,
  users,
} from "@/lib/db/schema";
import { appendEvents } from "@/lib/game/events";
import {
  ensureLongWyrmExists,
  getCurrentArc,
  LONG_WYRM_ID,
  PHASES,
  phaseForProgress,
  planContribution,
  recordContribution,
} from "@/lib/meta/long-wyrm";
import { persistRunToWorld } from "@/lib/memory/world";
import { uuidv7 } from "@/lib/util/uuidv7";
import type { Event } from "@/lib/game/types";

let client: postgres.Sql;
let db: Db;
let userId: string;

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
    "TRUNCATE meta_contributions, meta_arcs, world_memories, world_npcs, memories, entities, projections, events, sessions, campaigns, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    email: `t${Date.now()}@x.com`,
    username: `t${Date.now()}`,
    passwordHash: "x",
  });
});

describe("phaseForProgress", () => {
  it("returns the right phase for boundary values", () => {
    expect(phaseForProgress(0).phase).toBe("stirring");
    expect(phaseForProgress(99).phase).toBe("stirring");
    expect(phaseForProgress(100).phase).toBe("rising");
    expect(phaseForProgress(299).phase).toBe("rising");
    expect(phaseForProgress(300).phase).toBe("abroad");
    expect(phaseForProgress(599).phase).toBe("abroad");
    expect(phaseForProgress(600).phase).toBe("feasting");
    expect(phaseForProgress(899).phase).toBe("feasting");
    expect(phaseForProgress(900).phase).toBe("broken");
  });

  it("clamps for out-of-range values", () => {
    expect(phaseForProgress(-5).phase).toBe("stirring");
    expect(phaseForProgress(99999).phase).toBe("broken");
  });

  it("listing PHASES exposes 5 ordered entries", () => {
    expect(PHASES).toHaveLength(5);
    expect(PHASES.map((p) => p.phase)).toEqual([
      "stirring",
      "rising",
      "abroad",
      "feasting",
      "broken",
    ]);
  });
});

describe("planContribution", () => {
  it("returns null for runs with no session.ended", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "wait", inputSanitized: "wait" },
    ];
    expect(planContribution(events)).toBeNull();
  });

  it("death runs feed +5", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "death" },
    ];
    const p = planContribution(events)!;
    expect(p.delta).toBe(5);
    expect(p.reason).toContain("outcome:death");
  });

  it("win runs starve -3", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "win" },
    ];
    const p = planContribution(events)!;
    expect(p.delta).toBe(-3);
  });

  it("absorb-heavy + death stacks", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "absorbed", itemId: "a", into: "essence" },
      { kind: "absorbed", itemId: "b", into: "essence" },
      { kind: "absorbed", itemId: "c", into: "essence" },
      { kind: "session.ended", reason: "death" },
    ];
    const p = planContribution(events)!;
    expect(p.delta).toBe(6); // 5 (death) + 1 (absorb-heavy)
    expect(p.reason).toContain("absorb-heavy");
  });

  it("wyrm_attuned subtracts; wyrm_marked adds", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "form_state.changed", field: "wyrm_attuned", delta: 1 },
      { kind: "form_state.changed", field: "wyrm_attuned", delta: 1 },
      { kind: "form_state.changed", field: "wyrm_marked", delta: 1 },
      { kind: "session.ended", reason: "win" },
    ];
    const p = planContribution(events)!;
    // -3 (win) + 1 (mark) - 2 (attuned×2) = -4
    expect(p.delta).toBe(-4);
  });
});

describe("recordContribution", () => {
  it("seeds the singleton and records a feed", async () => {
    await ensureLongWyrmExists(db);
    const cur = await getCurrentArc(db);
    expect(cur?.progress).toBe(0);
    expect(cur?.phase).toBe("stirring");

    const sessionId = uuidv7();
    await db.insert(sessions).values({
      id: sessionId,
      cookieHmac: `t-${sessionId}`,
      formId: "lesser-slime",
    });
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "death" },
    ];
    const after = await recordContribution(db, events, {
      sessionId,
      userId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    expect(after?.progress).toBe(5);
    expect(after?.totalFeeds).toBe(1);
    expect(after?.contributorCount).toBe(1);

    const contribs = await db.select().from(metaContributions);
    expect(contribs).toHaveLength(1);
    expect(contribs[0].delta).toBe(5);
  });

  it("idempotent per sessionId — second call does not double-bump", async () => {
    const sessionId = uuidv7();
    await db.insert(sessions).values({
      id: sessionId,
      cookieHmac: `t-${sessionId}`,
      formId: "lesser-slime",
    });
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "death" },
    ];
    await recordContribution(db, events, { sessionId, userId });
    await recordContribution(db, events, { sessionId, userId });
    const arc = await getCurrentArc(db);
    expect(arc?.progress).toBe(5);
    const contribs = await db.select().from(metaContributions);
    expect(contribs).toHaveLength(1);
  });

  it("advances phase when threshold crossed", async () => {
    // Drive 21 death contributions (5 each) → 105 → "rising"
    for (let i = 0; i < 21; i++) {
      const sessionId = uuidv7();
      await db.insert(sessions).values({
        id: sessionId,
        cookieHmac: `t-${sessionId}`,
        formId: "lesser-slime",
      });
      await appendEvents(db, sessionId, [
        { kind: "session.started", formId: "lesser-slime", seed: i },
        { kind: "session.ended", reason: "death" },
      ]);
      const events: Event[] = [
        { kind: "session.started", formId: "lesser-slime", seed: i },
        { kind: "session.ended", reason: "death" },
      ];
      await recordContribution(db, events, { sessionId, userId });
    }
    const arc = await getCurrentArc(db);
    expect(arc?.progress).toBe(105);
    expect(arc?.phase).toBe("rising");
  });

  it("cataclysm: progress ≥ 999 resets to 0/stirring with cycle++", async () => {
    // Pre-load the row to 998 so the next +5 triggers reset.
    await ensureLongWyrmExists(db);
    await db
      .update(metaArcs)
      .set({
        progress: 998,
        phase: "broken",
        phaseLabel: "Broken",
      })
      .where(eq(metaArcs.id, LONG_WYRM_ID));
    const sessionId = uuidv7();
    await db.insert(sessions).values({
      id: sessionId,
      cookieHmac: `t-${sessionId}`,
      formId: "lesser-slime",
    });
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "session.ended", reason: "death" },
    ];
    const after = await recordContribution(db, events, {
      sessionId,
      userId,
    });
    expect(after?.progress).toBe(0);
    expect(after?.phase).toBe("stirring");
    expect((after?.meta as { cycle?: number } | null)?.cycle).toBe(2);
  });
});

describe("persistRunToWorld also fires meta-arc contribution", () => {
  it("a single ended run lands BOTH a world memory AND a meta contribution", async () => {
    const campaignId = uuidv7();
    await db.insert(campaigns).values({
      id: campaignId,
      userId,
      title: "test",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });
    const sessionId = uuidv7();
    await db.insert(sessions).values({
      id: sessionId,
      cookieHmac: `t-${sessionId}`,
      formId: "lesser-slime",
      campaignId,
    });
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      {
        kind: "narration.emitted",
        text: "Cohesion = 0.",
        toolCallsApplied: 0,
      },
      { kind: "session.ended", reason: "death" },
    ]);

    await persistRunToWorld(db, {
      userId,
      sessionId,
      campaignId,
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
    });

    const arc = await getCurrentArc(db);
    expect(arc?.progress).toBe(5);
    const contribs = await db.select().from(metaContributions);
    expect(contribs).toHaveLength(1);
    expect(contribs[0].formId).toBe("lesser-slime");
    expect(contribs[0].locationId).toBe("collapsed-tunnel");
  });
});
