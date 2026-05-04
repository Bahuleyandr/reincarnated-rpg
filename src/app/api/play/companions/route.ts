/**
 * GET  /api/play/companions — list in-run companions for the
 *                            current session.
 * POST /api/play/companions — { action: "summon", slug }
 *                             summons a bonded NPC into the
 *                             current session.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  listInRunCompanions,
  summonCompanion,
} from "@/lib/companions/in-run";
import { sessions, worldNpcs } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

async function resolveSession(
  req: NextRequest,
): Promise<{ sessionId: string; userId: string | null } | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) return null;
  return {
    sessionId: verified.sessionId,
    userId: verified.userId ?? null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await resolveSession(req);
  if (!ctx) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const rows = await listInRunCompanions(db, ctx.sessionId);
  // The session's current turn (for the joined-at display).
  const [s] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, ctx.sessionId))
    .limit(1);

  // Bonded NPCs the user has that AREN'T in this session yet —
  // candidates the player can summon. Anon sessions skip
  // (worldNpcs are user-keyed).
  let summonable: Array<{
    slug: string;
    name: string;
    timesMet: number;
    relationshipScore: number;
  }> = [];
  if (ctx.userId) {
    const inRunIds = new Set(rows.map((r) => r.worldNpcId));
    const bonded = await db
      .select({
        id: worldNpcs.id,
        slug: worldNpcs.slug,
        name: worldNpcs.name,
        timesMet: worldNpcs.timesMet,
        relationshipScore: worldNpcs.relationshipScore,
        lastSeenStatus: worldNpcs.lastSeenStatus,
      })
      .from(worldNpcs)
      .where(
        and(
          eq(worldNpcs.userId, ctx.userId),
          isNotNull(worldNpcs.bondedAt),
        ),
      );
    summonable = bonded
      .filter(
        (n) => !inRunIds.has(n.id) && n.lastSeenStatus !== "dead",
      )
      .map((n) => ({
        slug: n.slug,
        name: n.name,
        timesMet: n.timesMet,
        relationshipScore: n.relationshipScore,
      }));
  }

  return NextResponse.json({
    sessionId: s?.id ?? ctx.sessionId,
    companions: rows,
    summonable,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveSession(req);
  if (!ctx) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  if (!ctx.userId) {
    // Bonded NPCs are user-scoped — anon sessions can't summon.
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: { action?: unknown; slug?: unknown; turn?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.action !== "summon" || typeof body.slug !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  // Fall back to turn 0 if not supplied; the play UI passes
  // the current turn so the joined-at-turn is meaningful.
  const turn = typeof body.turn === "number" ? body.turn : 0;
  const r = await summonCompanion(db, {
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    worldNpcSlug: body.slug,
    turn,
  });
  if (!r.ok) {
    return NextResponse.json(r, { status: 400 });
  }
  return NextResponse.json(r);
}
