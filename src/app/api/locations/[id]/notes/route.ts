/**
 * GET /api/locations/[id]/notes — top-3 un-flagged un-expired notes.
 * POST /api/locations/[id]/notes — leave a note. 1 energy cost.
 *
 * Phase 5.5 Day 32-33.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { trySpend } from "@/lib/energy/state";
import { leaveNote, NOTE_MAX_LEN, topNotes } from "@/lib/locations/notes";
import { moderate } from "@/lib/moderation";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: locationId } = await params;
  const url = new URL(req.url);
  const formId = url.searchParams.get("formId") ?? null;
  const limit = Math.max(
    1,
    Math.min(10, Number(url.searchParams.get("limit") ?? 3)),
  );
  const notes = await topNotes(db, locationId, { formId, limit });
  return NextResponse.json({ notes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: locationId } = await params;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json(
      { error: "login_required" },
      { status: 401 },
    );
  }

  let body: { text?: unknown; formId?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; formId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  const formId =
    typeof body.formId === "string" && body.formId.length > 0
      ? body.formId
      : null;
  if (text.trim().length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }
  if (text.length > NOTE_MAX_LEN) {
    return NextResponse.json(
      { error: "too_long", maxLen: NOTE_MAX_LEN },
      { status: 400 },
    );
  }

  const verdict = moderate(text);
  if (verdict.verdict === "severe" || verdict.verdict === "injection") {
    return NextResponse.json(
      {
        error: "rejected_by_moderation",
        reason: verdict.playerMessage ?? null,
      },
      { status: 422 },
    );
  }

  // Charge 1 energy. If the player can't afford it, refuse.
  const trySpendResult = await trySpend(
    db,
    {
      userId: verified.userId,
      sessionId: verified.sessionId ?? "",
    },
    1,
  );
  if (!trySpendResult.ok) {
    return NextResponse.json(
      { error: "out_of_energy" },
      { status: 402 },
    );
  }

  const r = await leaveNote(db, {
    userId: verified.userId,
    locationId,
    formId,
    text,
  });
  if ("error" in r) {
    // We charged energy already; refund on a leaveNote failure
    // (cap-hit etc.) so the player isn't punished for a soft-reject.
    try {
      const { refundEnergy } = await import("@/lib/energy/state");
      await refundEnergy(
        db,
        {
          userId: verified.userId,
          sessionId: verified.sessionId ?? "",
        },
        1,
      );
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ id: r.id });
}
