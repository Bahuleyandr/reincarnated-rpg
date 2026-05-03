/**
 * Per-entry admin lore endpoints:
 *
 * PUT    /api/god/lore/:id — edit. Body: any subset of
 *        { summary, prose, salience, category, tags, expiresAt }.
 *        updatedAt + lastEditedByUserId bumped automatically.
 *        Re-embeds when summary changes.
 *
 * DELETE /api/god/lore/:id — redact. Sets expiresAt to NOW() so
 *        the entry falls out of all recall paths immediately.
 *        Audit row preserved; visible via /api/god/lore with
 *        includeRedacted.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { worldLore } from "@/lib/db/schema";
import { adminEditLore, adminRedactLore } from "@/lib/lore/store";
import { requireAdmin } from "@/lib/session/admin";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const exists = await db
    .select({ id: worldLore.id })
    .from(worldLore)
    .where(eq(worldLore.id, id))
    .limit(1);
  if (exists.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: {
    summary?: string;
    prose?: string | null;
    salience?: number;
    category?: string | null;
    tags?: string[];
    expiresAt?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Sanitize inputs.
  const patch: {
    summary?: string;
    prose?: string | null;
    salience?: number;
    category?: string | null;
    tags?: string[];
    expiresAt?: Date | null;
  } = {};
  if (typeof body.summary === "string") {
    const s = body.summary.trim();
    if (!s) {
      return NextResponse.json({ error: "summary cannot be empty" }, { status: 400 });
    }
    patch.summary = s.slice(0, 500);
  }
  if (body.prose !== undefined) {
    patch.prose = body.prose === null ? null : body.prose.slice(0, 1500);
  }
  if (typeof body.salience === "number") {
    if (body.salience < 0 || body.salience > 1) {
      return NextResponse.json(
        { error: "salience must be in [0, 1]" },
        { status: 400 },
      );
    }
    patch.salience = body.salience;
  }
  if (body.category !== undefined) patch.category = body.category;
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.map((t) => String(t).slice(0, 40));
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null) {
      patch.expiresAt = null;
    } else {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "invalid expiresAt" },
          { status: 400 },
        );
      }
      patch.expiresAt = d;
    }
  }

  const updated = await adminEditLore(db, id, patch, admin.userId);
  return NextResponse.json({ ok: true, lore: updated });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const exists = await db
    .select({ id: worldLore.id })
    .from(worldLore)
    .where(eq(worldLore.id, id))
    .limit(1);
  if (exists.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await adminRedactLore(db, id, admin.userId);
  return NextResponse.json({ ok: true, redacted: id });
}
