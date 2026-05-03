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

const SUCCESS_PHRASES: Record<string, string[]> = {
  absorb: [
    "You fold the morsel into your essence; the chemistry of it is welcome.",
    "Your forward edge envelops the thing and dissolves what it carries.",
  ],
  ooze: [
    "You let your forward edge thin and pour yourself ahead.",
    "Gravity does most of the deciding; you merely permit it.",
  ],
  split: [
    "You think two thoughts at once. Briefly, you are two boundaries around one essence.",
  ],
  sense_tremor: [
    "You let your boundary widen; the room writes itself across your awareness.",
  ],
  dissolve: [
    "Your acids find weakness in the matter and unmake it without ceremony.",
  ],
  smother: [
    "You spread across what breathes and let it breathe nothing.",
  ],
  mimic_shape: [
    "Your boundary remembers the shape of stillness, and you become a part of the floor.",
  ],
  wait: [
    "You remain very still. Time passes through you like water.",
  ],
};

const PARTIAL_PHRASES: Record<string, string[]> = {
  absorb: [
    "The absorb begins, then the wrongness arrives.",
  ],
  ooze: [
    "You move, but the floor's chemistry pulls a piece of you the wrong direction.",
  ],
  split: [
    "Two of you persist for an instant; one of you remembers something the other cannot.",
  ],
  sense_tremor: [
    "Your awareness widens, and the answers it returns are not the ones you wanted.",
  ],
  dissolve: [
    "You weaken the matter, but a vapor rises from the breakdown that you cannot ignore.",
  ],
  smother: [
    "You pin the breath, but its panic carries on a chemistry you taste long after.",
  ],
  mimic_shape: [
    "You keep the shape, mostly. A small portion of you remains a slime.",
  ],
  wait: [
    "Time passes through you, and not all of it leaves you unchanged.",
  ],
};

const MISS_PHRASES: Record<string, string[]> = {
  absorb: [
    "Whatever you reached for slips your boundary and is gone, and worse comes after.",
  ],
  ooze: [
    "You go, but the going makes a sound, and something is now listening.",
  ],
  split: [
    "The split fails. You remain one, but one cohered around a wound.",
  ],
  sense_tremor: [
    "Your boundary widens, and the cavern writes silence across your awareness, and that, too, is information.",
  ],
  dissolve: [
    "Your acids waste themselves on the wrong thing.",
  ],
  smother: [
    "Whatever you spread across had no breath to take.",
  ],
  mimic_shape: [
    "Your boundary refuses the shape; you are wholly yourself, in the wrong place.",
  ],
  wait: [
    "Time passes. Time does not care about you.",
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
        text: pickPhrase(verb, band, input.roll.seed ^ 0x1),
        toolCalls: [{ name: "narrate_only" }],
      };
    }

    const text = pickPhrase(verb, band, input.roll.seed);
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

function pickPhrase(verb: string, band: RollBand, seed: number): string {
  const bank =
    band === "success"
      ? SUCCESS_PHRASES
      : band === "partial"
        ? PARTIAL_PHRASES
        : MISS_PHRASES;
  const list = bank[verb] ?? bank.wait ?? ["You hold."];
  const idx = Math.abs(seed | 0) % list.length;
  return list[idx];
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
        const room = location.rooms.find(
          (r) => r.id === projection.location.roomId,
        );
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
        if (item)
          out.push({ name: "remove_inventory", itemId: item.itemId, qty: 1 });
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
        const cur = location.rooms.find(
          (r) => r.id === projection.location.roomId,
        );
        const exit = cur?.exits[0];
        if (!exit) return null;
        return { name: "move_to", roomId: exit.toRoomId };
      }
      return { name: "move_to", roomId };
    }
    case "absorb": {
      const itemId = String(raw.itemId ?? "");
      if (itemId === "$ITEM") {
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
    default:
      return null;
  }
}
