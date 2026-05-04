/**
 * Liveness probe — cheap and fast. The process is up; nothing else
 * is checked. Suitable for Fly.io's keep-alive probe at 30s intervals.
 *
 * Readiness checks (DB, pgvector, content, Anthropic) live in
 * /api/ready and are NOT touched here so a failing dependency
 * doesn't cause the keep-alive to flap and restart the VM.
 *
 * Build-time `commit` and `version` are exposed so deployments are
 * auditable (paste into a postmortem with which commit was running).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMIT = process.env.GIT_COMMIT_SHA ?? "unknown";
const VERSION = process.env.npm_package_version ?? "0.0.0";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "reincarnated-rpg",
    time: new Date().toISOString(),
    commit: COMMIT,
    version: VERSION,
  });
}
