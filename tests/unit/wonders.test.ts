import {
  getWonder,
  listWonders,
  pickWonder,
  WONDER_COOLDOWN_TURNS,
  WONDER_FIRE_PROBABILITY,
} from "@/lib/wonders/select";

describe("wonder catalog", () => {
  test("loads at least 25 wonders", () => {
    expect(listWonders().length).toBeGreaterThanOrEqual(25);
  });
  test("ids are unique", () => {
    const ids = new Set(listWonders().map((w) => w.id));
    expect(ids.size).toBe(listWonders().length);
  });
  test("every wonder has a non-empty narrationFlavor", () => {
    for (const w of listWonders()) {
      expect(w.narrationFlavor.length).toBeGreaterThan(10);
    }
  });
  test("WONDER_COOLDOWN_TURNS = 10", () => {
    expect(WONDER_COOLDOWN_TURNS).toBe(10);
  });
  test("WONDER_FIRE_PROBABILITY = 0.01", () => {
    expect(WONDER_FIRE_PROBABILITY).toBe(0.01);
  });
  test("getWonder returns a known entry + null for unknown", () => {
    expect(getWonder("whisper_unknown")).not.toBeNull();
    expect(getWonder("nope")).toBeNull();
  });
});

describe("pickWonder", () => {
  const baseInputs = {
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
    recentWonderIds: [] as string[],
    fireProbability: 1, // force the roll to pass for these tests
  };

  test("forced-fire produces a wonder", () => {
    const w = pickWonder({ ...baseInputs, seed: 1 });
    expect(w).not.toBeNull();
  });

  test("zero probability never fires", () => {
    const w = pickWonder({
      ...baseInputs,
      seed: 1,
      fireProbability: 0,
    });
    expect(w).toBeNull();
  });

  test("deterministic per seed", () => {
    const a = pickWonder({ ...baseInputs, seed: 42 });
    const b = pickWonder({ ...baseInputs, seed: 42 });
    expect(a?.id).toBe(b?.id);
  });

  test("different seeds produce different choices (most of the time)", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) =>
      pickWonder({ ...baseInputs, seed: s }),
    );
    const ids = samples.map((w) => w?.id);
    const unique = new Set(ids);
    expect(unique.size).toBeGreaterThan(1);
  });

  test("formFilters block ineligible wonders", () => {
    // 'page_turns_alone' has formFilters: ['cursed-book'].
    // From a slime, that wonder must never be picked.
    for (let i = 1; i < 200; i++) {
      const w = pickWonder({ ...baseInputs, seed: i });
      expect(w?.id).not.toBe("page_turns_alone");
    }
  });

  test("locationFilters block ineligible wonders", () => {
    // 'the_eye_opens' has locationFilters that exclude 'iron-reach'.
    for (let i = 1; i < 200; i++) {
      const w = pickWonder({
        ...baseInputs,
        locationId: "iron-reach",
        seed: i,
      });
      expect(w?.id).not.toBe("the_eye_opens");
    }
  });

  test("formFilters allow eligible forms", () => {
    // 'page_turns_alone' is form-restricted to cursed-book; from a
    // cursed-book it CAN be picked.
    let foundIt = false;
    for (let i = 1; i < 500; i++) {
      const w = pickWonder({
        ...baseInputs,
        formId: "cursed-book",
        seed: i,
      });
      if (w?.id === "page_turns_alone") {
        foundIt = true;
        break;
      }
    }
    expect(foundIt).toBe(true);
  });

  test("recentWonderIds enforce cooldown", () => {
    // Force-fire a thousand times; if 'whisper_unknown' is in the
    // recent list it should never be the pick.
    for (let i = 1; i < 200; i++) {
      const w = pickWonder({
        ...baseInputs,
        seed: i,
        recentWonderIds: ["whisper_unknown"],
      });
      expect(w?.id).not.toBe("whisper_unknown");
    }
  });

  test("returns null when all wonders are in cooldown", () => {
    const allIds = listWonders().map((w) => w.id);
    const w = pickWonder({
      ...baseInputs,
      seed: 1,
      recentWonderIds: allIds,
    });
    expect(w).toBeNull();
  });

  test("misses the 1% roll often (default probability)", () => {
    const inputs = {
      ...baseInputs,
      fireProbability: undefined, // use default 0.01
    };
    let hits = 0;
    for (let i = 1; i < 1000; i++) {
      if (pickWonder({ ...inputs, seed: i })) hits += 1;
    }
    // At ~1%, expect roughly 5-20 hits in 1000 trials. Generous
    // bounds for test stability.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(50);
  });
});
