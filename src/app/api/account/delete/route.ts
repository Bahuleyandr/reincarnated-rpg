/**
 * POST /api/account/delete — GDPR account deletion.
 *
 * Hard-delete the user row. ON DELETE CASCADE on every per-user
 * table cleans up the rest. World-shared data (worldLore entries
 * the user produced) is anonymized via ON DELETE SET NULL on
 * source_user_id; the prose stays so other players' archives
 * don't break, but attribution is wiped.
 *
 * Requires `confirmation: "delete"` in the body to prevent
 * accidental deletion.
 *
 * Phase 8 Day 72.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: { confirmation?: unknown };
  try {
    body = (await req.json()) as { confirmation?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.confirmation !== "delete") {
    return NextResponse.json(
      { error: "confirmation_required" },
      { status: 400 },
    );
  }

  const userId = verified.userId;
  const result = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  log.info("account.deleted", { userId, removed: result.length });

  // Clear the cookie.
  const res = NextResponse.json({ ok: true, deleted: result.length });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
