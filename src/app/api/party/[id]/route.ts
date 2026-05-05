/**
 * GET /api/party/[id] — read a party's snapshot (members,
 * status, current turn user). Public-ish — anyone with the id
 * can read; only members can act.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { parties } from "@/lib/db/schema";
import { getPartyForSession } from "@/lib/parties/coordination";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Look up the party by id → its sessionId → snapshot.
  const [p] = await db
    .select()
    .from(parties)
    .where(eq(parties.id, id))
    .limit(1);
  if (!p) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const snap = await getPartyForSession(db, p.sessionId);
  if (!snap) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: snap.id,
    sessionId: snap.sessionId,
    status: snap.status,
    hostUserId: snap.hostUserId,
    currentTurnUserId: snap.currentTurnUserId,
    maxSize: snap.maxSize,
    members: snap.members,
  });
}
