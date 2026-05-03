import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/session/auth";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "email + password required" },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = rows[0];
  if (!user) {
    // Same shape and timing as a wrong-password rejection so we
    // don't leak account existence.
    await new Promise((r) => setTimeout(r, 50));
    return NextResponse.json(
      { error: "invalid credentials" },
      { status: 401 },
    );
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "invalid credentials" },
      { status: 401 },
    );
  }

  const token = await mintCookie({ userId: user.id });
  log.info("auth.login", { userId: user.id });
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().NODE_ENV === "production",
    maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });
  return res;
}
