// Smoke test: hit MiniMax directly through OpenAICompatibleProvider
// using whatever .env.local has set. Validates that:
//   - OPENAI_BASE_URL is reachable
//   - OPENAI_API_KEY auths
//   - OPENAI_MODEL exists on the endpoint
//   - <think>...</think> blocks are stripped from the response
//
// Run: npx tsx --env-file=.env.local scripts/smoke-minimax.ts
import { OpenAICompatibleProvider } from "../src/lib/ai/providers/openai-compatible";

async function main(): Promise<void> {
  const provider = new OpenAICompatibleProvider();
  const r = await provider.complete({
    model: process.env.OPENAI_MODEL ?? "",
    system: [
      {
        type: "text",
        text: "You are a terse narrator. Reply in 2 short sentences.",
      },
    ],
    messages: [
      { role: "user", content: "I look at the room. What do I see?" },
    ],
    maxTokens: 200,
  });

  console.log("---text---");
  console.log(r.text);
  console.log("---contains <think>?---");
  console.log(r.text.includes("<think>") || r.text.includes("</think>"));
  console.log("---usage---");
  console.log(JSON.stringify(r.usage, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
