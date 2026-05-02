import "../scripts/load-env";

/**
 * Eval runner — Day 4 skeleton.
 *
 * The full runner (drives the turn loop, asserts emitted events,
 * computes the rubric, calls the LLM-as-judge) lands incrementally:
 *   - Day 4 (this file): load + validate scenarios, exit clean.
 *   - Day 6: when turn.ts is wired, drive a real turn loop and assert
 *     `expected.events` matches.
 *   - Day 12: judge.ts integration; rubric scoring.
 *
 * Today's job: prove the scenario JSON shape parses and the
 * coverage-matrix names are unique.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCENARIOS_DIR = join(process.cwd(), "eval", "scenarios");

interface Scenario {
  id: string;
  setup: { events: unknown[] };
  input: string;
  rollOverride?: { d1: number; d2: number; mod: number };
  expected: {
    events?: unknown[];
    projection?: Record<string, unknown>;
    tone?: { secondPerson?: boolean; negativeVocabAbsent?: boolean };
    rubric?: Record<string, boolean>;
  };
}

function loadScenarios(): Scenario[] {
  if (!existsSync(SCENARIOS_DIR)) {
    throw new Error(`scenarios dir does not exist: ${SCENARIOS_DIR}`);
  }
  const files = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const raw = readFileSync(join(SCENARIOS_DIR, f), "utf8");
    const parsed = JSON.parse(raw) as Scenario;
    if (!parsed.id) throw new Error(`${f}: missing id`);
    if (!parsed.setup) throw new Error(`${f}: missing setup`);
    if (typeof parsed.input !== "string") {
      throw new Error(`${f}: input must be string`);
    }
    if (!parsed.expected) throw new Error(`${f}: missing expected`);
    return parsed;
  });
}

async function main() {
  const scenarios = loadScenarios();
  if (scenarios.length === 0) {
    console.log("[eval] no scenarios authored yet — exiting.");
    return;
  }

  const ids = new Set<string>();
  for (const s of scenarios) {
    if (ids.has(s.id)) throw new Error(`duplicate scenario id: ${s.id}`);
    ids.add(s.id);
  }

  console.log(`[eval] loaded ${scenarios.length} scenario(s):`);
  for (const s of scenarios) {
    console.log(`  - ${s.id}  (${s.input.slice(0, 60)}...)`);
  }
  console.log(
    `[eval] runner is a skeleton — actual turn-loop integration lands on Day 6.`,
  );
}

main().catch((err) => {
  console.error("[eval] error:", err);
  process.exit(1);
});
