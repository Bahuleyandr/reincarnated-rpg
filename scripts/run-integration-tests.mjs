#!/usr/bin/env node
/**
 * scripts/run-integration-tests.mjs
 *
 * Pins integration tests to the local CI Postgres regardless of
 * what .env.local says. Without this wrapper, .env.local now points
 * at Dalekdefender (the dev DB) and `npm run test:integration` would
 * happily TRUNCATE all live data per-test. That's a footgun.
 *
 * The CI database (`reincarnated_ci`) is created + migrated by
 * scripts/ci-local.sh — run that once before invoking this. Or
 * just use `npm run ci:local` which does the whole thing end-to-
 * end.
 */
import { spawnSync } from "node:child_process";

const url =
  process.env.TEST_DATABASE_URL ??
  "postgres://reincarnated:reincarnated@127.0.0.1:5434/reincarnated_ci";

const env = { ...process.env, DATABASE_URL: url };

// Probe first so a misconfigured DB fails with a clearer message
// than jest's "ECONNREFUSED" pile.
const probe = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "scripts/check-test-db.ts"],
  { stdio: "inherit", env },
);
if (probe.status !== 0) {
  console.error(
    "[test:integration] Postgres unreachable at " +
      url +
      ". Run `npm run ci:local --only migrate` first, or set TEST_DATABASE_URL.",
  );
  process.exit(probe.status ?? 1);
}

const jest = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "jest",
    "--testPathPatterns=tests/integration",
    "--runInBand",
    "--testTimeout=15000",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env },
);
process.exit(jest.status ?? 1);
