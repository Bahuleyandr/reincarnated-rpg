/**
 * Lore judge — decides whether a just-ended run was world-changing
 * enough to write into the global world_lore ledger.
 *
 * Two layers:
 *   1. Cheap heuristic pre-filter (no LLM call). Most runs (a quiet
 *      death in turn 3, a player who just walked around for 5 turns)
 *      get rejected here.
 *   2. Haiku-tier LLM judge for survivors. Scores 0-1 on whether
 *      this is the kind of event a city's archives would record;
 *      proposes a category, tags, and a canonical 1-2 sentence
 *      summary plus optional richer prose for the public feed.
 *
 * Threshold: salience ≥ 0.6 → promote. The judge is conservative
 * by prompt design; we want few-but-meaningful entries in the
 * lore ledger. Spam would dilute every player's narrator prompt.
 *
 * Cost: a passing pre-filter + 1 Haiku call (~$0.0003) per
 * lore-candidate run. With realistic runs (~10-20% pass the
 * pre-filter), that's pennies per 1k runs.
 */
import type { AIProvider, ProviderTool } from "../ai/provider";
import { getProvider } from "../ai/factory";
import type { Db } from "../db/client";
import { recordAiCall } from "../util/ai-telemetry";
import { log } from "../util/log";
import type { Event } from "../game/types";

export interface JudgmentResult {
  salient: boolean;
  salience: number;
  category: string | null;
  tags: string[];
  summary: string;
  prose: string | null;
}

/**
 * Cheap pre-filter — runs without an LLM call. Returns true if this
 * run is even worth showing the judge.
 *
 * Rules (any one passes):
 *   - run completed (not died/capped) AND fired ≥1 beat → outcome:win
 *     OR a quest objective was completed
 *   - any wyrm_marked event with cumulative ≥2
 *   - any 'completed:<objective>' tag
 *   - turn count ≥ 8 AND outcome wasn't 'cap' (substantive run, not
 *     just a player who afk'd)
 *
 * We deliberately reject:
 *   - very short runs (≤3 turns)
 *   - cap outcome with no progress (afk)
 *   - death runs at turn 1-2 (player got dropped on a hostile NPC
 *     and didn't act)
 */
export function lorePreFilter(
  events: Event[],
  context: { turn: number; outcome: string | null; beatsFired: number },
): boolean {
  if (context.turn <= 2) return false;
  if (context.outcome === "cap" && context.beatsFired === 0) return false;

  if (context.outcome === "win") return true;
  if (context.beatsFired >= 1) return true;

  let questCompletions = 0;
  let wyrmMarked = 0;
  for (const e of events) {
    if (e.kind === "quest.objectiveUpdated" && e.status === "done")
      questCompletions += 1;
    if (
      e.kind === "form_state.changed" &&
      e.field === "wyrm_marked" &&
      e.delta > 0
    )
      wyrmMarked += e.delta;
  }
  if (questCompletions >= 1) return true;
  if (wyrmMarked >= 2) return true;
  if (context.turn >= 8 && context.outcome !== "cap") return true;
  return false;
}

const JUDGE_TOOL: ProviderTool = {
  name: "judge_lore",
  description:
    "Score whether this run was a world-changing event worth recording in a city's archives.",
  input_schema: {
    type: "object",
    properties: {
      salience: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "0..1. ≥0.6 means a chronicler in a nearby city would write this down. Be conservative.",
      },
      category: {
        type: "string",
        enum: [
          "city-event",
          "artifact",
          "npc-fate",
          "cult",
          "plague",
          "wyrm-event",
          "natural-disaster",
          "discovery",
          "other",
        ],
        description: "Best-fit category for the event.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "1-4 short tags (lowercase, hyphenated) summarizing the event's notable elements.",
      },
      summary: {
        type: "string",
        description:
          "1-2 sentence canonical summary the narrator can quote. Past tense. Third person. Specific NPC names allowed; specific player handles forbidden.",
      },
      prose: {
        type: "string",
        description:
          "Optional 2-4 sentence richer prose for the public lore feed. Same constraints as summary.",
      },
    },
    required: ["salience", "category", "tags", "summary"],
  },
};

interface JudgeOpts {
  provider?: AIProvider;
  model?: string;
  telemetry?: {
    db: Db;
    sessionId?: string;
    userId?: string | null;
    presetId?: string | null;
  };
}

/**
 * Run the lore judge on a candidate run. Caller is expected to have
 * already passed `lorePreFilter`. Returns null on judge failure
 * (network / parse) — caller treats null as "not promoted".
 */
export async function judgeLore(
  events: Event[],
  context: {
    formId: string;
    locationId: string;
    reincarnatedAs: string | null;
    outcome: string | null;
    turn: number;
    npcsIntroduced: string[];
    questsCompleted: string[];
    wyrmPhase: string | null;
  },
  opts: JudgeOpts = {},
): Promise<JudgmentResult | null> {
  const provider = opts.provider ?? getProvider();
  const model = opts.model ?? "claude-haiku-4-5";

  const narrations = events
    .filter((e) => e.kind === "narration.emitted")
    .map((e) => (e as { kind: "narration.emitted"; text: string }).text);
  const lastTwoNarrations = narrations.slice(-2).join("\n\n");

  const summary = `Form: ${context.formId}
Reincarnated as: ${context.reincarnatedAs ?? "(default)"}
Location: ${context.locationId}
Outcome: ${context.outcome ?? "ongoing"}
Turns: ${context.turn}
NPCs met: ${context.npcsIntroduced.join(", ") || "(none)"}
Quests completed: ${context.questsCompleted.join(", ") || "(none)"}
World phase: ${context.wyrmPhase ?? "stirring"}

Last narration excerpts:
${lastTwoNarrations || "(none)"}

Score this run for lore promotion. Reject most. Only the few events
that would change a city's, kingdom's, or guild's understanding of
the world should score ≥0.6. A player saving a kitten, finding a
coin, walking through a market — these score below 0.4. A player
killing a known NPC at a pivotal moment, finding an artifact, ending
a plague, or marking themselves twice with the wyrm — these can score
≥0.6 if the run was substantive.

If this is a typed-form run that completed its scripted arc with a
'win' outcome AND beats fired, that is presumptive evidence of
significance — score ≥0.6 unless the prose suggests otherwise.

Be conservative. Few-but-meaningful entries make the lore ledger
useful; spam dilutes it.`;

  const t0 = Date.now();
  try {
    const response = await provider.complete({
      model,
      maxTokens: 512,
      tools: [JUDGE_TOOL],
      toolChoice: { type: "tool", name: "judge_lore" },
      messages: [{ role: "user", content: summary }],
    });
    if (opts.telemetry?.db) {
      await recordAiCall(opts.telemetry.db, {
        sessionId: opts.telemetry.sessionId,
        userId: opts.telemetry.userId,
        presetId: opts.telemetry.presetId,
        callType: "lore_judge",
        model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheCreateTokens: response.usage.cacheCreateTokens,
        durationMs: Date.now() - t0,
      });
    }
    const tool = response.toolUses.find((t) => t.name === "judge_lore");
    if (!tool) return null;
    const data = tool.input as {
      salience: number;
      category: string;
      tags: string[];
      summary: string;
      prose?: string;
    };
    const salience = Math.max(0, Math.min(1, Number(data.salience) || 0));
    return {
      salient: salience >= 0.6,
      salience,
      category: data.category ?? null,
      tags: Array.isArray(data.tags)
        ? data.tags.map((s) => String(s).slice(0, 40))
        : [],
      summary: String(data.summary).slice(0, 500),
      prose: data.prose ? String(data.prose).slice(0, 1500) : null,
    };
  } catch (err) {
    if (opts.telemetry?.db) {
      await recordAiCall(opts.telemetry.db, {
        sessionId: opts.telemetry.sessionId,
        userId: opts.telemetry.userId,
        presetId: opts.telemetry.presetId,
        callType: "lore_judge",
        model,
        durationMs: Date.now() - t0,
        success: false,
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
    log.warn("lore.judge_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
