/**
 * Co-play turn coordination — Phase 9 T5.1 follow-up.
 *
 * Rules:
 *   - A session can be the canonical session of at most one
 *     active party. (Schema lets parties.session_id repeat in
 *     theory, but we treat it as 1:1 in practice.)
 *   - Only the party's currentTurnUserId may submit input on a
 *     party-bound session. Other members can read state but the
 *     turn route returns 423 Locked otherwise.
 *   - On a successful runTurn, currentTurnUserId rotates to the
 *     next member by turn_order modulo active membership.
 *   - When the host's session.ended fires, the party transitions
 *     to status='ended' and currentTurnUserId clears.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { parties, partyMembers, users } from "../db/schema";

export interface PartySnapshot {
  id: string;
  hostUserId: string;
  sessionId: string;
  status: "forming" | "active" | "ended";
  currentTurnUserId: string | null;
  maxSize: number;
  members: Array<{
    userId: string;
    username: string | null;
    turnOrder: number;
  }>;
}

export async function getPartyForSession(
  db: Db,
  sessionId: string,
): Promise<PartySnapshot | null> {
  const [p] = await db
    .select()
    .from(parties)
    .where(eq(parties.sessionId, sessionId))
    .limit(1);
  if (!p) return null;
  const ms = await db
    .select({
      userId: partyMembers.userId,
      username: users.username,
      turnOrder: partyMembers.turnOrder,
    })
    .from(partyMembers)
    .leftJoin(users, eq(users.id, partyMembers.userId))
    .where(
      and(
        eq(partyMembers.partyId, p.id),
        isNull(partyMembers.leftAt),
      ),
    )
    .orderBy(asc(partyMembers.turnOrder));
  return {
    id: p.id,
    hostUserId: p.hostUserId,
    sessionId: p.sessionId,
    status: p.status as PartySnapshot["status"],
    currentTurnUserId: p.currentTurnUserId,
    maxSize: p.maxSize,
    members: ms.map((m) => ({
      userId: m.userId,
      username: m.username,
      turnOrder: m.turnOrder,
    })),
  };
}

/**
 * True if `userId` is allowed to submit a turn on the party's
 * session right now. False on lock-misses (someone else's turn,
 * party not active, user not a member).
 *
 * Pure: takes a snapshot, returns boolean.
 */
export function isUsersTurn(
  party: PartySnapshot,
  userId: string,
): boolean {
  if (party.status !== "active") return false;
  if (party.currentTurnUserId !== userId) return false;
  return party.members.some((m) => m.userId === userId);
}

/**
 * Pure: pick the next currentTurnUserId by walking turn_order
 * modulo active members. Returns null if no members.
 */
export function nextTurnUserId(
  party: PartySnapshot,
  currentUserId: string | null,
): string | null {
  if (party.members.length === 0) return null;
  if (!currentUserId) {
    return party.members[0]?.userId ?? null;
  }
  const idx = party.members.findIndex((m) => m.userId === currentUserId);
  if (idx < 0) {
    // Fallback: current user isn't a member anymore — start from 0.
    return party.members[0]?.userId ?? null;
  }
  const nextIdx = (idx + 1) % party.members.length;
  return party.members[nextIdx]!.userId;
}

/**
 * Side-effecting: rotate the party's currentTurnUserId to the
 * next member. Called by runTurn's post-event hook when the
 * session is party-bound. Returns the new currentTurnUserId.
 */
export async function advanceTurn(
  db: Db,
  partyId: string,
): Promise<string | null> {
  const [p] = await db
    .select()
    .from(parties)
    .where(eq(parties.id, partyId))
    .limit(1);
  if (!p) return null;
  if (p.status !== "active") return p.currentTurnUserId;
  const ms = await db
    .select({
      userId: partyMembers.userId,
      username: users.username,
      turnOrder: partyMembers.turnOrder,
    })
    .from(partyMembers)
    .leftJoin(users, eq(users.id, partyMembers.userId))
    .where(
      and(eq(partyMembers.partyId, p.id), isNull(partyMembers.leftAt)),
    )
    .orderBy(asc(partyMembers.turnOrder));
  const snap: PartySnapshot = {
    id: p.id,
    hostUserId: p.hostUserId,
    sessionId: p.sessionId,
    status: p.status as PartySnapshot["status"],
    currentTurnUserId: p.currentTurnUserId,
    maxSize: p.maxSize,
    members: ms.map((m) => ({
      userId: m.userId,
      username: m.username,
      turnOrder: m.turnOrder,
    })),
  };
  const next = nextTurnUserId(snap, p.currentTurnUserId);
  await db
    .update(parties)
    .set({ currentTurnUserId: next })
    .where(eq(parties.id, partyId));
  return next;
}

/**
 * Side-effecting: end the party (e.g. on session.ended). Called
 * from the post-event hook when the session terminates.
 */
export async function endParty(
  db: Db,
  partyId: string,
): Promise<void> {
  await db
    .update(parties)
    .set({
      status: "ended",
      currentTurnUserId: null,
      endedAt: new Date(),
    })
    .where(eq(parties.id, partyId));
}
