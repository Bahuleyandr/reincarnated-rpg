/**
 * PvP duels lobby — Phase 9 T5.5 (minimal slice).
 *
 * challenge / accept / refuse / list. Resolution + roll mechanics
 * are a follow-up (the duels.challengerRoll + targetRoll columns
 * exist in the schema waiting to be populated).
 */
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { duels, users } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export type ChallengeResult =
  | { ok: true; duelId: string }
  | {
      ok: false;
      error:
        | "no_target"
        | "self_challenge"
        | "target_not_found"
        | "already_pending";
    };

export async function challengeUser(
  db: Db,
  args: {
    challengerUserId: string;
    targetUsername?: string;
    targetUserId?: string;
    targetNpcTemplateId?: string;
    contextFaction?: string | null;
    contextVenue?: string | null;
    contextQuote?: string | null;
  },
): Promise<ChallengeResult> {
  let targetUserId: string | null = null;
  let targetNpcTemplateId: string | null = null;
  if (args.targetUserId) {
    targetUserId = args.targetUserId;
  } else if (args.targetUsername) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, args.targetUsername))
      .limit(1);
    if (!u) return { ok: false, error: "target_not_found" };
    targetUserId = u.id;
  } else if (args.targetNpcTemplateId) {
    targetNpcTemplateId = args.targetNpcTemplateId;
  } else {
    return { ok: false, error: "no_target" };
  }
  if (targetUserId && targetUserId === args.challengerUserId) {
    return { ok: false, error: "self_challenge" };
  }

  // Block if there's already a pending duel between these two.
  if (targetUserId) {
    const [pending] = await db
      .select({ id: duels.id })
      .from(duels)
      .where(
        and(
          eq(duels.challengerUserId, args.challengerUserId),
          eq(duels.targetUserId, targetUserId),
          eq(duels.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) return { ok: false, error: "already_pending" };
  }

  const id = uuidv7();
  // expiresAt is set by the DB default (now() + 7 days). We rely on
  // the column default — Drizzle insert without expiresAt would
  // need a manual default(); the migration provides it.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(duels).values({
    id,
    challengerUserId: args.challengerUserId,
    targetUserId,
    targetNpcTemplateId,
    status: "pending",
    contextFaction: args.contextFaction ?? null,
    contextVenue: args.contextVenue ?? null,
    contextQuote: args.contextQuote ?? null,
    expiresAt,
  });
  return { ok: true, duelId: id };
}

export type RespondResult =
  | { ok: true }
  | {
      ok: false;
      error: "duel_not_found" | "not_target" | "wrong_status";
    };

export async function respondToDuel(
  db: Db,
  args: {
    duelId: string;
    targetUserId: string;
    decision: "accept" | "refuse";
  },
): Promise<RespondResult> {
  const [d] = await db
    .select()
    .from(duels)
    .where(eq(duels.id, args.duelId))
    .limit(1);
  if (!d) return { ok: false, error: "duel_not_found" };
  if (d.targetUserId !== args.targetUserId) {
    return { ok: false, error: "not_target" };
  }
  if (d.status !== "pending") {
    return { ok: false, error: "wrong_status" };
  }
  await db
    .update(duels)
    .set({
      status: args.decision === "accept" ? "accepted" : "refused",
      decidedAt: new Date(),
    })
    .where(eq(duels.id, args.duelId));
  return { ok: true };
}

export async function listIncoming(
  db: Db,
  userId: string,
): Promise<
  Array<{
    id: string;
    challengerUsername: string | null;
    status: string;
    contextFaction: string | null;
    contextVenue: string | null;
    contextQuote: string | null;
    challengedAtMs: number;
  }>
> {
  const rows = await db
    .select({
      id: duels.id,
      challengerUsername: users.username,
      status: duels.status,
      contextFaction: duels.contextFaction,
      contextVenue: duels.contextVenue,
      contextQuote: duels.contextQuote,
      challengedAt: duels.challengedAt,
    })
    .from(duels)
    .leftJoin(users, eq(users.id, duels.challengerUserId))
    .where(eq(duels.targetUserId, userId))
    .orderBy(desc(duels.challengedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    challengerUsername: r.challengerUsername,
    status: r.status,
    contextFaction: r.contextFaction,
    contextVenue: r.contextVenue,
    contextQuote: r.contextQuote,
    challengedAtMs: r.challengedAt.getTime(),
  }));
}

export async function listOutgoing(
  db: Db,
  userId: string,
): Promise<
  Array<{
    id: string;
    targetUsername: string | null;
    targetNpcTemplateId: string | null;
    status: string;
    challengedAtMs: number;
  }>
> {
  const rows = await db
    .select({
      id: duels.id,
      targetUsername: users.username,
      targetNpcTemplateId: duels.targetNpcTemplateId,
      status: duels.status,
      challengedAt: duels.challengedAt,
    })
    .from(duels)
    .leftJoin(users, eq(users.id, duels.targetUserId))
    .where(eq(duels.challengerUserId, userId))
    .orderBy(desc(duels.challengedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    targetUsername: r.targetUsername,
    targetNpcTemplateId: r.targetNpcTemplateId,
    status: r.status,
    challengedAtMs: r.challengedAt.getTime(),
  }));
}
