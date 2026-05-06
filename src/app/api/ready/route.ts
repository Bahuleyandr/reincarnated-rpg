/**
 * Readiness probe — real checks for everything the app needs to
 * actually serve traffic. Used by the Fly.io deploy gate so a
 * misconfigured deploy (wrong DATABASE_URL, missing pgvector,
 * empty content dir, revoked API key) rolls back automatically.
 *
 * Each check has its own ~1s budget; the route as a whole has a
 * 5s deadline. Returns 503 with the failing reason if anything
 * fails, 200 with the per-check timing if everything passes.
 *
 * NOT used as the keep-alive probe — that's /api/health, which is
 * cheap. Routing a 30s keep-alive through this would hammer the DB
 * with `SELECT 1` and the Anthropic endpoint with no value.
 */
import { sql } from "drizzle-orm";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

const CHECK_BUDGET_MS = 1500;
const TOTAL_DEADLINE_MS = 5000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const result = await withTimeout(
      db.execute(sql`SELECT 1 as ok`) as Promise<unknown>,
      CHECK_BUDGET_MS,
    );
    void result;
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkPgvector(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const rows = (await withTimeout(
      db.execute(
        sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
      ) as Promise<unknown>,
      CHECK_BUDGET_MS,
    )) as Array<{ extname: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: "pgvector extension not installed",
      };
    }
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkContent(): CheckResult {
  const t0 = Date.now();
  try {
    const formsDir = join(process.cwd(), "content", "forms");
    const locsDir = join(process.cwd(), "content", "locations");
    if (!existsSync(formsDir) || !existsSync(locsDir)) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: "content/forms or content/locations missing",
      };
    }
    const formCount = readdirSync(formsDir).filter((f) =>
      f.endsWith(".json"),
    ).length;
    const locCount = readdirSync(locsDir).filter((f) =>
      f.endsWith(".json"),
    ).length;
    if (formCount === 0 || locCount === 0) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: `empty content (${formCount} forms, ${locCount} locations)`,
      };
    }
    return {
      ok: true,
      durationMs: Date.now() - t0,
      detail: `${formCount} forms, ${locCount} locations`,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkAnthropic(): Promise<CheckResult> {
  const t0 = Date.now();
  // We don't *require* the Anthropic key for the template-narrator
  // path; in NARRATOR=template environments (CI, dev), report ok with
  // a "skipped" detail rather than failing.
  if (env().NARRATOR !== "remote") {
    return {
      ok: true,
      durationMs: Date.now() - t0,
      detail: "skipped (NARRATOR != remote)",
    };
  }
  // Skip when the deployment routes to a non-Anthropic provider
  // (MiniMax, Ollama, OpenRouter, etc. — anything OpenAI-compatible).
  // Without this skip, a Dalek deploy with NARRATOR=remote +
  // AI_PROVIDER=openai-compatible would 503 on /api/ready trying to
  // ping Anthropic with a key that isn't even set. The OpenAI-
  // compatible endpoint's reachability is best validated by the
  // first real turn rather than a synthetic ready-check (and most
  // hosts rate-limit empty POSTs, so a synthetic check would be
  // hostile).
  if (env().AI_PROVIDER !== "anthropic") {
    return {
      ok: true,
      durationMs: Date.now() - t0,
      detail: `skipped (AI_PROVIDER=${env().AI_PROVIDER})`,
    };
  }
  if (!env().ANTHROPIC_API_KEY) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: "ANTHROPIC_API_KEY missing",
    };
  }
  try {
    // Send an empty POST to /v1/messages — should 4xx (validation
    // error), not 5xx or network failure. We treat 4xx as "reachable
    // and authenticated" since auth fails return 401 and we'd see
    // that distinctly.
    const res = await withTimeout(
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env().ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      CHECK_BUDGET_MS,
    );
    if (res.status === 401) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: "anthropic 401 (key revoked or invalid)",
      };
    }
    if (res.status >= 500) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: `anthropic ${res.status}`,
      };
    }
    return {
      ok: true,
      durationMs: Date.now() - t0,
      detail: `reachable (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const t0 = Date.now();
  const checks = await withTimeout(
    Promise.all([
      checkDatabase(),
      checkPgvector(),
      Promise.resolve(checkContent()),
      checkAnthropic(),
    ]),
    TOTAL_DEADLINE_MS,
  ).catch((err) => {
    log.error("ready.deadline_exceeded", { err: String(err) });
    return null;
  });

  if (!checks) {
    return NextResponse.json(
      { status: "not_ready", error: "deadline exceeded" },
      { status: 503 },
    );
  }

  const [database, pgvector, content, anthropic] = checks;
  const allOk = checks.every((c) => c.ok);
  const body = {
    status: allOk ? "ready" : "not_ready",
    totalMs: Date.now() - t0,
    checks: { database, pgvector, content, anthropic },
  };
  if (!allOk) {
    log.warn("ready.failed", body);
  }
  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
