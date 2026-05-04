/**
 * POST /api/settings/scene-images { enabled: boolean }
 * Toggles the user's scene_images_enabled flag. Free-tier players
 * can toggle the flag but won't generate images (their cap is 0);
 * the toggle still persists so a future tier-up gets it ready to
 * fire.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { capForTier } from "@/lib/images/caps";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "missing enabled (boolean)" }, { status: 400 });
  }

  const flag = body.enabled ? "true" : "false";
  await db
    .update(users)
    .set({ sceneImagesEnabled: flag, updatedAt: new Date() })
    .where(eq(users.id, verified.userId));

  // Echo the user's effective cap for their tier so the UI can show
  // "you'll get up to N images per month" or "upgrade to enable".
  const userRow = (
    await db
      .select({ tier: users.tier })
      .from(users)
      .where(eq(users.id, verified.userId))
      .limit(1)
  )[0];
  return NextResponse.json({
    enabled: body.enabled,
    cap: capForTier(userRow?.tier ?? "free"),
  });
}
