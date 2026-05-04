/**
 * POST /api/settings/mood — set the user's narration mood preset.
 * Body: { mood: 'cozy' | 'standard' | 'brutal' }.
 *
 * Per-session override (sessions.mood_preset) is set separately when
 * starting a campaign; this endpoint sets the per-user default that
 * sessions fall back to.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isValidMood } from "@/lib/narrator/moods";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { mood?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!isValidMood(body.mood)) {
    return NextResponse.json(
      { error: "invalid mood — must be cozy | standard | brutal" },
      { status: 400 },
    );
  }

  await db
    .update(users)
    .set({ moodPreset: body.mood, updatedAt: new Date() })
    .where(eq(users.id, verified.userId));

  return NextResponse.json({ moodPreset: body.mood });
}
