/**
 * Co-play parties lobby — Phase 9 T5.1 (minimal slice).
 *
 * Lobby actions only: create / join / leave / list. The full
 * round-robin turn-lock + input routing is a follow-up. Once
 * `status='active'`, this lib's job is done — runtime
 * coordination lives elsewhere (or in a future commit).
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { parties, partyMembers, users } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export const PARTY_MIN = 2;
export const PARTY_MAX = 3;

export type CreateResult =
  | { ok: true; partyId: string }
  | { ok: false; error: "session_required" | "already_hosting" };

export async function createParty(
  db: Db,
  args: { hostUserId: string; sessionId: string; maxSize?: number },
): Promise<CreateResult> {
  if (!args.sessionId) return { ok: false, error: "session_required" };
  // One active party per host (forming or active).
  const [existing] = await db
    .select({ id: parties.id })
    .from(parties)
    .where(
      and(
        eq(parties.hostUserId, args.hostUserId),
        eq(parties.status, "forming"),
      ),
    )
    .limit(1);
  if (existing) return { ok: false, error: "already_hosting" };

  const id = uuidv7();
  const maxSize = Math.max(
    PARTY_MIN,
    Math.min(PARTY_MAX, args.maxSize ?? PARTY_MAX),
  );
  await db.insert(parties).values({
    id,
    hostUserId: args.hostUserId,
    sessionId: args.sessionId,
    status: "forming",
    maxSize,
  });
  await db.insert(partyMembers).values({
    partyId: id,
    userId: args.hostUserId,
    turnOrder: 0,
  });
  return { ok: true, partyId: id };
}

export type JoinResult =
  | { ok: true; turnOrder: number }
  | {
      ok: false;
      error:
        | "party_not_found"
        | "party_not_forming"
        | "party_full"
        | "already_member";
    };

export async function joinParty(
  db: Db,
  args: { partyId: string; userId: string },
): Promise<JoinResult> {
  const [p] = await db
    .select()
    .from(parties)
    .where(eq(parties.id, args.partyId))
    .limit(1);
  if (!p) return { ok: false, error: "party_not_found" };
  if (p.status !== "forming") {
    return { ok: false, error: "party_not_forming" };
  }
  const members = await db
    .select()
    .from(partyMembers)
    .where(
      and(
        eq(partyMembers.partyId, args.partyId),
        isNull(partyMembers.leftAt),
      ),
    );
  if (members.find((m) => m.userId === args.userId)) {
    return { ok: false, error: "already_member" };
  }
  if (members.length >= p.maxSize) {
    return { ok: false, error: "party_full" };
  }
  const turnOrder = members.length;
  await db.insert(partyMembers).values({
    partyId: args.partyId,
    userId: args.userId,
    turnOrder,
  });
  return { ok: true, turnOrder };
}

export async function leaveParty(
  db: Db,
  args: { partyId: string; userId: string },
): Promise<{ ok: boolean }> {
  await db
    .update(partyMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(partyMembers.partyId, args.partyId),
        eq(partyMembers.userId, args.userId),
      ),
    );
  return { ok: true };
}

export async function startParty(
  db: Db,
  args: { partyId: string; hostUserId: string },
): Promise<{ ok: boolean; error?: string }> {
  const [p] = await db
    .select()
    .from(parties)
    .where(eq(parties.id, args.partyId))
    .limit(1);
  if (!p) return { ok: false, error: "party_not_found" };
  if (p.hostUserId !== args.hostUserId) {
    return { ok: false, error: "not_host" };
  }
  if (p.status !== "forming") {
    return { ok: false, error: "wrong_status" };
  }
  const members = await db
    .select()
    .from(partyMembers)
    .where(
      and(
        eq(partyMembers.partyId, args.partyId),
        isNull(partyMembers.leftAt),
      ),
    );
  if (members.length < PARTY_MIN) {
    return { ok: false, error: "not_enough_members" };
  }
  await db
    .update(parties)
    .set({
      status: "active",
      currentTurnUserId: args.hostUserId,
    })
    .where(eq(parties.id, args.partyId));
  return { ok: true };
}

export async function listOpenParties(
  db: Db,
  limit = 25,
): Promise<
  Array<{
    id: string;
    hostUsername: string | null;
    memberCount: number;
    maxSize: number;
    createdAtMs: number;
  }>
> {
  const rows = await db
    .select({
      id: parties.id,
      hostUserId: parties.hostUserId,
      hostUsername: users.username,
      maxSize: parties.maxSize,
      createdAt: parties.createdAt,
    })
    .from(parties)
    .leftJoin(users, eq(users.id, parties.hostUserId))
    .where(eq(parties.status, "forming"))
    .orderBy(desc(parties.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
  // For each, fetch member count.
  const out: Array<{
    id: string;
    hostUsername: string | null;
    memberCount: number;
    maxSize: number;
    createdAtMs: number;
  }> = [];
  for (const r of rows) {
    const ms = await db
      .select()
      .from(partyMembers)
      .where(
        and(
          eq(partyMembers.partyId, r.id),
          isNull(partyMembers.leftAt),
        ),
      );
    out.push({
      id: r.id,
      hostUsername: r.hostUsername,
      memberCount: ms.length,
      maxSize: r.maxSize,
      createdAtMs: r.createdAt.getTime(),
    });
  }
  return out;
}

void asc;
