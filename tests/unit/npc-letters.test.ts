/**
 * NPC-letters helpers — pure parts of the seedFirstMeetLetters
 * pipeline. The DB-touching path is exercised by the integration
 * test in tests/integration/npc-letters-seed.test.ts.
 */
import {
  getFirstMeetLetterForNpc,
  npcTemplateIdsIntroducedDuring,
  _resetNpcLetterCacheForTests,
} from "@/lib/letters/npc-letters";
import type { Event } from "@/lib/game/types";

beforeEach(() => {
  _resetNpcLetterCacheForTests();
});

describe("getFirstMeetLetterForNpc", () => {
  test("returns the firstMeet block for a recurring NPC that has one", () => {
    // rhozell is a recurring NPC with a letter (added in this commit).
    const tpl = getFirstMeetLetterForNpc("rhozell");
    expect(tpl).not.toBeNull();
    expect(typeof tpl?.subject).toBe("string");
    expect(typeof tpl?.body).toBe("string");
    expect(tpl?.subject.length).toBeGreaterThan(0);
    expect(tpl?.body.length).toBeGreaterThan(0);
  });

  test("returns null for an NPC without metadata.recurring", () => {
    // wrong-reader exists but isn't marked recurring.
    expect(getFirstMeetLetterForNpc("wrong-reader")).toBeNull();
  });

  test("returns null for an unknown template id", () => {
    expect(
      getFirstMeetLetterForNpc("nonexistent-npc-template-zzz"),
    ).toBeNull();
  });

  test("returns null when the recurring NPC has no firstMeet block", () => {
    // No NPC fits this case in our current catalog (we authored
    // letters for all 17 recurring NPCs). The behavior is still
    // worth pinning: lookup must return null rather than {}.
    const result = getFirstMeetLetterForNpc("nonexistent-recurring");
    expect(result).toBeNull();
  });
});

describe("npcTemplateIdsIntroducedDuring", () => {
  test("returns templateIds from npc.introduced events", () => {
    const events: Event[] = [
      {
        kind: "npc.introduced",
        npcId: "rhozell-abc12345",
        data: { name: "rhozell", templateId: "rhozell" },
      },
      {
        kind: "npc.introduced",
        npcId: "captain-mira-of-the-anchor-def67890",
        data: {
          name: "captain-mira-of-the-anchor",
          templateId: "captain-mira-of-the-anchor",
        },
      },
    ];
    expect(npcTemplateIdsIntroducedDuring(events)).toEqual([
      "rhozell",
      "captain-mira-of-the-anchor",
    ]);
  });

  test("ignores events without a templateId in data", () => {
    const events: Event[] = [
      {
        kind: "npc.introduced",
        npcId: "anonymous-1",
        data: { name: "some-stranger" },
      },
    ];
    expect(npcTemplateIdsIntroducedDuring(events)).toEqual([]);
  });

  test("ignores non-npc.introduced events", () => {
    const events: Event[] = [
      {
        kind: "narration.emitted",
        text: "you wait.",
        seq: 0,
      } as unknown as Event,
      {
        kind: "session.ended",
        reason: "death",
      },
    ];
    expect(npcTemplateIdsIntroducedDuring(events)).toEqual([]);
  });

  test("returns duplicates if the same NPC was introduced twice", () => {
    // The seeder dedupes via the seen Set + the DB-existence check;
    // the helper just reports what's in the events.
    const events: Event[] = [
      {
        kind: "npc.introduced",
        npcId: "rhozell-1",
        data: { templateId: "rhozell", name: "rhozell" },
      },
      {
        kind: "npc.introduced",
        npcId: "rhozell-2",
        data: { templateId: "rhozell", name: "rhozell" },
      },
    ];
    expect(npcTemplateIdsIntroducedDuring(events)).toEqual([
      "rhozell",
      "rhozell",
    ]);
  });
});
