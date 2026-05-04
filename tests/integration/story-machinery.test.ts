/**
 * Phase 7 Day 47-52: votes, edicts, endings.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  edicts,
  factions,
  users,
  worldVotes,
  yearEndings,
} from "@/lib/db/schema";
import { proposeEdict, listActiveEdicts, redactEdict } from "@/lib/story/edicts";
import { resolveYearEnding } from "@/lib/story/endings";
import { castBallot, getMyBallot, resolveVote } from "@/lib/story/votes";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userIdA: string;
let userIdB: string;

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
    "TRUNCATE world_vote_ballots, world_votes, edicts, year_endings, branch_decisions, faction_contributions, world_events, world_lore, sessions, users RESTART IDENTITY CASCADE",
  );
  await client.unsafe(
    "UPDATE factions SET member_count=0, cumulative_contribution=0",
  );
  // Seed two users.
  const now = new Date();
  userIdA = uuidv7();
  userIdB = uuidv7();
  await db.insert(users).values([
    {
      id: userIdA,
      email: `a${userIdA}@x.com`,
      username: `a${userIdA}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: utcDateString(now),
    },
    {
      id: userIdB,
      email: `b${userIdB}@x.com`,
      username: `b${userIdB}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: utcDateString(now),
    },
  ]);
  // Seed a vote.
  await db.insert(worldVotes).values({
    id: 1,
    chapterId: 41,
    question: "Open the long song?",
    options: [
      { id: "open_the_song", label: "Open it" },
      { id: "keep_it_silent", label: "Keep silent" },
    ],
  });
});

describe("votes", () => {
  test("castBallot is idempotent + supports revote (last write wins)", async () => {
    const a = await castBallot(db, {
      voteId: 1,
      userId: userIdA,
      optionId: "open_the_song",
    });
    expect(a.ok).toBe(true);
    const b = await castBallot(db, {
      voteId: 1,
      userId: userIdA,
      optionId: "keep_it_silent",
    });
    expect(b.ok).toBe(true);
    const stored = await getMyBallot(db, 1, userIdA);
    expect(stored?.optionId).toBe("keep_it_silent");
  });

  test("rejects invalid option_id", async () => {
    const r = await castBallot(db, {
      voteId: 1,
      userId: userIdA,
      optionId: "nonsense",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_option");
  });

  test("rejects ballots after vote_closed", async () => {
    await db
      .update(worldVotes)
      .set({ resolvedAt: new Date(), winningOption: "open_the_song" })
      .where(eq(worldVotes.id, 1));
    const r = await castBallot(db, {
      voteId: 1,
      userId: userIdA,
      optionId: "open_the_song",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("vote_closed");
  });

  test("resolveVote picks the highest tally", async () => {
    await castBallot(db, { voteId: 1, userId: userIdA, optionId: "open_the_song" });
    await castBallot(db, { voteId: 1, userId: userIdB, optionId: "open_the_song" });
    const r = await resolveVote(db, 1);
    expect(r.winningOption).toBe("open_the_song");
  });

  test("resolveVote on already-resolved is idempotent", async () => {
    await castBallot(db, { voteId: 1, userId: userIdA, optionId: "open_the_song" });
    await resolveVote(db, 1);
    const r2 = await resolveVote(db, 1);
    expect(r2.winningOption).toBe("open_the_song");
  });
});

describe("edicts", () => {
  test("propose + list + redact", async () => {
    const r = await proposeEdict(db, {
      chapterId: 1,
      proposerUserId: userIdA,
      text: "salt is the only honest preserver",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const active = await listActiveEdicts(db);
    expect(active.length).toBe(1);
    await redactEdict(db, r.id);
    const after = await listActiveEdicts(db);
    expect(after.length).toBe(0);
  });

  test("rejects empty + too-long text", async () => {
    expect(
      (await proposeEdict(db, {
        chapterId: 1,
        proposerUserId: userIdA,
        text: "   ",
      })).ok,
    ).toBe(false);
    expect(
      (await proposeEdict(db, {
        chapterId: 1,
        proposerUserId: userIdA,
        text: "a".repeat(300),
      })).ok,
    ).toBe(false);
  });
});

describe("year endings", () => {
  test("falls back to the_quiet_year on no signal", async () => {
    const r = await resolveYearEnding(db, 1);
    expect(r.endingId).toBe("the_quiet_year");
    const [row] = await db
      .select()
      .from(yearEndings)
      .where(eq(yearEndings.year, 1));
    expect(row).toBeDefined();
  });

  test("idle dominance picks the_silence_kept", async () => {
    await db
      .update(factions)
      .set({ cumulativeContribution: 200 })
      .where(eq(factions.id, "idle"));
    const r = await resolveYearEnding(db, 2);
    expect(r.endingId).toBe("the_silence_kept");
  });

  test("idempotent: re-resolving returns the stored row", async () => {
    await db
      .update(factions)
      .set({ cumulativeContribution: 200 })
      .where(eq(factions.id, "idle"));
    const a = await resolveYearEnding(db, 3);
    // Tamper after the fact — resolver should still return original.
    await db
      .update(factions)
      .set({ cumulativeContribution: 0 })
      .where(eq(factions.id, "idle"));
    const b = await resolveYearEnding(db, 3);
    expect(b.endingId).toBe(a.endingId);
  });
});

void edicts;
