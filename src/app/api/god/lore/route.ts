/**
 * Admin lore endpoints:
 *
 * GET  /api/god/lore?limit=N&includeRedacted=1
 *      Lists lore for the admin UI. Returns redacted entries when
 *      includeRedacted is set so admins can review their own
 *      redactions. Otherwise returns the same data shape as
 *      /api/lore but with the audit columns (updatedAt,
 *      lastEditedByUserId, expiresAt).
 *
 * POST /api/god/lore
 *      Body: { summary, prose?, salience?, category?, tags?,
 *              expiresAt? }
 *      Admin direct injection — bypasses the lore judge. The row
 *      is attributed to the admin user. Use for canonical events
 *      the operator wants on the chronicle (festivals, world-
 *      shaping admin actions, scheduled story beats).
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminWriteLore, listLoreForAdmin } from "@/lib/lore/store";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(200, Number(url.searchParams.get("limit") ?? "50")),
  );
  const lore = await listLoreForAdmin(db, limit);
  const now = Date.now();
  return NextResponse.json({
    lore: lore.map((l) => ({
      id: l.id,
      summary: l.summary,
      prose: l.prose,
      salience: l.salience,
      category: l.category,
      tags: l.tags,
      sourceUserId: l.sourceUserId,
      sourceCampaignId: l.sourceCampaignId,
      sourceFormId: l.sourceFormId,
      sourceLocationId: l.sourceLocationId,
      sourcePhase: l.sourcePhase,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      lastEditedByUserId: l.lastEditedByUserId,
      expiresAt: l.expiresAt,
      isRedacted: !!(l.expiresAt && l.expiresAt.getTime() <= now),
      isEdited:
        !!l.lastEditedByUserId &&
        l.updatedAt.getTime() > l.createdAt.getTime() + 1000,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    summary?: string;
    prose?: string;
    salience?: number;
    category?: string;
    tags?: string[];
    expiresAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const summary = (body.summary ?? "").trim();
  if (!summary) {
    return NextResponse.json({ error: "summary required" }, { status: 400 });
  }
  if (summary.length > 500) {
    return NextResponse.json(
      { error: "summary too long (max 500)" },
      { status: 400 },
    );
  }
  const prose = body.prose ? body.prose.slice(0, 1500) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json(
      { error: "invalid expiresAt" },
      { status: 400 },
    );
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).slice(0, 40))
    : [];
  const row = await adminWriteLore(db, {
    summary,
    prose,
    salience: body.salience,
    category: body.category ?? null,
    tags,
    expiresAt,
    adminUserId: admin.userId,
  });
  return NextResponse.json({
    ok: true,
    lore: {
      id: row.id,
      summary: row.summary,
      salience: row.salience,
      category: row.category,
      tags: row.tags,
      createdAt: row.createdAt,
    },
  });
}
