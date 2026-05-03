import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session/cookie";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear by setting an empty value with maxAge=0.
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return res;
}
