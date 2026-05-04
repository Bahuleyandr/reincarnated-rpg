import { getProvider, getProviderWithFailover } from "@/lib/ai/factory";

describe("getProvider", () => {
  test("returns AnthropicProvider by default", () => {
    const p = getProvider("anthropic");
    expect(p.providerName).toBe("anthropic");
  });

  test("returns OpenAICompatibleProvider when name='openai-compatible'", () => {
    const orig = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const p = getProvider("openai-compatible");
      expect(p.providerName.toLowerCase()).toMatch(/openai/);
    } finally {
      if (orig === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = orig;
    }
  });
});

describe("getProviderWithFailover", () => {
  test("returns the bare provider when AI_FAILOVER is unset", () => {
    const orig = process.env.AI_FAILOVER;
    delete process.env.AI_FAILOVER;
    const p = getProviderWithFailover({
      db: {} as never,
    });
    expect(p.providerName).not.toBe("failover");
    process.env.AI_FAILOVER = orig;
  });

  test("returns the FailoverProvider when AI_FAILOVER=true", () => {
    const orig = process.env.AI_FAILOVER;
    process.env.AI_FAILOVER = "true";
    const p = getProviderWithFailover({
      db: {} as never,
    });
    expect(p.providerName).toBe("failover");
    process.env.AI_FAILOVER = orig;
  });
});
