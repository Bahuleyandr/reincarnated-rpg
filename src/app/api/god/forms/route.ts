/**
 * GET  /api/god/forms — admin queue + audit list.
 * POST /api/god/forms — approve/reject a submission.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  approveSubmission,
  listSubmissions,
  rejectSubmission,
} from "@/lib/forms/submit";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const items = await listSubmissions(db, status);
  return NextResponse.json({
    admin: { username: admin.username },
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      theme: i.theme,
      status: i.status,
      authorUserId: i.authorUserId,
      approvedFormId: i.approvedFormId,
      reviewerNotes: i.reviewerNotes,
      submittedAtMs: i.submittedAt.getTime(),
      reviewedAtMs: i.reviewedAt?.getTime() ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    submissionId?: unknown;
    decision?: unknown;
    notes?: unknown;
  };
  try {
    body = (await req.json()) as {
      submissionId?: unknown;
      decision?: unknown;
      notes?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    typeof body.submissionId !== "string" ||
    (body.decision !== "approve" && body.decision !== "reject")
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes : "";
  if (body.decision === "approve") {
    const r = await approveSubmission(db, {
      submissionId: body.submissionId,
      reviewerUserId: admin.userId,
      notes,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } else {
    if (notes.trim().length === 0) {
      return NextResponse.json(
        { error: "notes_required_on_reject" },
        { status: 400 },
      );
    }
    const r = await rejectSubmission(db, {
      submissionId: body.submissionId,
      reviewerUserId: admin.userId,
      notes,
    });
    return NextResponse.json(r);
  }
}
