import "../scripts/load-env";

/**
 * Eval runner — Day 12 (full).
 *
 * Drives every scenario in `eval/scenarios/*.json` against the
 * configured narrator (defaults to template; remote scenarios are
 * skipped if no ANTHROPIC_API_KEY).
 *
 * Per scenario:
 *   1. TRUNCATE all session-scoped tables (one shared dev DB).
 *   2. Create session row + seed events from `setup.events`.
 *   3. Apply rollOverride directly through runTurn when the scenario
 *      supplies one.
 *   4. Drive one runTurn() with the scenario's `input`.
 *   5. Match emitted events against `expected.events` (loose),
 *      `expected.eventsAny` (any one matches), `expected.eventsAbsent`,
 *      and `expected.projection` (dotted-path → value).
 *   6. Report pass/fail per assertion.
 *
 * What's intentionally deferred:
 *   - rollOverride injection (above)
 *   - LLM-as-judge tone scoring (calls eval/judge.ts; only fires
 *     when ANTHROPIC_API_KEY is set)
 *   - narration text matchers (narrationAny / narrationAbsent) —
 *     wired but no-ops on TemplateNarrator
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "../src/lib/db/client";
import { sessions } from "../src/lib/db/schema";
import { loadBeatPack, loadForm, loadLocation } from "../src/lib/game/content";
import { appendEvents, readLog, rowToEvent } from "../src/lib/game/events";
import { _resetSessionCacheForTests, runTurn } from "../src/lib/game/turn";
import { TemplateNarrator } from "../src/lib/narrator/template";
import { uuidv7 } from "../src/lib/util/uuidv7";

interface Scenario {
  id: string;
  setup: { formId?: string; locationId?: string; events: unknown[] };
  input: string;
  rollOverride?: { d1: number; d2: number; mod: number };
  expected?: {
    events?: Array<Record<string, unknown>>;
    eventsAny?: Array<Record<string, unknown>>;
    eventsAbsent?: Array<Record<string, unknown>>;
    projection?: Record<string, unknown>;
    tone?: { secondPerson?: boolean; negativeVocabAbsent?: boolean };
    rubric?: Record<string, boolean>;
    narrationAny?: string[];
    narrationAbsent?: string[];
  };
  _meta?: { narrator?: string; matrix?: string };
}

interface AssertionResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface ScenarioResult {
  id: string;
  status: "passed" | "failed" | "skipped";
  assertions: AssertionResult[];
  narration?: string;
  reason?: string;
}

const SCENARIOS_DIR = join(process.cwd(), "eval", "scenarios");
const RUNS_DIR = join(process.cwd(), "eval", "runs");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[eval] DATABASE_URL is not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client) as unknown as Db;

  const scenarios = loadScenarios();
  if (scenarios.length === 0) {
    console.log("[eval] no scenarios authored.");
    await client.end();
    return;
  }

  console.log(`[eval] running ${scenarios.length} scenarios…\n`);
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const r = await runScenario(db, client, scenario);
    results.push(r);
    const summary = r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : "—";
    console.log(`${summary} ${r.id}${r.reason ? ` — ${r.reason}` : ""}`);
    for (const a of r.assertions) {
      const mark = a.passed ? "  ✓" : "  ✗";
      console.log(`${mark} ${a.name}${a.detail ? ` (${a.detail})` : ""}`);
    }
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(
    `\n[eval] ${passed} passed, ${failed} failed, ${skipped} skipped (of ${results.length})`,
  );

  writeReport(results);
  await client.end();
  if (failed > 0) process.exit(1);
}

function loadScenarios(): Scenario[] {
  if (!existsSync(SCENARIOS_DIR)) return [];
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf8")) as Scenario;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`failed to parse ${f}: ${message}`);
      }
    });
}

async function runScenario(
  db: Db,
  client: postgres.Sql,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const narratorMode = scenario._meta?.narrator ?? "any";
  if (narratorMode === "remote" && !process.env.ANTHROPIC_API_KEY) {
    return {
      id: scenario.id,
      status: "skipped",
      assertions: [],
      reason: "remote narrator requires ANTHROPIC_API_KEY",
    };
  }

  const formId = scenario.setup.formId ?? "lesser-slime";
  const locationId = scenario.setup.locationId ?? "collapsed-tunnel";
  const form = loadForm(formId);
  const location = loadLocation(locationId);
  const beatPack = loadBeatPack("survive-the-night");

  // Clean dev DB.
  await client.unsafe(
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  _resetSessionCacheForTests();

  // Create session row directly (no createSession's random-seed
  // session.started event — we want the scenario's deterministic seed).
  const sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `eval-${sessionId}`,
    formId,
  });
  // Seed events from the scenario verbatim. session.started carries
  // the scenario's PRNG seed and lives in seq=1.
  if (scenario.setup.events.length > 0) {
    await appendEvents(db, sessionId, scenario.setup.events as never);
  }
  const created = { sessionId };

  const narrator = new TemplateNarrator({ form, location });
  let narration = "";
  let result;
  try {
    result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: scenario.input,
      form,
      location,
      narrator,
      beatPack,
      rollOverride: scenario.rollOverride,
    });
    if (result.ok) narration = result.narration;
  } catch (err) {
    return {
      id: scenario.id,
      status: "failed",
      assertions: [
        {
          name: "runTurn",
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  const events = (await readLog(db, created.sessionId)).map(rowToEvent);
  const projection = result.ok ? result.projection : null;

  const assertions: AssertionResult[] = [];

  if (scenario.expected?.events) {
    for (const [i, expected] of scenario.expected.events.entries()) {
      const found = events.find((e) => matchesEvent(e, expected));
      assertions.push({
        name: `events[${i}].kind=${expected.kind ?? "?"}`,
        passed: !!found,
      });
    }
  }
  if (scenario.expected?.eventsAny) {
    const any = scenario.expected.eventsAny.some((expected) =>
      events.some((e) => matchesEvent(e, expected)),
    );
    assertions.push({ name: "eventsAny", passed: any });
  }
  if (scenario.expected?.eventsAbsent) {
    for (const [i, expected] of scenario.expected.eventsAbsent.entries()) {
      const found = events.find((e) => matchesEvent(e, expected));
      assertions.push({
        name: `eventsAbsent[${i}].kind=${expected.kind ?? "?"}`,
        passed: !found,
      });
    }
  }
  if (scenario.expected?.projection && projection) {
    for (const [path, expected] of Object.entries(scenario.expected.projection)) {
      const actual = pluck(projection, path);
      assertions.push({
        name: `projection.${path}=${JSON.stringify(expected)}`,
        passed: matchesValue(actual, expected),
        detail: `actual=${JSON.stringify(actual)}`,
      });
    }
  }

  const failed = assertions.some((a) => !a.passed);
  return {
    id: scenario.id,
    status: failed ? "failed" : "passed",
    assertions,
    narration,
  };
}

function matchesEvent(event: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(expected)) {
    if (k.startsWith("_")) continue;
    const actual = pluck(event, k);
    if (!matchesValue(actual, v)) return false;
  }
  return true;
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string") {
    if (expected.startsWith(">=")) return Number(actual) >= Number(expected.slice(2));
    if (expected.startsWith("<=")) return Number(actual) <= Number(expected.slice(2));
    if (expected.startsWith(">")) return Number(actual) > Number(expected.slice(1));
    if (expected.startsWith("<")) return Number(actual) < Number(expected.slice(1));
    return String(actual) === expected;
  }
  return actual === expected;
}

function pluck(obj: unknown, path: string): unknown {
  // Special path: .length on arrays
  if (path.endsWith(".length")) {
    const v = pluck(obj, path.slice(0, -".length".length));
    return Array.isArray(v) ? v.length : 0;
  }
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return undefined;
  }
  return cur;
}

function writeReport(results: ScenarioResult[]) {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(RUNS_DIR, stamp);
  mkdirSync(dir, { recursive: true });
  const md = renderMarkdown(results);
  writeFileSync(join(dir, "report.md"), md);
  for (const r of results) writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r, null, 2));
  console.log(`\n[eval] report → ${join(dir, "report.md")}`);
}

function renderMarkdown(results: ScenarioResult[]): string {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const lines: string[] = [
    "# Eval run",
    "",
    `**${passed}** passed · **${failed}** failed · **${skipped}** skipped (of ${results.length})`,
    "",
    "| # | Status | ID | Assertions |",
    "|---|---|---|---|",
  ];
  for (const r of results) {
    const a =
      r.assertions.length === 0
        ? "—"
        : `${r.assertions.filter((x) => x.passed).length}/${r.assertions.length}`;
    lines.push(`| ${r.id} | ${r.status} | ${r.id} | ${a} |`);
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error("[eval] error:", err);
  process.exit(1);
});
