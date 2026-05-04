/**
 * ADR-011 retry — tool validation re-prompt + tone-drift re-prompt.
 *
 * Uses a hand-rolled MockNarrator (not TemplateNarrator) so we can
 * deterministically force a first-attempt failure and observe the
 * orchestrator's retry behavior.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { loadForm, loadLocation } from "@/lib/game/content";
import { readLog, rowToEvent } from "@/lib/game/events";
import { createSession } from "@/lib/game/session";
import { _resetSessionCacheForTests, runTurn } from "@/lib/game/turn";
import type { NarrateInput, NarrateOutput, Narrator } from "@/lib/game/types";

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
  await client.unsafe(
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  _resetSessionCacheForTests();
});

class MockNarrator implements Narrator {
  public attempts: NarrateInput[] = [];
  constructor(private responses: NarrateOutput[]) {}
  async narrate(input: NarrateInput): Promise<NarrateOutput> {
    this.attempts.push(input);
    const response = this.responses[Math.min(this.attempts.length - 1, this.responses.length - 1)];
    return response;
  }
}

describe("tool-validation retry (ADR-011)", () => {
  test("first attempt fails precondition; retry emits narrate_only; fallback path lands", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");

    // First attempt: try to remove an item that isn't held. Precondition
    // rejects, tool_validation_failed lands. Retry: narrate_only.
    const mock = new MockNarrator([
      {
        text: "Reaching for something you do not hold.",
        toolCalls: [{ name: "remove_inventory", itemId: "ghost-stone", qty: 1 }],
      },
      {
        text: "On reflection, you reach for nothing.",
        toolCalls: [{ name: "narrate_only" }],
      },
    ]);

    const created = await createSession(db, "lesser-slime");
    const result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I attempt the impossible",
      form,
      location,
      narrator: mock,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Mock should have been called twice (first + retry).
    expect(mock.attempts).toHaveLength(2);
    // The second call must carry the failure context.
    expect(mock.attempts[1].previousAttempt?.failureKind).toBe("tool_validation");
    expect(mock.attempts[1].previousAttempt?.failureReason).toMatch(/remove_inventory/);

    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const kinds = events.map((e) => e.kind);
    // Failure event from the first attempt landed.
    expect(kinds).toContain("tool_validation_failed");
    // Narration is the retry's text.
    const narration = events.find((e) => e.kind === "narration.emitted");
    expect((narration as { kind: "narration.emitted"; text: string } | undefined)?.text).toBe(
      "On reflection, you reach for nothing.",
    );
  });

  test("first attempt fails AND retry also fails: orchestrator falls back, narration text from retry preserved", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");

    const mock = new MockNarrator([
      {
        text: "first try.",
        toolCalls: [{ name: "remove_inventory", itemId: "ghost-stone", qty: 1 }],
      },
      {
        // Second attempt also broken (model didn't read the hint).
        text: "second try, also wrong.",
        toolCalls: [{ name: "remove_inventory", itemId: "still-not-held", qty: 1 }],
      },
    ]);

    const created = await createSession(db, "lesser-slime");
    const result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "broken",
      form,
      location,
      narrator: mock,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.attempts).toHaveLength(2);

    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    // Two tool_validation_failed events: one per attempt.
    const failures = events.filter((e) => e.kind === "tool_validation_failed");
    expect(failures.length).toBeGreaterThanOrEqual(2);
    // narration.emitted carries the second-attempt text but
    // toolCallsApplied=0 (no tools were applied).
    const narration = events.find((e) => e.kind === "narration.emitted") as
      | { kind: "narration.emitted"; text: string; toolCallsApplied: number }
      | undefined;
    expect(narration?.text).toBe("second try, also wrong.");
    expect(narration?.toolCallsApplied).toBe(0);
  });
});

describe("tone-drift retry", () => {
  test("first attempt has banned word; retry replaces text; tools stay applied", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");

    // First attempt uses a banned word ('hand') in narration. Tools are
    // valid (move_to). Retry rewrites the prose without the banned word.
    const mock = new MockNarrator([
      {
        text: "You reach a hand toward the slope.", // banned: 'hand'
        toolCalls: [{ name: "pass_time", ticks: 1 }],
      },
      {
        text: "Your forward edge eases toward the slope.",
        toolCalls: [{ name: "pass_time", ticks: 1 }], // ignored on retry
      },
    ]);

    const created = await createSession(db, "lesser-slime");
    const result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator: mock,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.attempts).toHaveLength(2);
    expect(mock.attempts[1].previousAttempt?.failureKind).toBe("tone_drift");
    expect(mock.attempts[1].previousAttempt?.failureReason).toMatch(/hand/);

    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const narration = events.find((e) => e.kind === "narration.emitted") as
      | { kind: "narration.emitted"; text: string; toolCallsApplied: number }
      | undefined;
    // Narration replaced with the retry's clean text.
    expect(narration?.text).toBe("Your forward edge eases toward the slope.");
    // Tools from the first attempt landed; the retry's tools are NOT
    // double-applied. So only one time.passed event total.
    const ticks = events.filter((e) => e.kind === "time.passed");
    expect(ticks).toHaveLength(1);
  });
});
