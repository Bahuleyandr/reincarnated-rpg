/**
 * Provider tests — exercise the OpenAI-compatible provider against a
 * mock fetch. The Anthropic path is exercised by the existing
 * RemoteNarrator integration; here we focus on the translation
 * surface (system concat, tool format, tool_choice mapping, response
 * parsing) where the OpenAI provider does most of its work.
 */
import { OpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";

describe("OpenAICompatibleProvider", () => {
  test("concatenates system parts + maps tool to function shape + parses tool_calls", async () => {
    const captured: { url?: string; init?: RequestInit; body?: unknown } = {};
    const fetchMock: typeof fetch = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      captured.body = JSON.parse(init.body as string);
      const reply = {
        id: "x",
        model: "test-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "narration here",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "move_to",
                    arguments: JSON.stringify({ roomId: "slope" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 30 },
        },
      };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const realFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const provider = new OpenAICompatibleProvider(
        "https://example.com/v1",
        "sk-test",
      );
      const result = await provider.complete({
        model: "openai/test",
        maxTokens: 256,
        system: [
          { type: "text", text: "frozen system", cache_control: { type: "ephemeral" } },
          { type: "text", text: "form card" },
        ],
        messages: [{ role: "user", content: "what now?" }],
        tools: [
          {
            name: "move_to",
            description: "Move",
            input_schema: { type: "object", properties: {} },
          },
        ],
        toolChoice: { type: "tool", name: "move_to" },
      });

      // System parts concatenated, in order, joined by \n\n.
      expect(captured.url).toBe("https://example.com/v1/chat/completions");
      const body = captured.body as {
        messages: Array<{ role: string; content: string }>;
        tools: Array<{
          type: string;
          function: { name: string; parameters: unknown };
        }>;
        tool_choice: unknown;
      };
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toBe("frozen system\n\nform card");
      // Tool shape translation.
      expect(body.tools[0].type).toBe("function");
      expect(body.tools[0].function.name).toBe("move_to");
      expect(body.tools[0].function.parameters).toEqual({
        type: "object",
        properties: {},
      });
      // tool_choice translation.
      expect(body.tool_choice).toEqual({
        type: "function",
        function: { name: "move_to" },
      });

      // Response parsing.
      expect(result.text).toBe("narration here");
      expect(result.toolUses).toEqual([
        { id: "call_1", name: "move_to", input: { roomId: "slope" } },
      ]);
      // Usage normalization: 100 prompt with 30 cached → 70 un-cached input + 30 cache_read.
      expect(result.usage.inputTokens).toBe(70);
      expect(result.usage.cacheReadTokens).toBe(30);
      expect(result.usage.outputTokens).toBe(20);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("surfaces non-200 errors with status + body excerpt", async () => {
    const fetchMock: typeof fetch = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "content-type": "text/plain" },
      })) as typeof fetch;
    const realFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const provider = new OpenAICompatibleProvider(
        "https://example.com/v1",
        "sk-test",
      );
      await expect(
        provider.complete({
          model: "x",
          maxTokens: 1,
          messages: [{ role: "user", content: "x" }],
        }),
      ).rejects.toThrow(/429.*rate limited/);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("constructor requires OPENAI_API_KEY", () => {
    expect(
      () => new OpenAICompatibleProvider("https://example.com/v1", ""),
    ).toThrow(/OPENAI_API_KEY/);
  });
});
