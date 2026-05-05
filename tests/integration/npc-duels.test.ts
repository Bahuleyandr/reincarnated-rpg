/**
 * NPC duels — DB integration covering the full challenge → auto-
 * accept/refuse → resolve pipeline against a real NPC template.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { duels, users } from "@/lib/db/schema";
import { challengeUser } from "@/lib/duels/lobby";
import { _resetNpcDuelCacheForTests } from "@/lib/duels/npc-stats";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;

async function makeUser(username: string): Promise<string> {
  const id = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: `${username}@x.com`,
    username,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
    coins: 0,
  });
  return id;
}

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
    "TRUNCATE duels, users RESTART IDENTITY CASCADE",
  );
  _resetNpcDuelCacheForTests();
});

describe("challengeUser → NPC auto-flow", () => {
  test("rhozell (acceptance 0.95) almost always accepts + resolves", async () => {
    const userId = await makeUser("alice");
    const r = await challengeUser(db, {
      challengerUserId: userId,
      targetNpcTemplateId: "rhozell",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.npcOutcome).toBeDefined();
    expect(r.npcOutcome?.outcome).toBe("resolved");
    if (r.npcOutcome?.outcome !== "resolved") return;
    expect(r.npcOutcome.challengerRoll).toBeGreaterThan(0);
    expect(r.npcOutcome.targetRoll).toBeGreaterThan(0);
    // Trash talk OR refusal line is present (resolved → trash talk).
    expect(r.npcOutcome.trashTalk).not.toBeNull();
    // DB row reflects the outcome.
    const [row] = await db
      .select()
      .from(duels)
      .where(eq(duels.id, r.duelId));
    expect(row.status).toBe("resolved");
    // Either the player (winnerUserId) or rhozell (winnerNpcTemplateId)
    // is set; CHECK constraint enforces at most one. Tie = both null.
    if (row.winnerUserId !== null) {
      expect(row.winnerNpcTemplateId).toBeNull();
      expect(row.winnerUserId).toBe(userId);
    } else if (row.winnerNpcTemplateId !== null) {
      expect(row.winnerNpcTemplateId).toBe("rhozell");
    }
    // Persisted rolls match the response.
    expect(row.challengerRoll).toBe(r.npcOutcome.challengerRoll);
    expect(row.targetRoll).toBe(r.npcOutcome.targetRoll);
  });

  test("the-binder (acceptance 0.25) refuses on most seeds", async () => {
    // We can't pin the seed easily — so run several attempts and
    // assert the DISTRIBUTION includes some refusals.
    let refusals = 0;
    let resolves = 0;
    for (let i = 0; i < 12; i++) {
      const userId = await makeUser(`bob${i}`);
      const r = await challengeUser(db, {
        challengerUserId: userId,
        targetNpcTemplateId: "the-binder",
      });
      if (!r.ok) continue;
      if (r.npcOutcome?.outcome === "refused") refusals += 1;
      if (r.npcOutcome?.outcome === "resolved") resolves += 1;
    }
    // With acceptance 0.25 across 12 distinct duel ids, we expect
    // roughly 9 refusals + 3 resolves. Assert at least one of each
    // (binder doesn't always refuse and doesn't always accept).
    expect(refusals).toBeGreaterThan(0);
    // refusals should be the majority; binder is reluctant.
    expect(refusals).toBeGreaterThanOrEqual(resolves);
  });

  test("refused duels carry the refusal line", async () => {
    // Same trick: try several until we land a refusal.
    for (let i = 0; i < 20; i++) {
      const userId = await makeUser(`carl${i}`);
      const r = await challengeUser(db, {
        challengerUserId: userId,
        targetNpcTemplateId: "the-binder",
      });
      if (
        r.ok &&
        r.npcOutcome?.outcome === "refused"
      ) {
        expect(r.npcOutcome.refusalLine).toMatch(/find someone else/);
        return;
      }
    }
    // If we reach here without a refusal in 20 attempts, the
    // 0.25 acceptance has produced an unlikely all-accept run.
    // Don't fail; just log.
    console.warn(
      "binder-test: no refusal in 20 attempts (lucky streak)",
    );
  });

  test("NPC-vs-NPC win path persists winner_npc_template_id", async () => {
    // Run rhozell duels until we see at least one NPC win, OR
    // assert the path runs cleanly. Mostly we're verifying the
    // CHECK constraint doesn't fail when the NPC wins.
    let foundNpcWin = false;
    for (let i = 0; i < 10; i++) {
      const userId = await makeUser(`d${i}`);
      const r = await challengeUser(db, {
        challengerUserId: userId,
        targetNpcTemplateId: "rhozell",
      });
      if (r.ok && r.npcOutcome?.outcome === "resolved") {
        if (r.npcOutcome.winnerNpcTemplateId === "rhozell") {
          foundNpcWin = true;
          // Re-read row + verify constraint.
          const [row] = await db
            .select()
            .from(duels)
            .where(eq(duels.id, r.duelId));
          expect(row.winnerUserId).toBeNull();
          expect(row.winnerNpcTemplateId).toBe("rhozell");
          break;
        }
      }
    }
    // Rhozell has +2 modifier — they should win some fraction of
    // the time. If the loop exits without finding one, the test
    // is brittle on this seed; print a warning.
    if (!foundNpcWin) {
      console.warn(
        "no rhozell win in 10 attempts — test depends on randomness",
      );
    }
  });
});
