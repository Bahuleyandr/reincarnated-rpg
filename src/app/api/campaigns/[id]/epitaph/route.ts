/**
 * POST /api/campaigns/[id]/epitaph — submit a final epitaph.
 *
 * Constraints:
 *   - caller owns the campaign
 *   - campaign status must be 'completed' (won) or 'abandoned' (dead/cap)
 *   - no epitaph already submitted (one per campaign)
 *   - text 1-280 chars, moderation pass (no profanity / injection)
 *
 * On success: writes a world_lore row with category='epitaph',
 * sourceLocationId=campaign.locationId, summary=text. Future
 * players passing through the same location will see it 24h later
 * (the public-lore delay carries forward).
 *
 * Phase 5.5 Day 30.
 */
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, worldLore } from "@/lib/db/schema";
import { embedText } from "@/lib/memory/episodic";
import { moderate } from "@/lib/moderation";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";
import { invalidatePrefix } from "@/lib/util/cache";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

const MAX_LEN = 280;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "empty_epitaph" },
      { status: 400 },
    );
  }
  if (raw.length > MAX_LEN) {
    return NextResponse.json(
      { error: "too_long", maxLen: MAX_LEN },
      { status: 400 },
    );
  }

  // Authorize + load campaign.
  const [row] = await db
    .select({
      id: campaigns.id,
      ownerId: campaigns.userId,
      locationId: campaigns.locationId,
      formId: campaigns.formId,
      status: campaigns.status,
      title: campaigns.title,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.ownerId !== verified.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.status === "active") {
    return NextResponse.json(
      { error: "campaign_still_active" },
      { status: 409 },
    );
  }

  // Reject if an epitaph already exists for this campaign.
  const existing = await db
    .select({ id: worldLore.id })
    .from(worldLore)
    .where(
      and(
        eq(worldLore.sourceCampaignId, id),
        eq(worldLore.category, "epitaph"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "epitaph_already_submitted" },
      { status: 409 },
    );
  }

  // Moderation. We reject severe + injection but accept mild — the
  // /lore page's redaction tooling handles edge cases.
  const verdict = moderate(raw);
  if (verdict.verdict === "severe" || verdict.verdict === "injection") {
    return NextResponse.json(
      {
        error: "rejected_by_moderation",
        reason: verdict.playerMessage ?? null,
      },
      { status: 422 },
    );
  }

  // Embed for future memory retrieval (next-life lore surface).
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(raw, "document");
  } catch (err) {
    log.warn("epitaph.embed_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const loreId = uuidv7();
  const now = new Date();
  await db.insert(worldLore).values({
    id: loreId,
    summary: raw,
    prose: null,
    embedding: embedding ?? undefined,
    salience: 0.7,
    category: "epitaph",
    tags: ["epitaph", row.formId],
    sourceUserId: verified.userId,
    sourceCampaignId: id,
    sourceSessionId: null,
    sourceLocationId: row.locationId,
    sourceFormId: row.formId,
    sourcePhase: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  });
  invalidatePrefix("lore:");
  log.info("epitaph.submitted", {
    loreId,
    campaignId: id,
    userId: verified.userId,
    locationId: row.locationId,
    chars: raw.length,
  });

  return NextResponse.json({
    loreId,
    locationId: row.locationId,
    publicAtMs: now.getTime() + 24 * 60 * 60 * 1000,
  });
}
