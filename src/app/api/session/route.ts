import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { createSession } from "@/lib/game/session";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";

export async function POST(_req: NextRequest) {
  try {
    const result = await createSession(db, "lesser-slime");
    const token = await mintCookie({ sessionId: result.sessionId });

    log.info("session.created", { sessionId: result.sessionId });

    const res = NextResponse.json({
      sessionId: result.sessionId,
      formId: result.formId,
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: env().NODE_ENV === "production",
      maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    log.error("session.create.failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "internal" },
      { status: 500 },
    );
  }
}
