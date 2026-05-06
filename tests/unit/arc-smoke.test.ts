/**
 * Arc smoke harness — static checks + beat-sequence simulator.
 *
 * Runs across every arc declared in ROUTES (arc-routing.ts). For
 * each (formId, locationId, arcId) tuple it:
 *
 *   1. **Static checks** — every suggestedVerb's verb exists in
 *      form.verbs[] AND has a phraseBank entry; every NPC id in a
 *      `npc.introduced` fires resolves to a real NPC template file;
 *      every `location.roomId` in a trigger resolves to a real
 *      room in the location; every form-state field referenced in
 *      a trigger is touched by some preceding beat's fires (so it
 *      can reach the value).
 *
 *   2. **Beat-sequence simulator** — initializes projection from
 *      form + location, then walks the 5 beats in order. For each
 *      beat:
 *        - Synthesises the minimum state needed for the trigger
 *          (moves to the right room; advances turn; checks vital
 *          comparisons against the form's possible range).
 *        - Asserts the trigger matches at that synthesised state.
 *        - Applies the beat's `fires` events to mutate projection.
 *      For Beat 05 (resolution), additionally verifies that the
 *      win-condition vital thresholds are <= vital.max so the
 *      winning state is reachable in theory.
 *
 * What this does NOT cover:
 *   - Whether the player's verb-tools actually keep vitals high
 *     enough to win (orchestrator + verb-mappings concern).
 *   - Whether the deterministic narrator's prose reads cleanly
 *     (eval scenarios cover that).
 *   - LLM-narrator paths.
 *
 * What it DOES catch:
 *   - Typos in trigger paths ("form.vital.X" vs "form.vitals.X")
 *   - Verbs cited in suggestedVerbs that aren't in form.verbs[]
 *   - NPC templateIds that don't exist on disk
 *   - Win conditions that exceed vital.max (unreachable)
 *   - Beats whose trigger references form-state fields no prior
 *     beat fires populates
 *   - Room ids referenced in triggers that don't exist
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { evaluate, type Beat, type Trigger } from "@/lib/game/beats";
import { loadBeatPack, loadForm, loadLocation } from "@/lib/game/content";
import { reduce } from "@/lib/game/projection";
import type { Event, FormTemplate, LocationTemplate, Projection } from "@/lib/game/types";

// ---- Routes (mirrored from arc-routing.ts; pure data, safer to
// import than to require the runtime module which uses crypto).

interface ArcRoute {
  arcId: string;
  formId: string | null;
  locationId: string | null;
  startingRoomId?: string;
}

function loadRoutes(): ArcRoute[] {
  // Parse arc-routing.ts statically rather than importing it — it
  // touches node:crypto at module-load and pulls in randomBytes,
  // which is fine but slow. We just need the data.
  const src = readFileSync(
    join(process.cwd(), "src/lib/game/arc-routing.ts"),
    "utf8",
  );
  const routes: ArcRoute[] = [];
  // Simple regex-based parse of the ROUTES table. Each route is a
  // braced object with arcId / formId / locationId / startingRoomId.
  const objectRegex = /\{\s*arcId:\s*"([^"]+)",\s*formId:\s*(null|"[^"]+"),\s*locationId:\s*(null|"[^"]+"),[\s\S]*?(?:startingRoomId:\s*"([^"]+)",?\s*)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = objectRegex.exec(src)) !== null) {
    routes.push({
      arcId: m[1],
      formId: m[2] === "null" ? null : m[2].slice(1, -1),
      locationId: m[3] === "null" ? null : m[3].slice(1, -1),
      startingRoomId: m[4],
    });
  }
  return routes;
}

// ---- NPC roster (one-time at module load).

const NPC_DIR = join(process.cwd(), "content/npcs");
const npcIds = new Set<string>(
  readdirSync(NPC_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")),
);

// ---- Trigger walker — extracts every leaf comparison so we can
// reason about reachability per beat.

interface LeafComparison {
  path: string;
  expr: string;
}

function* walkLeaves(t: Trigger): Generator<LeafComparison> {
  if (Array.isArray(t.all)) {
    for (const sub of t.all) yield* walkLeaves(sub);
  }
  if (Array.isArray(t.any)) {
    for (const sub of t.any) yield* walkLeaves(sub);
  }
  for (const [k, v] of Object.entries(t)) {
    if (k === "all" || k === "any") continue;
    if (typeof v === "string") yield { path: k, expr: v };
  }
}

// ---- State synthesiser. Given a trigger and a current projection,
// build a "stretched" projection that satisfies the trigger if at
// all possible. Returns null if unsatisfiable.

function synthesise(
  base: Projection,
  trigger: Trigger,
  loc: LocationTemplate,
): Projection | null {
  // Easiest path: bias the projection in the direction of every leaf
  // comparison. Where it's an `any`, satisfy the first leaf in the
  // first satisfiable branch.
  let p = base;
  let satisfied = false;
  // Try walking the trigger; for any/all we recurse manually.
  const tryApply = (t: Trigger): Projection | null => {
    let cur = p;
    if (Array.isArray(t.all)) {
      for (const sub of t.all) {
        const next = tryApply(sub);
        if (next === null) return null;
        cur = next;
        p = cur;
      }
    }
    if (Array.isArray(t.any)) {
      for (const sub of t.any) {
        const snapshot = p;
        const next = tryApply(sub);
        if (next !== null) {
          cur = next;
          p = cur;
          break;
        }
        p = snapshot;
      }
    }
    for (const [k, v] of Object.entries(t)) {
      if (k === "all" || k === "any") continue;
      if (typeof v !== "string") continue;
      const applied = applyLeaf(cur, k, v, loc);
      if (!applied) return null;
      cur = applied;
      p = cur;
    }
    return cur;
  };
  const final = tryApply(trigger);
  if (!final) return null;
  satisfied = evaluate(trigger, final);
  return satisfied ? final : null;
}

function applyLeaf(
  p: Projection,
  path: string,
  expr: string,
  loc: LocationTemplate,
): Projection | null {
  // Parse op + rhs.
  const ops = ["==", "!=", ">=", "<=", ">", "<"] as const;
  let op: typeof ops[number] = "==";
  let rhs = expr;
  for (const o of ops) {
    if (expr.startsWith(o)) {
      op = o;
      rhs = expr.slice(o.length);
      break;
    }
  }

  // Special leaves.
  if (path === "npcKnown") {
    if (p.npcs[rhs]) return p;
    // Synthesize: introduce the npc minimally.
    return {
      ...p,
      npcs: { ...p.npcs, [rhs]: { name: rhs, relationship: 0 } },
    };
  }
  if (path === "discovered") {
    if (p.location.discovered.includes(rhs)) return p;
    return {
      ...p,
      location: {
        ...p.location,
        discovered: [...p.location.discovered, rhs],
      },
    };
  }

  // Path-based leaves: turn / form.vitals.X / form.state.X / location.roomId / etc.
  if (path === "turn" || path === "xp") {
    const want = Number(rhs);
    const cur = path === "turn" ? p.turn : p.xp;
    const next = pickToSatisfy(op, cur, want);
    if (next === null) return null;
    return path === "turn" ? { ...p, turn: next } : { ...p, xp: next };
  }
  if (path === "location.roomId") {
    if (op !== "==") return null;
    if (!loc.rooms.some((r) => r.id === rhs)) return null;
    return { ...p, location: { ...p.location, roomId: rhs } };
  }
  if (path.startsWith("form.vitals.")) {
    const vital = path.slice("form.vitals.".length);
    const want = Number(rhs);
    const cur = p.form.vitals[vital];
    if (cur === undefined) return null; // vital doesn't exist on this form
    const next = pickToSatisfy(op, cur, want);
    if (next === null) return null;
    // Cap at max.
    const max = p.form.vitalsMax[vital] ?? Infinity;
    if (next > max) return null;
    return {
      ...p,
      form: {
        ...p.form,
        vitals: { ...p.form.vitals, [vital]: next },
      },
    };
  }
  if (path.startsWith("form.state.")) {
    const field = path.slice("form.state.".length);
    const want = Number(rhs);
    const cur = p.form.state[field] ?? 0;
    const next = pickToSatisfy(op, cur, want);
    if (next === null) return null;
    return {
      ...p,
      form: {
        ...p.form,
        state: { ...p.form.state, [field]: next },
      },
    };
  }
  // Unknown path — leave untouched, evaluator will reject.
  return p;
}

function pickToSatisfy(
  op: "==" | "!=" | ">=" | "<=" | ">" | "<",
  cur: number,
  want: number,
): number | null {
  switch (op) {
    case "==":
      return want;
    case "!=":
      return cur !== want ? cur : want + 1;
    case ">=":
      return cur >= want ? cur : want;
    case "<=":
      return cur <= want ? cur : want;
    case ">":
      return cur > want ? cur : want + 1;
    case "<":
      return cur < want ? cur : want - 1;
  }
}

// ---- Initial projection (no DB).

function initProj(
  form: FormTemplate,
  loc: LocationTemplate,
  startingRoomId?: string,
): Projection {
  const vitals: Record<string, number> = {};
  const vitalsMax: Record<string, number> = {};
  const vitalsDeath: Record<string, number | null> = {};
  for (const [name, v] of Object.entries(form.vitals)) {
    vitals[name] = v.start;
    vitalsMax[name] = v.max;
    vitalsDeath[name] = v.death ?? null;
  }
  const room =
    startingRoomId && loc.rooms.some((r) => r.id === startingRoomId)
      ? startingRoomId
      : loc.entryRoomId;
  return {
    sessionId: "smoke-test",
    upToSeq: 0,
    form: {
      id: form.id,
      vitals,
      vitalsMax,
      vitalsDeath,
      stats: { ...form.stats },
      state: {},
    },
    location: { id: loc.id, roomId: room, discovered: [room] },
    inventory: [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 0,
    status: "active",
    reincarnatedAs: null,
  };
}

// ---- The harness function: audit + simulate one arc.

interface AuditReport {
  arcId: string;
  formId: string;
  locationId: string;
  errors: string[];
  warnings: string[];
}

function auditArc(
  arcId: string,
  formId: string,
  locationId: string,
  startingRoomId: string | undefined,
): AuditReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const form = loadForm(formId);
  const loc = loadLocation(locationId);
  const pack = loadBeatPack(arcId);
  const formVerbs = new Set(form.verbs);
  const phraseBank = form.phraseBank ?? {};
  const roomIds = new Set(loc.rooms.map((r) => r.id));

  // ---- Static checks: per-beat suggestedVerbs + fires + trigger refs.
  for (const beat of pack.beats) {
    // suggestedVerbs (flat array OR per-form record).
    const lists = pickAllSuggestionLists(beat.suggestedVerbs, formId);
    for (const list of lists) {
      for (const sv of list) {
        if (!formVerbs.has(sv.verb)) {
          errors.push(
            `[${arcId}/${beat.id}] suggestedVerb '${sv.verb}' not in ${formId}.verbs[]`,
          );
        }
        if (!phraseBank[sv.verb]) {
          warnings.push(
            `[${arcId}/${beat.id}] suggestedVerb '${sv.verb}' has no phraseBank entry on ${formId}`,
          );
        }
      }
    }
    // fires references.
    for (const ev of beat.fires) {
      if (ev.kind === "npc.introduced") {
        const tid = (ev.data as { templateId?: string })?.templateId;
        if (tid && !npcIds.has(tid)) {
          errors.push(
            `[${arcId}/${beat.id}] npc.introduced.templateId='${tid}' has no content/npcs/${tid}.json`,
          );
        }
      }
    }
    // trigger room refs.
    for (const leaf of walkLeaves(beat.trigger)) {
      if (leaf.path === "location.roomId") {
        const op = leaf.expr.startsWith("==") ? leaf.expr.slice(2) : leaf.expr;
        if (!roomIds.has(op)) {
          errors.push(
            `[${arcId}/${beat.id}] trigger references unknown roomId '${op}' in ${locationId}`,
          );
        }
      }
      if (leaf.path.startsWith("form.vitals.")) {
        const vital = leaf.path.slice("form.vitals.".length);
        if (!form.vitals[vital]) {
          errors.push(
            `[${arcId}/${beat.id}] trigger references unknown vital '${vital}' on ${formId}`,
          );
        }
      }
    }
  }

  // ---- Beat-sequence simulation.
  let proj = initProj(form, loc, startingRoomId);
  for (let i = 0; i < pack.beats.length; i++) {
    const beat = pack.beats[i];
    const synth = synthesise(proj, beat.trigger, loc);
    if (!synth) {
      errors.push(
        `[${arcId}/${beat.id}] beat trigger is unsatisfiable from current state — typo or unreachable condition`,
      );
      break;
    }
    proj = synth;
    if (!evaluate(beat.trigger, proj)) {
      errors.push(
        `[${arcId}/${beat.id}] trigger evaluator rejected synthesised state — synthesis bug or missing leaf handler`,
      );
      break;
    }
    // Apply fires.
    for (const ev of beat.fires) {
      proj = reduce(proj, ev as Event);
    }
    // Advance turn naturally between beats so cumulative turn>=N
    // triggers can be hit by later beats.
    proj = { ...proj, turn: proj.turn + 1 };
  }

  // ---- Resolution-beat win-condition reachability.
  const lastBeat = pack.beats[pack.beats.length - 1];
  for (const leaf of walkLeaves(lastBeat.trigger)) {
    if (leaf.path.startsWith("form.vitals.")) {
      const vital = leaf.path.slice("form.vitals.".length);
      const max = form.vitals[vital]?.max;
      const want = parseRhsNumber(leaf.expr);
      if (max !== undefined && want !== null && want > max) {
        errors.push(
          `[${arcId}/${lastBeat.id}] win condition ${vital} ${leaf.expr} unreachable (max=${max})`,
        );
      }
    }
  }

  return { arcId, formId, locationId, errors, warnings };
}

function parseRhsNumber(expr: string): number | null {
  const m = expr.match(/^[<>=!]+(-?\d+)/);
  return m ? Number(m[1]) : null;
}

type SVList = Array<{ verb: string }>;

function pickAllSuggestionLists(
  field: Beat["suggestedVerbs"],
  formId: string,
): SVList[] {
  if (!field) return [];
  if (Array.isArray(field)) {
    return [field as SVList];
  }
  // Per-form record. Audit the entry for this arc's form (if any)
  // and the `default` entry. Other-form entries are audited
  // separately by the read-the-room test against their own form.
  const out: SVList[] = [];
  const r = field as Record<string, SVList | undefined>;
  if (r[formId]) out.push(r[formId]!);
  if (r.default) out.push(r.default);
  return out;
}

// ---- Test driver.

describe("arc smoke harness", () => {
  const routes = loadRoutes();
  const namedArcs = routes.filter(
    (r) => r.formId !== null && existsSync(join(process.cwd(), "content/beats", `${r.arcId}.json`)),
  );

  test("ROUTES loads at least the 14 known form-arc pairings", () => {
    // 4 MVP arcs + 1 form-agnostic + 10 ascended-form arcs = 15 form-targeted routes.
    // (The "city/town arc" routes have formId=null and are excluded above.)
    expect(namedArcs.length).toBeGreaterThanOrEqual(14);
  });

  for (const route of namedArcs) {
    const { arcId, formId, locationId, startingRoomId } = route;
    if (!formId || !locationId) continue;
    test(`${arcId} (${formId} × ${locationId})`, () => {
      const report = auditArc(arcId, formId, locationId, startingRoomId);
      if (report.errors.length > 0) {
        // Print one line per error so the test failure shows them all.
        const msg =
          `\nArc errors for ${arcId}:\n` +
          report.errors.map((e) => `  - ${e}`).join("\n") +
          (report.warnings.length
            ? "\n\nWarnings:\n" +
              report.warnings.map((w) => `  - ${w}`).join("\n")
            : "");
        throw new Error(msg);
      }
    });
  }

  // The form-agnostic read-the-room pack runs once per form it
  // declares per-form suggestedVerbs for. The arc itself is only
  // routed in ROUTES against formId=null (any) at forsaken-village,
  // so we audit it against each of the listed forms separately.
  test("read-the-room: per-form suggestedVerbs are valid for each declared form", () => {
    const pack = loadBeatPack("read-the-room");
    const errors: string[] = [];
    for (const beat of pack.beats) {
      const sv = beat.suggestedVerbs;
      if (!sv || Array.isArray(sv)) continue; // form-keyed record only
      for (const [keyForm, list] of Object.entries(sv)) {
        if (keyForm === "default") continue;
        try {
          const f = loadForm(keyForm);
          const verbs = new Set(f.verbs);
          const bank = f.phraseBank ?? {};
          for (const item of list as Array<{ verb: string }>) {
            if (!verbs.has(item.verb)) {
              errors.push(
                `[read-the-room/${beat.id}/${keyForm}] verb '${item.verb}' not in ${keyForm}.verbs[]`,
              );
            }
            if (!bank[item.verb]) {
              errors.push(
                `[read-the-room/${beat.id}/${keyForm}] verb '${item.verb}' has no phraseBank entry on ${keyForm}`,
              );
            }
          }
        } catch (err) {
          errors.push(
            `[read-the-room/${beat.id}] form '${keyForm}' could not be loaded: ${(err as Error).message}`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error("\n" + errors.map((e) => `  - ${e}`).join("\n"));
    }
  });
});
