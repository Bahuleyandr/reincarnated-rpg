/**
 * TemplateNarrator — deterministic phrase-bank narrator.
 *
 * Used as the M1 default and for tests/evals where we need
 * reproducibility without hitting Anthropic. The quality target is
 * "tonally on-form, mechanically correct, not creative". The
 * RemoteNarrator (Day 8) replaces it for the player-facing build.
 *
 * Tool selection:
 *   - On `success`: emit the verb's primary tools straight from the
 *     form template's `verbMappings`. Default field values are filled
 *     from projection state where unambiguous (e.g. move_to → first
 *     exit from current room).
 *   - On `partial`: emit primary tools + one hardMove from the form's
 *     `hardMoves` menu, picked deterministically by `roll.seed`.
 *   - On `miss`: emit a hardMove only. (Damage to $SELF is implicit.)
 *
 * The narrator never invents entities; tools that need an entity ID
 * (introduce_npc, update_relationship) are emitted via hardMoves which
 * reference templateIds from the form sheet.
 */
import type {
  FormTemplate,
  LocationTemplate,
  NarrateInput,
  NarrateOutput,
  Narrator,
  Projection,
  RollBand,
  ToolCall,
} from "../game/types";

interface TemplateNarratorArgs {
  form: FormTemplate;
  location: LocationTemplate;
}

interface VerbMapping {
  tools: string[];
  rollStat: string | null;
}

interface HardMove {
  id: string;
  narrative: string;
  tools: Array<Record<string, unknown> & { name: string }>;
}

interface SlimeFormJson extends FormTemplate {
  verbMappings: Record<string, VerbMapping>;
  hardMoves: { rule: string; moves: HardMove[] };
}

// Form-specific phrase banks now live in the form JSON's `phraseBank`
// field (see content/forms/<form>.json and FormTemplate.phraseBank).
// `pickPhrase` reads from the form template at runtime and falls
// back to GENERIC_FALLBACKS for verbs the form's bank doesn't cover.

/**
 * Generic fallback lines for verbs the form's phrase banks don't
 * cover. The trial run made the narrator's repetition obvious — a
 * dungeon-core trying "claim this room as my domain" hit the same
 * "Time does not care about you." line over and over.
 *
 * `{verb}` is replaced with the player's input verb, lower-cased, so
 * the player at least sees their action echoed. Each band has 6+
 * lines so a normal session doesn't recycle them visibly.
 */
const GENERIC_FALLBACKS: Record<RollBand, string[]> = {
  success: [
    "The {verb} lands. The world bends, and stays bent.",
    "You {verb}, and what answers you is not the world resisting.",
    "The {verb} works. Something downstream notices.",
    "You commit, and the {verb} commits with you.",
    "The shape of {verb} holds. The room is changed by a degree.",
    "You {verb}, and the doing of it is reflected back at you, intact.",
  ],
  partial: [
    "You {verb}, but only most of it lands.",
    "The {verb} half-takes. The other half is somewhere you cannot see.",
    "You {verb}; the world meets you halfway, and asks for a price.",
    "The {verb} works, and pulls something with it that you did not intend.",
    "You commit to {verb}, and find the act has costs you didn't read on the page.",
    "The {verb} lands at an angle. You feel it settle wrong.",
  ],
  miss: [
    "You reach for {verb}, and the world refuses to translate.",
    "The {verb} does not catch.",
    "You try to {verb}; the moment slips by without committing to either of you.",
    "The {verb} fails, and the failing makes a small sound.",
    "You will {verb}, and the world does not. Time passes.",
    "The {verb} comes apart in your attention before it leaves you.",
  ],
};

export class TemplateNarrator implements Narrator {
  private form: SlimeFormJson;
  private location: LocationTemplate;

  constructor(args: TemplateNarratorArgs) {
    this.form = args.form as SlimeFormJson;
    this.location = args.location;
  }

  async narrate(input: NarrateInput): Promise<NarrateOutput> {
    const verb = input.intent;
    const band = input.roll.band;

    // On retry: emit narrate_only with a slightly different phrase. The
    // hardMove menu is deterministic on (form, seed); re-running it picks
    // the same broken move that triggered the retry. narrate_only is a
    // safe fallback — the orchestrator already applied prior tools (tone
    // path) or rolled them back (tool-validation path).
    if (input.previousAttempt) {
      return {
        text: pickPhrase(this.form, verb, band, input.roll.seed ^ 0x1),
        toolCalls: [{ name: "narrate_only" }],
      };
    }

    const text = pickPhrase(this.form, verb, band, input.roll.seed);
    const toolCalls = toolsFor(
      verb,
      band,
      input.roll.seed,
      input.projection,
      this.form,
      this.location,
    );
    return { text, toolCalls };
  }
}

function pickPhrase(
  form: FormTemplate,
  verb: string,
  band: RollBand,
  seed: number,
): string {
  // 1. The form's own phraseBank is preferred. Each verb has up to
  //    3 lists (success / partial / miss). A `wait` entry doubles
  //    as the "no specific verb match" fallback within the form.
  const bank = form.phraseBank;
  if (bank) {
    const verbBank = bank[verb] ?? bank.wait;
    const list = verbBank?.[band];
    if (list && list.length > 0) {
      const idx = Math.abs(seed | 0) % list.length;
      return list[idx];
    }
  }
  // 2. Generic fallback — substitute the player's verb so the prose
  //    at least echoes the action they took. Used for any form
  //    that doesn't ship a phraseBank, or for verbs outside it.
  const generic = GENERIC_FALLBACKS[band];
  const idx = Math.abs(seed | 0) % generic.length;
  return generic[idx].replace("{verb}", normaliseVerb(verb));
}

/** Strip noise from raw input verbs so they read in prose. The
 *  classifier may pass through multi-word actions like
 *  "claim this room"; we keep the leading verb and lower-case. */
function normaliseVerb(verb: string): string {
  if (!verb) return "act";
  const trimmed = verb.trim().toLowerCase();
  // Most verbs come through as a single token from the classifier.
  // For multi-word inputs, take the first word so the sentence
  // reads cleanly ("you claim ..." rather than "you claim this
  // room as my domain ...").
  return trimmed.split(/\s+/)[0] || "act";
}

function toolsFor(
  verb: string,
  band: RollBand,
  seed: number,
  projection: Projection,
  form: SlimeFormJson,
  location: LocationTemplate,
): ToolCall[] {
  const mapping = form.verbMappings?.[verb];
  const out: ToolCall[] = [];

  if (band === "success" && mapping) {
    out.push(...primaryToolsFor(mapping.tools, projection, location));
  } else if (band === "partial") {
    if (mapping) out.push(...primaryToolsFor(mapping.tools, projection, location));
    const move = pickHardMove(form, seed);
    if (move) out.push(...resolveHardMove(move, projection, location));
  } else {
    // miss
    const move = pickHardMove(form, seed);
    if (move) out.push(...resolveHardMove(move, projection, location));
    else
      out.push({
        name: "apply_damage",
        target: "$SELF",
        amount: 1,
        source: `miss-${verb}`,
      });
  }

  if (out.length === 0) out.push({ name: "narrate_only" });
  return out;
}

function primaryToolsFor(
  toolNames: string[],
  projection: Projection,
  location: LocationTemplate,
): ToolCall[] {
  const out: ToolCall[] = [];
  for (const name of toolNames) {
    switch (name) {
      case "move_to": {
        const room = location.rooms.find((r) => r.id === projection.location.roomId);
        const exit = room?.exits[0];
        if (exit) out.push({ name: "move_to", roomId: exit.toRoomId });
        break;
      }
      case "pass_time":
        out.push({ name: "pass_time", ticks: 1 });
        break;
      case "sense":
        out.push({
          name: "sense",
          modality: "vibration",
          detail: "the deep, slow weight of stone",
        });
        break;
      case "absorb": {
        const item = projection.inventory[0];
        if (item) out.push({ name: "absorb", itemId: item.itemId, into: "essence" });
        break;
      }
      case "remove_inventory": {
        const item = projection.inventory[0];
        if (item) out.push({ name: "remove_inventory", itemId: item.itemId, qty: 1 });
        break;
      }
      case "apply_damage":
        // Default damage on success: minor self-cost (slime acid backsplash).
        out.push({
          name: "apply_damage",
          target: "$SELF",
          amount: 0,
          source: "self-spend",
        });
        break;
      case "change_form_state":
        out.push({
          name: "change_form_state",
          field: "exposed",
          delta: 0,
        });
        break;
      case "introduce_npc":
        // Introduce_npc requires a templateId we don't have in context;
        // skip on success and let hardMoves handle the predator paths.
        break;
    }
  }
  return out;
}

function pickHardMove(form: SlimeFormJson, seed: number): HardMove | null {
  const moves = form.hardMoves?.moves ?? [];
  if (moves.length === 0) return null;
  return moves[Math.abs(seed | 0) % moves.length];
}

function resolveHardMove(
  move: HardMove,
  projection: Projection,
  location: LocationTemplate,
): ToolCall[] {
  const out: ToolCall[] = [];
  for (const t of move.tools) {
    const concrete = concretizeMoveTool(t, projection, location);
    if (concrete) out.push(concrete);
  }
  return out;
}

function concretizeMoveTool(
  raw: Record<string, unknown> & { name: string },
  projection: Projection,
  location: LocationTemplate,
): ToolCall | null {
  // Resolve $WRONG_ROOM / $ITEM / $SELF placeholders found in slime
  // hardMoves to concrete values from projection. Skip the tool if no
  // resolution is possible.
  switch (raw.name) {
    case "change_form_state":
      return {
        name: "change_form_state",
        field: String(raw.field ?? "exposed"),
        delta: Number(raw.delta ?? 0),
      };
    case "introduce_npc":
      return {
        name: "introduce_npc",
        templateId: String(raw.templateId ?? "tunnel-predator"),
        attitude: Number(raw.attitude ?? -2),
      };
    case "move_to": {
      const roomId = String(raw.roomId ?? "");
      if (roomId === "$WRONG_ROOM") {
        // Pick any non-current adjacent room.
        const cur = location.rooms.find((r) => r.id === projection.location.roomId);
        const exit = cur?.exits[0];
        if (!exit) return null;
        return { name: "move_to", roomId: exit.toRoomId };
      }
      return { name: "move_to", roomId };
    }
    case "absorb": {
      const itemId = String(raw.itemId ?? "");
      if (itemId.startsWith("$")) {
        const item = projection.inventory[0];
        if (!item) return null;
        return { name: "absorb", itemId: item.itemId, into: String(raw.into ?? "essence") };
      }
      return { name: "absorb", itemId, into: String(raw.into ?? "essence") };
    }
    case "apply_damage": {
      const target = String(raw.target ?? "$SELF");
      return {
        name: "apply_damage",
        target,
        amount: Number(raw.amount ?? 1),
        source: String(raw.source ?? "hard-move"),
      };
    }
    case "pass_time":
      return { name: "pass_time", ticks: Number(raw.ticks ?? 1) };
    case "sense":
      return {
        name: "sense",
        modality: "vibration",
        detail: String(raw.detail ?? raw.tag ?? "the room answers faintly"),
      };
    default:
      return null;
  }
}
