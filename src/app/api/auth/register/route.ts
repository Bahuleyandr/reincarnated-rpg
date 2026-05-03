import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/session/auth";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!email || !username || password.length < 8) {
    return NextResponse.json(
      {
        error:
          "email + username + password (≥8 chars) required",
      },
      { status: 400 },
    );
  }

  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingByEmail.length > 0) {
    return NextResponse.json({ error: "email taken" }, { status: 409 });
  }
  const existingByName = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existingByName.length > 0) {
    return NextResponse.json({ error: "username taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const id = uuidv7();
  await db.insert(users).values({ id, email, username, passwordHash });

  const token = await mintCookie({ userId: id });
  log.info("auth.register", { userId: id });
  const res = NextResponse.json({
    user: { id, email, username },
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
