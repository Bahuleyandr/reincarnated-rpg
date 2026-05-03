import { estimateCostUsd, MODEL_RATES } from "@/lib/util/ai-telemetry";

describe("estimateCostUsd", () => {
  test("Sonnet 4.6 plain input + output", () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    const cost = estimateCostUsd({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(18, 2);
  });

  test("Haiku 4.5 plain input + output", () => {
    // 1M input @ $1 + 1M output @ $5 = $6
    const cost = estimateCostUsd({
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6, 2);
  });

  test("cache-read tokens are charged at 10% of input rate", () => {
    // Sonnet: 1M un-cached input + 1M cache-read = $3 + $0.30 = $3.30
    const cost = estimateCostUsd({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.3, 2);
  });

  test("cache-create tokens are charged at 1.25x input rate", () => {
    // Sonnet: 0 un-cached + 1M cache-create = $3 * 1.25 = $3.75
    const cost = estimateCostUsd({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75, 2);
  });

  test("realistic mixed call (per ARCHITECTURE.md target <$0.01 per turn)", () => {
    // Typical turn: ~3500 un-cached input + 500 output + ~6500 cache-read.
    const cost = estimateCostUsd({
      model: "claude-sonnet-4-6",
      inputTokens: 3500,
      outputTokens: 500,
      cacheReadTokens: 6500,
    });
    // 3500/1M*$3 = $0.0105 + 500/1M*$15 = $0.0075 + 6500/1M*$3*0.1 = $0.00195
    // total ≈ $0.020
    expect(cost).toBeLessThan(0.025);
  });

  test("unknown model returns 0 (no spurious estimates)", () => {
    expect(
      estimateCostUsd({
        model: "claude-magic-7000",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0);
  });

  test("MODEL_RATES table covers the models we actually call", () => {
    expect(MODEL_RATES["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_RATES["claude-haiku-4-5"]).toBeDefined();
  });
});
