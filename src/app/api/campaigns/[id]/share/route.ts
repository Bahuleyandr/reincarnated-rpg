/**
 * POST /api/campaigns/[id]/share — mint a share token for a campaign
 *   the requesting user owns.
 * DELETE /api/campaigns/[id]/share — clear the token (un-share).
 *
 * Re-sharing a previously shared campaign rotates the token (so
 * old links stop working).
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

function mintToken(): string {
  // 16-byte → 22-char base64url (no padding) — long enough that
  // brute-forcing valid tokens is implausible.
  return randomBytes(16).toString("base64url");
}

async function authorize(req: NextRequest, campaignId: string) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const rows = await db
    .select({ id: campaigns.id, ownerId: campaigns.userId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const row = rows[0];
  if (!row) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  if (row.ownerId !== verified.userId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { userId: verified.userId, campaignId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if ("error" in auth) return auth.error;

  const token = mintToken();
  const now = new Date();
  await db
    .update(campaigns)
    .set({ shareToken: token, sharedAt: now, updatedAt: now })
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, auth.userId)));

  return NextResponse.json({
    shareToken: token,
    sharedAtMs: now.getTime(),
    url: `/run/${token}`,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if ("error" in auth) return auth.error;

  await db
    .update(campaigns)
    .set({ shareToken: null, sharedAt: null, updatedAt: new Date() })
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, auth.userId)));

  return NextResponse.json({ shareToken: null });
}
