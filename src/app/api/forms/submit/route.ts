/**
 * POST /api/forms/submit — submit a player-authored form spec.
 *
 * Auth required. The submission lands in player_forms with
 * status='pending_review'; admins approve from /god/forms.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { submitForm, type FormSpec } from "@/lib/forms/submit";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: { name?: unknown; theme?: unknown; spec?: unknown };
  try {
    body = (await req.json()) as {
      name?: unknown;
      theme?: unknown;
      spec?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    typeof body.name !== "string" ||
    typeof body.theme !== "string" ||
    !body.spec ||
    typeof body.spec !== "object"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const r = await submitForm(db, {
    authorUserId: verified.userId,
    name: body.name,
    theme: body.theme,
    spec: body.spec as FormSpec,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ id: r.id, status: "pending_review" });
}
