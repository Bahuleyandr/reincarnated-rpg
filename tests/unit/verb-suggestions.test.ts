/**
 * suggestVerbs — pure helper that picks 3 verb-button suggestions
 * from (active beat → form iconicVerbs → form.verbs[]).
 */
import { suggestVerbs } from "@/lib/game/verb-suggestions";
import type { BeatPack } from "@/lib/game/beats";
import type { FormTemplate, Projection } from "@/lib/game/types";

function makeForm(overrides?: Partial<FormTemplate>): FormTemplate {
  return {
    id: "test-form",
    vitals: { hp: { max: 10, start: 10, death: 0 } },
    stats: {},
    verbs: ["alpha", "beta", "gamma", "delta", "wait"],
    ...overrides,
  };
}

function makeProj(turn = 1): Projection {
  return {
    sessionId: "s1",
    upToSeq: 0,
    form: {
      id: "test-form",
      vitals: { hp: 10 },
      vitalsMax: { hp: 10 },
      vitalsDeath: { hp: 0 },
      stats: {},
      state: {},
    },
    npcs: {},
    turn,
    xp: 0,
    quest: { id: null, objectives: {} },
    status: "active",
    location: { id: "loc-a", roomId: "r-1", discovered: ["r-1"] },
    inventory: [],
    reincarnatedAs: null,
  };
}

const SAMPLE_PACK: BeatPack = {
  id: "test-pack",
  beats: [
    {
      id: "01-opener",
      trigger: { all: [{ turn: "==1" }] },
      oncePerSession: true,
      fires: [],
      suggestedVerbs: [
        { verb: "alpha", label: "alpha lab", description: "alpha desc", advancesArc: true },
        { verb: "beta", label: "beta lab", description: "beta desc" },
        { verb: "gamma", label: "gamma lab", description: "gamma desc", advancesArc: "branch:x" },
      ],
    },
    {
      id: "02-mid",
      trigger: { all: [{ turn: ">=3" }] },
      oncePerSession: true,
      fires: [],
      // No suggestedVerbs — should fall through to form's iconic
    },
  ],
};

describe("suggestVerbs", () => {
  test("returns the active beat's suggestedVerbs first", () => {
    const form = makeForm();
    const result = suggestVerbs({
      form,
      projection: makeProj(1),
      beatPack: SAMPLE_PACK,
    });
    expect(result.map((v) => v.verb)).toEqual(["alpha", "beta", "gamma"]);
    expect(result[0].source).toBe("beat");
    expect(result[0].advancesArc).toBe(true);
    expect(result[2].advancesArc).toBe("branch:x");
  });

  test("falls back to form.iconicVerbs when no beat fires", () => {
    const form = makeForm({ iconicVerbs: ["beta", "gamma", "delta"] });
    const result = suggestVerbs({
      form,
      // turn=2: doesn't match any beat in SAMPLE_PACK
      projection: makeProj(2),
      beatPack: SAMPLE_PACK,
    });
    expect(result.map((v) => v.verb)).toEqual(["beta", "gamma", "delta"]);
    expect(result.every((v) => v.source === "iconic")).toBe(true);
  });

  test("falls back to form.iconicVerbs when beat fires but has no suggestedVerbs", () => {
    const form = makeForm({ iconicVerbs: ["alpha", "beta", "gamma"] });
    const result = suggestVerbs({
      form,
      // turn=3 hits beat 02-mid which has no suggestedVerbs
      projection: makeProj(3),
      beatPack: SAMPLE_PACK,
    });
    expect(result.every((v) => v.source === "iconic")).toBe(true);
  });

  test("falls back to form.verbs[] when neither beat nor iconicVerbs available", () => {
    const form = makeForm(); // no iconicVerbs
    const result = suggestVerbs({
      form,
      projection: makeProj(2),
    });
    expect(result.map((v) => v.verb)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.every((v) => v.source === "fallback")).toBe(true);
  });

  test("respects the limit", () => {
    const form = makeForm({ iconicVerbs: ["alpha", "beta", "gamma", "delta"] });
    const result = suggestVerbs({
      form,
      projection: makeProj(2),
      limit: 2,
    });
    expect(result).toHaveLength(2);
  });

  test("skips already-fired oncePerSession beats", () => {
    const form = makeForm({ iconicVerbs: ["alpha", "beta", "gamma"] });
    const result = suggestVerbs({
      form,
      projection: makeProj(1),
      beatPack: SAMPLE_PACK,
      // Beat 01-opener already fired on a prior turn
      firedBeatIds: new Set(["01-opener"]),
    });
    // Should fall through to iconicVerbs since the only matching
    // beat was filtered out.
    expect(result.every((v) => v.source === "iconic")).toBe(true);
  });

  test("returns empty array when form has no verbs at all", () => {
    const form = makeForm({ verbs: [] });
    const result = suggestVerbs({
      form,
      projection: makeProj(2),
    });
    expect(result).toEqual([]);
  });

  test("describeVerb fills in human label for known verb ids", () => {
    const form = makeForm({ iconicVerbs: ["absorb"] }); // known slime verb
    const [first] = suggestVerbs({ form, projection: makeProj(2) });
    expect(first.label).toMatch(/absorb/i);
    expect(first.description.length).toBeGreaterThan(0);
  });

  test("describeVerb falls back gracefully on unknown verb id", () => {
    const form = makeForm({ iconicVerbs: ["mystery_verb"] });
    const [first] = suggestVerbs({ form, projection: makeProj(2) });
    expect(first.label).toBe("mystery verb"); // snake → space
  });

  // ---- Per-form keyed suggestedVerbs (form-agnostic arcs) ----
  // Used by read-the-room and any other arc that fires across
  // multiple forms with distinct verb registries.

  const FORM_AGNOSTIC_PACK: BeatPack = {
    id: "form-agnostic-pack",
    beats: [
      {
        id: "01-keyed",
        trigger: { all: [{ turn: "==1" }] },
        oncePerSession: true,
        fires: [],
        suggestedVerbs: {
          "form-a": [
            { verb: "alpha", label: "alpha", description: "a-desc", advancesArc: true },
            { verb: "beta", label: "beta", description: "b-desc" },
            { verb: "gamma", label: "gamma", description: "g-desc" },
          ],
          "form-b": [
            { verb: "delta", label: "delta", description: "d-desc", advancesArc: true },
            { verb: "epsilon", label: "epsilon", description: "e-desc" },
          ],
          default: [
            { verb: "zeta", label: "zeta", description: "z-desc" },
            { verb: "eta", label: "eta", description: "h-desc" },
          ],
        },
      },
    ],
  };

  test("per-form suggestedVerbs: dispatches by form.id", () => {
    const form = makeForm({ id: "form-a" });
    const result = suggestVerbs({
      form,
      projection: makeProj(1),
      beatPack: FORM_AGNOSTIC_PACK,
    });
    expect(result.map((v) => v.verb)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.every((v) => v.source === "beat")).toBe(true);
  });

  test("per-form suggestedVerbs: picks form-b for form-b", () => {
    const form = makeForm({ id: "form-b" });
    const result = suggestVerbs({
      form,
      projection: { ...makeProj(1), form: { ...makeProj(1).form, id: "form-b" } },
      beatPack: FORM_AGNOSTIC_PACK,
    });
    expect(result.map((v) => v.verb)).toEqual(["delta", "epsilon"]);
  });

  test("per-form suggestedVerbs: falls through to default when form-id has no entry", () => {
    const form = makeForm({ id: "form-other" });
    const result = suggestVerbs({
      form,
      projection: { ...makeProj(1), form: { ...makeProj(1).form, id: "form-other" } },
      beatPack: FORM_AGNOSTIC_PACK,
    });
    expect(result.map((v) => v.verb)).toEqual(["zeta", "eta"]);
    expect(result.every((v) => v.source === "beat")).toBe(true);
  });

  test("per-form suggestedVerbs: form-id absent + no default → falls to iconicVerbs", () => {
    const form = makeForm({ id: "form-c", iconicVerbs: ["alpha", "beta", "gamma"] });
    const noDefaultPack: BeatPack = {
      id: "no-default",
      beats: [
        {
          id: "01-keyed",
          trigger: { all: [{ turn: "==1" }] },
          oncePerSession: true,
          fires: [],
          suggestedVerbs: {
            "form-a": [{ verb: "alpha", label: "alpha", description: "" }],
          },
        },
      ],
    };
    const result = suggestVerbs({
      form,
      projection: { ...makeProj(1), form: { ...makeProj(1).form, id: "form-c" } },
      beatPack: noDefaultPack,
    });
    expect(result.every((v) => v.source === "iconic")).toBe(true);
  });

  test("per-form suggestedVerbs: empty array for form-id falls through", () => {
    const form = makeForm({ id: "form-c", iconicVerbs: ["alpha", "beta", "gamma"] });
    const emptyPack: BeatPack = {
      id: "empty",
      beats: [
        {
          id: "01-keyed",
          trigger: { all: [{ turn: "==1" }] },
          oncePerSession: true,
          fires: [],
          suggestedVerbs: { "form-c": [] },
        },
      ],
    };
    const result = suggestVerbs({
      form,
      projection: { ...makeProj(1), form: { ...makeProj(1).form, id: "form-c" } },
      beatPack: emptyPack,
    });
    expect(result.every((v) => v.source === "iconic")).toBe(true);
  });
});
