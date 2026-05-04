/**
 * POST /api/god/lore/[id]/redact { reason?: string }
 *
 * Admin-only. Flips world_lore.admin_redacted = true, hiding the
 * entry from the public feed regardless of age. The 24h public-
 * delay gives admins a window to do this before the entry would
 * otherwise propagate.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { worldLore } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session/admin";
import { log } from "@/lib/util/log";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(db, req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body is optional */
  }

  const rows = await db
    .update(worldLore)
    .set({
      adminRedacted: true,
      lastEditedByUserId: admin.userId,
      updatedAt: new Date(),
    })
    .where(eq(worldLore.id, id))
    .returning({ id: worldLore.id });

  if (rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  log.info("god.lore.redacted", {
    actorUserId: admin.userId,
    loreId: id,
    reason: body.reason ?? null,
  });
  return NextResponse.json({ redacted: true, id });
}
