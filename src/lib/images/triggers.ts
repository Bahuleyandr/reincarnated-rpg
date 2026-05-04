/**
 * Pure: which events on a turn warrant a scene image?
 *
 * Triggers are deliberately sparse — high-impact moments only.
 * Five categories for v1:
 *   - "awakening"   — first turn of a campaign (turn === 1)
 *   - "first_npc"   — the turn an NPC first appears in this run
 *   - "death"       — session.ended.reason === "death"
 *   - "win"         — session.ended.reason === "won"
 *   - "wyrm_fell"   — the turn a contribution dropped Wyrm HP to 0
 *
 * Returns an array of (trigger, prompt) pairs. The caller decides
 * whether to actually queue a provider call (after consulting the
 * cost-gate and the user's opt-in flag).
 *
 * The prompts are evocative but cheap (deterministic templating).
 * No LLM call here — that would defeat the whole point of "cost-
 * gated". A provider's image model takes the prompt as-is.
 */
import type { Event } from "../game/types";

export interface SceneTrigger {
  trigger: "awakening" | "first_npc" | "death" | "win" | "wyrm_fell";
  prompt: string;
  turn: number;
}

interface PromptContext {
  formId: string;
  locationId: string;
  reincarnatedAs: string | null;
  turn: number;
}

export function detectSceneTriggers(
  events: readonly Event[],
  hasNpcsAlready: boolean,
  ctx: PromptContext,
): SceneTrigger[] {
  const out: SceneTrigger[] = [];
  const turn = ctx.turn;

  // Awakening — only on turn 1.
  if (turn === 1) {
    out.push({
      trigger: "awakening",
      turn,
      prompt: awakeningPrompt(ctx),
    });
  }

  // First NPC — if we have npc.introduced events AND there were
  // none before this turn.
  if (!hasNpcsAlready) {
    const intro = events.find((e) => e.kind === "npc.introduced");
    if (intro && intro.kind === "npc.introduced") {
      out.push({
        trigger: "first_npc",
        turn,
        prompt: firstNpcPrompt(intro.data?.name ?? "a stranger", ctx),
      });
    }
  }

  // Session ended.
  for (const e of events) {
    if (e.kind === "session.ended") {
      if (e.reason === "death") {
        out.push({ trigger: "death", turn, prompt: deathPrompt(ctx) });
      } else if (e.reason === "win") {
        out.push({ trigger: "win", turn, prompt: winPrompt(ctx) });
      }
    }
  }

  return out;
}

function subjectOf(ctx: PromptContext): string {
  if (ctx.reincarnatedAs && ctx.reincarnatedAs.trim().length > 0) {
    return ctx.reincarnatedAs.trim();
  }
  // Form fallback prose.
  switch (ctx.formId) {
    case "lesser-slime":
      return "a glistening lesser slime";
    case "cursed-book":
      return "an open cursed book, pages turning of their own accord";
    case "dragon-egg":
      return "a dragon's egg, faint glow within";
    case "dungeon-core":
      return "a faceted dungeon core, light pulsing";
    case "healer":
      return "a wandering healer, hands wrapped in faded cloth";
    default:
      return "an unnamed soul reborn";
  }
}

function locationOf(ctx: PromptContext): string {
  return ctx.locationId.replace(/-/g, " ");
}

function awakeningPrompt(ctx: PromptContext): string {
  return `${subjectOf(ctx)} awakens in ${locationOf(ctx)}. dim atmospheric lighting, rough hewn stone, painterly fantasy illustration, no text.`;
}

function firstNpcPrompt(npcName: string, ctx: PromptContext): string {
  return `${npcName} appears before ${subjectOf(ctx)} in ${locationOf(ctx)}. encounter scene, painterly fantasy illustration, atmospheric, no text.`;
}

function deathPrompt(ctx: PromptContext): string {
  return `${subjectOf(ctx)} ends. ${locationOf(ctx)} bears witness. somber composition, dim red-blue lighting, painterly fantasy illustration, no text.`;
}

function winPrompt(ctx: PromptContext): string {
  return `${subjectOf(ctx)} stands triumphant in ${locationOf(ctx)}. dawn light breaking, hopeful composition, painterly fantasy illustration, no text.`;
}
