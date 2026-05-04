/**
 * GET  /api/god/providers — admin view of all provider health rows.
 * POST /api/god/providers/[id]/status — admin override the status.
 *
 * Phase 7 Day 40-41.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  adminSetStatus,
  getAllHealth,
  type ProviderStatus,
} from "@/lib/ai/health";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const states = await getAllHealth(db);
  return NextResponse.json({
    admin: { username: admin.username },
    providers: states.map((s) => ({
      providerId: s.providerId,
      status: s.status,
      lastSuccessAtMs: s.lastSuccessAt?.getTime() ?? null,
      lastFailureAtMs: s.lastFailureAt?.getTime() ?? null,
      consecutiveFailures: s.consecutiveFailures,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { providerId?: unknown; status?: unknown };
  try {
    body = (await req.json()) as { providerId?: unknown; status?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    typeof body.providerId !== "string" ||
    typeof body.status !== "string" ||
    !["healthy", "degraded", "down", "manual_down"].includes(body.status)
  ) {
    return NextResponse.json(
      { error: "invalid_status_or_provider" },
      { status: 400 },
    );
  }
  await adminSetStatus(db, body.providerId, body.status as ProviderStatus);
  return NextResponse.json({ ok: true });
}
