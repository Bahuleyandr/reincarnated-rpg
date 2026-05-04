import { composeThreadFragment } from "@/lib/dialogue/thread";

describe("composeThreadFragment", () => {
  test("returns null for empty thread", () => {
    expect(composeThreadFragment([], "Halrik")).toBeNull();
  });

  test("formats single exchange with reply", () => {
    const out = composeThreadFragment(
      [
        {
          id: "1",
          npcId: "halrik-aabbccdd",
          npcTemplateId: "master-halrik",
          playerUtterance: "what's the price of an iron knife?",
          npcReply: "Twelve. And worth it.",
          turn: 3,
          createdAtMs: Date.now(),
        },
      ],
      "Halrik",
    );
    expect(out).not.toBeNull();
    expect(out!).toMatch(/HALRIK/);
    expect(out!).toMatch(/iron knife/);
    expect(out!).toMatch(/Twelve/);
  });

  test("formats multi-turn chronologically with chronological count", () => {
    const out = composeThreadFragment(
      [
        {
          id: "1",
          npcId: "x",
          npcTemplateId: "x",
          playerUtterance: "morning",
          npcReply: "morning.",
          turn: 1,
          createdAtMs: 1,
        },
        {
          id: "2",
          npcId: "x",
          npcTemplateId: "x",
          playerUtterance: "is the smith in?",
          npcReply: "she is.",
          turn: 2,
          createdAtMs: 2,
        },
      ],
      "Halrik",
    );
    expect(out).not.toBeNull();
    expect(out!).toMatch(/2 prior exchanges/);
    expect(out!).toMatch(/morning[\s\S]*she is/);
  });

  test("handles exchanges without an npc reply (skipped reply line)", () => {
    const out = composeThreadFragment(
      [
        {
          id: "1",
          npcId: "x",
          npcTemplateId: "x",
          playerUtterance: "are you there?",
          npcReply: "",
          turn: 1,
          createdAtMs: 1,
        },
      ],
      "Halrik",
    );
    expect(out).not.toBeNull();
    expect(out!).toMatch(/are you there\?/);
    expect(out!).not.toMatch(/Halrik:/);
  });
});
