import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ user: null });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) return NextResponse.json({ user: null });
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);
  const user = rows[0] ?? null;
  return NextResponse.json({ user });
}
