/**
 * The Three Votes — Phase 7 Day 49.
 *
 * Players cast at most one ballot per vote (UNIQUE pk on
 * world_vote_ballots). The winning option becomes a resolved
 * world fact at chapter-advance time when the vote's chapter
 * window closes.
 *
 * Distinct from branch_decisions: votes are explicit player
 * ballots; branches resolve via aggregate metrics.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  worldEvents,
  worldLore,
  worldVoteBallots,
  worldVotes,
  type WorldVote,
} from "../db/schema";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

export interface VoteOption {
  id: string;
  label: string;
}

export async function getVote(
  db: Db,
  voteId: number,
): Promise<WorldVote | null> {
  const [row] = await db
    .select()
    .from(worldVotes)
    .where(eq(worldVotes.id, voteId))
    .limit(1);
  return row ?? null;
}

export async function listOpenVotes(db: Db): Promise<WorldVote[]> {
  const rows = await db
    .select()
    .from(worldVotes)
    .where(sql`${worldVotes.resolvedAt} IS NULL`);
  return rows;
}

/**
 * Cast a ballot. Idempotent on (voteId, voterUserId) — repeated
 * calls update the option_id rather than create duplicates,
 * because we already enforce one-ballot-per-user.
 */
export async function castBallot(
  db: Db,
  args: { voteId: number; userId: string; optionId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const vote = await getVote(db, args.voteId);
  if (!vote) return { ok: false, error: "unknown_vote" };
  if (vote.resolvedAt) return { ok: false, error: "vote_closed" };
  // Validate option_id against the configured options.
  const options = (vote.options as VoteOption[]).map((o) => o.id);
  if (!options.includes(args.optionId)) {
    return { ok: false, error: "invalid_option" };
  }
  await db
    .insert(worldVoteBallots)
    .values({
      voteId: args.voteId,
      voterUserId: args.userId,
      optionId: args.optionId,
    })
    .onConflictDoUpdate({
      target: [worldVoteBallots.voteId, worldVoteBallots.voterUserId],
      set: { optionId: args.optionId, castAt: new Date() },
    });
  return { ok: true };
}

/**
 * Resolve a vote: tally ballots by option, pick the highest, write
 * winning_option + resolved_at, fire vote.resolved world event.
 */
export async function resolveVote(
  db: Db,
  voteId: number,
): Promise<{ winningOption: string | null }> {
  const vote = await getVote(db, voteId);
  if (!vote || vote.resolvedAt) return { winningOption: vote?.winningOption ?? null };
  const tallies = (await db.execute(sql`
    SELECT option_id, COUNT(*)::int AS n
    FROM world_vote_ballots
    WHERE vote_id = ${voteId}
    GROUP BY option_id
    ORDER BY n DESC
  `)) as unknown as Array<{ option_id: string; n: number }>;
  const top = tallies[0]?.option_id ?? null;
  const now = new Date();
  await db
    .update(worldVotes)
    .set({
      winningOption: top,
      resolvedAt: now,
    })
    .where(eq(worldVotes.id, voteId));
  if (top) {
    await db.insert(worldEvents).values({
      id: uuidv7(),
      kind: "vote.resolved",
      payload: {
        voteId,
        winningOption: top,
        question: vote.question,
        tallies,
      },
    });
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: `Vote ${voteId} resolved: ${vote.question} → ${top}.`,
      prose: null,
      salience: 0.85,
      category: "vote_resolved",
      tags: ["vote_resolved", `vote-${voteId}`, `option-${top}`],
    });
    invalidatePrefix("lore:");
    log.info("vote.resolved", { voteId, winningOption: top });
  }
  return { winningOption: top };
}

export async function getMyBallot(
  db: Db,
  voteId: number,
  userId: string,
): Promise<{ optionId: string } | null> {
  const [row] = await db
    .select({ optionId: worldVoteBallots.optionId })
    .from(worldVoteBallots)
    .where(
      and(
        eq(worldVoteBallots.voteId, voteId),
        eq(worldVoteBallots.voterUserId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
