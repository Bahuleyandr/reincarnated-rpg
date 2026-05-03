/**
 * Admin auth — checks that the cookie carries a logged-in user AND
 * that user has is_admin='true' in the users table.
 *
 * Granting admin: SQL only. There is no in-app self-promotion.
 *   UPDATE users SET is_admin = 'true' WHERE email = 'you@example.com';
 *
 * The text column is stored as 'true' / 'false' rather than a bool
 * because Drizzle's pg-core doesn't have a clean boolean default-NOT-NULL
 * cell that round-trips both directions consistently across the
 * existing migrations — sticking to text matches the convention we
 * already used for `success` on ai_calls.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import type { Db } from "../db/client";
import { users } from "../db/schema";

import { SESSION_COOKIE_NAME, verifyCookie } from "./cookie";

export interface AdminContext {
  userId: string;
  username: string;
  email: string;
}

/** Returns the AdminContext if the request is authenticated as an
 *  admin, or null otherwise. Caller decides whether to 401 vs 403. */
export async function requireAdmin(
  db: Db,
  req: NextRequest,
): Promise<AdminContext | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) return null;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);
  const u = rows[0];
  if (!u || u.isAdmin !== "true") return null;
  return { userId: u.id, username: u.username, email: u.email };
}
