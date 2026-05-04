/**
 * scripts/loadtest.k6.js — Phase 8 Day 65-66.
 *
 * k6 script. Spins up N virtual users, each does:
 *   1. POST /api/session (anon)
 *   2. POST /api/turn × 5
 *
 * Targets the production turn pipeline; assumes ANTHROPIC_API_KEY
 * is set (otherwise the orchestrator falls back to template
 * narrator and the test still exercises the lock + DB paths).
 *
 * Run:
 *   BASE_URL=https://your-host k6 run scripts/loadtest.k6.js
 *   BASE_URL=http://localhost:3000 k6 run -u 50 -d 5m scripts/loadtest.k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  vus: Number.parseInt(__ENV.VUS || "10"),
  duration: __ENV.DURATION || "1m",
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  // Anon session.
  const sessionRes = http.post(
    `${BASE}/api/session`,
    JSON.stringify({ formId: "lesser-slime", reincarnatedAs: null }),
    { headers: { "content-type": "application/json" } },
  );
  check(sessionRes, {
    "session 200": (r) => r.status === 200,
  });
  if (sessionRes.status !== 200) return;
  const cookie = sessionRes.cookies?.["reincarnated_session"]?.[0]?.value;
  if (!cookie) return;

  // 5 turns.
  for (let i = 0; i < 5; i++) {
    const turnRes = http.post(
      `${BASE}/api/turn`,
      JSON.stringify({ input: "i ooze toward the slope" }),
      {
        headers: {
          "content-type": "application/json",
          cookie: `reincarnated_session=${cookie}`,
        },
      },
    );
    check(turnRes, {
      "turn 200/409": (r) => r.status === 200 || r.status === 409,
    });
    sleep(0.5);
  }
}
