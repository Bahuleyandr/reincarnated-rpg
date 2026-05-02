import { classify } from "@/lib/game/classify";
import type { FormTemplate } from "@/lib/game/types";

const SLIME: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
  verbs: [
    "absorb",
    "split",
    "ooze",
    "sense_tremor",
    "dissolve",
    "smother",
    "mimic_shape",
    "wait",
  ],
};

describe("classify", () => {
  test("direct verb match → confidence 1.0", () => {
    expect(classify("I want to absorb the morsel", SLIME)).toEqual({
      verb: "absorb",
      confidence: 1.0,
    });
  });

  test("multi-word verb (sense_tremor → 'sense tremor') matches direct", () => {
    expect(classify("I sense tremor in the rock", SLIME)).toEqual({
      verb: "sense_tremor",
      confidence: 1.0,
    });
  });

  test("synonym match → confidence 0.7", () => {
    const r = classify("I move toward the slope", SLIME);
    expect(r.verb).toBe("ooze");
    expect(r.confidence).toBeCloseTo(0.7);
  });

  test("synonym 'feel' maps to sense_tremor", () => {
    expect(classify("I feel the floor", SLIME).verb).toBe("sense_tremor");
  });

  test("no match → fallback to wait, low confidence", () => {
    const r = classify("klaatu barada nikto", SLIME);
    expect(r.verb).toBe("wait");
    expect(r.confidence).toBeLessThan(0.5);
  });

  test("first direct match wins over later synonyms", () => {
    // input contains both "absorb" (direct) and "feel" (synonym for sense)
    const r = classify("I absorb but also feel the floor", SLIME);
    expect(r.verb).toBe("absorb");
  });
});
