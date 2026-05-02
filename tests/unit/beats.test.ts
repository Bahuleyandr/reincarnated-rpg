import { evaluate, matchBeats, type BeatPack } from "@/lib/game/beats";
import { initialProjection } from "@/lib/game/projection";
import type { FormTemplate, LocationTemplate, Projection } from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
  verbs: ["ooze"],
};
const LOC: LocationTemplate = {
  id: "tunnel",
  entryRoomId: "seam",
  rooms: [
    { id: "seam", exits: [] },
    { id: "slope", exits: [] },
    { id: "predator-den", exits: [] },
  ],
};

const fresh = (): Projection =>
  initialProjection({ sessionId: "s", form: FORM, location: LOC });

describe("evaluate — leaf comparators", () => {
  test("equality on dotted path matches", () => {
    expect(evaluate({ "location.roomId": "==seam" }, fresh())).toBe(true);
    expect(evaluate({ "location.roomId": "==slope" }, fresh())).toBe(false);
  });

  test("numeric >= on turn", () => {
    expect(evaluate({ turn: ">=1" }, { ...fresh(), turn: 1 })).toBe(true);
    expect(evaluate({ turn: ">=1" }, { ...fresh(), turn: 0 })).toBe(false);
  });

  test("npcKnown checks projection.npcs", () => {
    const seed = {
      ...fresh(),
      npcs: { "rat-1": { name: "Rat", relationship: 0 } },
    };
    expect(evaluate({ npcKnown: "rat-1" }, seed)).toBe(true);
    expect(evaluate({ npcKnown: "ghost" }, seed)).toBe(false);
  });

  test("discovered checks location.discovered list", () => {
    const seed = {
      ...fresh(),
      location: { ...fresh().location, discovered: ["seam", "moss-vault"] },
    };
    expect(evaluate({ discovered: "moss-vault" }, seed)).toBe(true);
    expect(evaluate({ discovered: "predator-den" }, seed)).toBe(false);
  });
});

describe("evaluate — boolean composition", () => {
  test("all requires every leaf to pass", () => {
    expect(
      evaluate(
        {
          all: [{ turn: ">=1" }, { "location.roomId": "==seam" }],
        },
        { ...fresh(), turn: 2 },
      ),
    ).toBe(true);
    expect(
      evaluate(
        {
          all: [{ turn: ">=1" }, { "location.roomId": "==slope" }],
        },
        { ...fresh(), turn: 2 },
      ),
    ).toBe(false);
  });

  test("any requires only one leaf", () => {
    expect(
      evaluate(
        {
          any: [{ turn: ">=99" }, { "location.roomId": "==seam" }],
        },
        fresh(),
      ),
    ).toBe(true);
  });

  test("nested any/all", () => {
    const seed = { ...fresh(), turn: 5 };
    const trigger = {
      all: [
        { turn: ">=3" },
        {
          any: [
            { "location.roomId": "==slope" },
            { "location.roomId": "==seam" },
          ],
        },
      ],
    };
    expect(evaluate(trigger, seed)).toBe(true);
  });
});

describe("matchBeats", () => {
  const pack: BeatPack = {
    id: "test-pack",
    beats: [
      {
        id: "01-awakening",
        trigger: { turn: "==1" },
        oncePerSession: true,
        fires: [],
      },
      {
        id: "02-the-rat",
        trigger: { "location.roomId": "==slope" },
        oncePerSession: true,
        fires: [],
      },
    ],
  };

  test("returns beats whose triggers match", () => {
    const matched = matchBeats({ ...fresh(), turn: 1 }, pack, new Set());
    expect(matched.map((b) => b.id)).toEqual(["01-awakening"]);
  });

  test("excludes oncePerSession beats already fired", () => {
    const matched = matchBeats(
      { ...fresh(), turn: 1 },
      pack,
      new Set(["01-awakening"]),
    );
    expect(matched).toEqual([]);
  });

  test("multiple beats can match in one tick", () => {
    const projection = {
      ...fresh(),
      turn: 1,
      location: { ...fresh().location, roomId: "slope" },
    };
    const matched = matchBeats(projection, pack, new Set());
    expect(matched.map((b) => b.id)).toEqual(["01-awakening", "02-the-rat"]);
  });
});
