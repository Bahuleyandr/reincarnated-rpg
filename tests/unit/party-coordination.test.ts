/**
 * Co-play turn-coordination — pure-function tests for the
 * round-robin lock + advance logic.
 */
import {
  isUsersTurn,
  nextTurnUserId,
  type PartySnapshot,
} from "@/lib/parties/coordination";

function snapshot(args: {
  status?: PartySnapshot["status"];
  current?: string | null;
  members: Array<{ userId: string; turnOrder: number }>;
}): PartySnapshot {
  return {
    id: "p1",
    hostUserId: args.members[0]?.userId ?? "host",
    sessionId: "s1",
    status: args.status ?? "active",
    currentTurnUserId: args.current === undefined ? args.members[0]?.userId ?? null : args.current,
    maxSize: 3,
    members: args.members.map((m) => ({
      userId: m.userId,
      username: m.userId,
      turnOrder: m.turnOrder,
    })),
  };
}

describe("isUsersTurn", () => {
  test("forming party = nobody's turn", () => {
    const p = snapshot({
      status: "forming",
      members: [
        { userId: "a", turnOrder: 0 },
        { userId: "b", turnOrder: 1 },
      ],
    });
    expect(isUsersTurn(p, "a")).toBe(false);
    expect(isUsersTurn(p, "b")).toBe(false);
  });

  test("active party — only currentTurnUserId is true", () => {
    const p = snapshot({
      status: "active",
      current: "b",
      members: [
        { userId: "a", turnOrder: 0 },
        { userId: "b", turnOrder: 1 },
      ],
    });
    expect(isUsersTurn(p, "a")).toBe(false);
    expect(isUsersTurn(p, "b")).toBe(true);
  });

  test("non-member can never be currentTurnUserId", () => {
    const p = snapshot({
      status: "active",
      current: "stranger",
      members: [{ userId: "a", turnOrder: 0 }],
    });
    expect(isUsersTurn(p, "stranger")).toBe(false);
  });
});

describe("nextTurnUserId", () => {
  test("rotates through turn_order", () => {
    const p = snapshot({
      members: [
        { userId: "a", turnOrder: 0 },
        { userId: "b", turnOrder: 1 },
        { userId: "c", turnOrder: 2 },
      ],
    });
    expect(nextTurnUserId(p, "a")).toBe("b");
    expect(nextTurnUserId(p, "b")).toBe("c");
    expect(nextTurnUserId(p, "c")).toBe("a"); // wraps
  });

  test("empty member list returns null", () => {
    const p = snapshot({ members: [] });
    expect(nextTurnUserId(p, null)).toBeNull();
    expect(nextTurnUserId(p, "ghost")).toBeNull();
  });

  test("null currentTurnUserId starts from member[0]", () => {
    const p = snapshot({
      current: null,
      members: [
        { userId: "a", turnOrder: 0 },
        { userId: "b", turnOrder: 1 },
      ],
    });
    expect(nextTurnUserId(p, null)).toBe("a");
  });

  test("non-member current falls back to first member", () => {
    const p = snapshot({
      current: "stranger",
      members: [
        { userId: "a", turnOrder: 0 },
        { userId: "b", turnOrder: 1 },
      ],
    });
    expect(nextTurnUserId(p, "stranger")).toBe("a");
  });
});
