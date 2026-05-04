import {
  failoverChain,
  FAILURES_TO_DEGRADE,
  FAILURES_TO_DOWN,
  type ProviderHealthState,
} from "@/lib/ai/health";

const HEALTHY: Omit<ProviderHealthState, "providerId" | "status"> = {
  lastSuccessAt: new Date(),
  lastFailureAt: null,
  consecutiveFailures: 0,
};

describe("failoverChain", () => {
  test("preferred first when all healthy", () => {
    const states: ProviderHealthState[] = [
      { providerId: "anthropic", status: "healthy", ...HEALTHY },
      { providerId: "bedrock", status: "healthy", ...HEALTHY },
      { providerId: "vertex", status: "healthy", ...HEALTHY },
    ];
    expect(failoverChain("anthropic", states)).toEqual([
      "anthropic",
      "bedrock",
      "vertex",
      "template",
    ]);
  });

  test("non-preferred down providers are skipped, template tail intact", () => {
    const states: ProviderHealthState[] = [
      { providerId: "anthropic", status: "healthy", ...HEALTHY },
      { providerId: "bedrock", status: "down", ...HEALTHY },
      { providerId: "vertex", status: "healthy", ...HEALTHY },
    ];
    expect(failoverChain("anthropic", states)).toEqual([
      "anthropic",
      "vertex",
      "template",
    ]);
  });

  test("manual_down providers also skipped", () => {
    const states: ProviderHealthState[] = [
      { providerId: "anthropic", status: "manual_down", ...HEALTHY },
      { providerId: "bedrock", status: "healthy", ...HEALTHY },
      { providerId: "vertex", status: "healthy", ...HEALTHY },
    ];
    expect(failoverChain("anthropic", states)).toEqual([
      "bedrock",
      "vertex",
      "template",
    ]);
  });

  test("preferred-different choice puts that one first", () => {
    const states: ProviderHealthState[] = [
      { providerId: "anthropic", status: "healthy", ...HEALTHY },
      { providerId: "bedrock", status: "healthy", ...HEALTHY },
      { providerId: "vertex", status: "healthy", ...HEALTHY },
    ];
    expect(failoverChain("vertex", states)).toEqual([
      "vertex",
      "anthropic",
      "bedrock",
      "template",
    ]);
  });

  test("all-down → just template", () => {
    const states: ProviderHealthState[] = [
      { providerId: "anthropic", status: "down", ...HEALTHY },
      { providerId: "bedrock", status: "down", ...HEALTHY },
      { providerId: "vertex", status: "down", ...HEALTHY },
    ];
    expect(failoverChain("anthropic", states)).toEqual(["template"]);
  });

  test("missing provider rows degrade to template gracefully", () => {
    expect(failoverChain("anthropic", [])).toEqual(["template"]);
  });
});

describe("health constants", () => {
  test("FAILURES_TO_DEGRADE = 3, FAILURES_TO_DOWN = 10", () => {
    expect(FAILURES_TO_DEGRADE).toBe(3);
    expect(FAILURES_TO_DOWN).toBe(10);
  });
});
