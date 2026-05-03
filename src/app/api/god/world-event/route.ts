/**
 * POST /api/god/world-event — admin-only.
 *
 * Body: { summary: string, salience?: number, tags?: string[] }
 *
 * Writes a high-salience world_memory row tagged 'admin:event' that
 * is GLOBAL — not user-scoped. Every player's next turn-1 recall
 * picks it up via the existing recallWorld path (which is already
 * per-user; for global events we additionally write a copy under
 * EVERY active user's world).
 *
 * v1 implementation: writes the memory under each currently-live
 * user's world. This is a shotgun approach — fine while the player
 * count is small. If the user count grows past ~10k we should
 * refactor recallWorld to also read a 'global' world keyed off a
 * sentinel UUID and OR with the per-user query.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, worldMemories } from "@/lib/db/schema";
import { embedText } from "@/lib/memory/episodic";
import { requireAdmin } from "@/lib/session/admin";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    summary?: string;
    salience?: number;
    tags?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const summary = (body.summary ?? "").trim();
  if (!summary) {
    return NextResponse.json(
      { error: "summary required" },
      { status: 400 },
    );
  }
  const salience = Math.max(0, Math.min(1, body.salience ?? 0.95));
  const tags = ["admin:event", ...(body.tags ?? [])];

  // Find every distinct user id that has at least one campaign.
  const rows = await db
    .selectDistinct({ userId: campaigns.userId })
    .from(campaigns);

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(summary, "document");
  } catch {
    embedding = null;
  }

  const now = new Date();
  let written = 0;
  for (const r of rows) {
    if (!r.userId) continue;
    await db.insert(worldMemories).values({
      id: uuidv7(),
      userId: r.userId,
      summary: `world: ${summary}`,
      embedding: embedding ?? undefined,
      tags,
      salience,
      sourceCampaignId: null,
      sourceFormId: null,
      sourceLocationId: null,
      createdAt: now,
    });
    written += 1;
  }

  log.info("god.world_event", {
    admin: admin.username,
    summary,
    salience,
    tags,
    usersTouched: written,
  });

  return NextResponse.json({ ok: true, usersTouched: written });
}
// Keep the eq import live for future per-user variants.
void eq;
