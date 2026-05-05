/**
 * GET  /api/character/race — current declared race (or null).
 * POST /api/character/race — set/clear the player's race.
 *
 * Body: { race: "human" | "elven" | "dwarven" | "halfling" | "orcish" | null }
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { RACE_IDS } from "@/lib/race/mechanics";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const [row] = await db
    .select({ race: users.race })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);
  return NextResponse.json({ race: row?.race ?? null });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: { race?: unknown };
  try {
    body = (await req.json()) as { race?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const r = body.race;
  if (
    r !== null &&
    r !== "" &&
    !(typeof r === "string" && (RACE_IDS as readonly string[]).includes(r))
  ) {
    return NextResponse.json({ error: "invalid_race" }, { status: 400 });
  }
  const value = r === null || r === "" ? null : (r as string);
  await db
    .update(users)
    .set({ race: value, updatedAt: new Date() })
    .where(eq(users.id, verified.userId));
  return NextResponse.json({ ok: true, race: value });
}
