/**
 * POST /api/god/theme — admin-only.
 *
 * Body: { themeId: string | null, reason?: string }
 *
 * Pins the active weekly theme to a specific id (or clears the
 * override when themeId is null). The override is stored in
 * meta_arcs.meta.themeOverride; activeTheme() reads it.
 *
 * Use cases:
 *   - Run a special event week independent of the rotation.
 *   - Lock the theme during an admin-orchestrated story arc.
 *   - Test a theme on a dev environment without waiting for the
 *     ISO week to advance.
 *
 * Pass { themeId: null } to clear and resume rotation.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { metaArcs } from "@/lib/db/schema";
import { ensureLongWyrmExists, getCurrentArc, LONG_WYRM_ID } from "@/lib/meta/long-wyrm";
import { requireAdmin } from "@/lib/session/admin";
import { invalidate } from "@/lib/util/cache";
import { log } from "@/lib/util/log";
import { findTheme } from "@/lib/world/weekly-theme";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { themeId?: string | null; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const themeId = body.themeId === null ? null : (body.themeId ?? "").trim();

  if (themeId && !findTheme(themeId)) {
    return NextResponse.json(
      { error: `unknown themeId: ${themeId}` },
      { status: 400 },
    );
  }

  await ensureLongWyrmExists(db);
  const cur = await getCurrentArc(db);
  if (!cur) return NextResponse.json({ error: "no arc" }, { status: 500 });

  const meta = (cur.meta as Record<string, unknown> | null) ?? {};
  const nextMeta = themeId
    ? { ...meta, themeOverride: themeId }
    : Object.fromEntries(
        Object.entries(meta).filter(([k]) => k !== "themeOverride"),
      );

  await db
    .update(metaArcs)
    .set({ meta: nextMeta, updatedAt: new Date() })
    .where(eq(metaArcs.id, LONG_WYRM_ID));

  // Bust the world-theme cache so the change is immediate.
  invalidate("world:active-theme");

  log.info("god.theme.set", {
    admin: admin.username,
    themeId: themeId ?? "(cleared)",
    reason: body.reason ?? null,
  });

  return NextResponse.json({ ok: true, themeId, override: !!themeId });
}
