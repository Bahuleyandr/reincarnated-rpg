import { initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate } from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1 },
  verbs: ["ooze", "sense_tremor"],
  verbMappings: {
    ooze: { tools: ["move_to"], rollStat: "density" },
    sense_tremor: { tools: ["sense"], rollStat: null },
  },
};

const LOCATION: LocationTemplate = {
  id: "test-location",
  entryRoomId: "start",
  rooms: [
    { id: "start", exits: [{ verb: "ooze", toRoomId: "east" }] },
    { id: "east", exits: [] },
    { id: "sealed", exits: [] },
  ],
};

const projection = initialProjection({
  sessionId: "00000000-0000-0000-0000-000000000000",
  form: FORM,
  location: LOCATION,
});

describe("validateToolsToEvents", () => {
  test("rejects moves to non-connected rooms", () => {
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "move_to", roomId: "sealed" }],
      form: FORM,
      location: LOCATION,
      intent: "ooze",
      rollBand: "success",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toMatch(/not connected/);
  });

  test("rejects damage against unknown non-self entities", () => {
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "apply_damage",
          target: "unknown-npc",
          amount: 1,
          source: "test",
        },
      ],
      rollBand: "miss",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toMatch(/unknown target/);
  });

  test("rejects unknown npc templates", () => {
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "introduce_npc", templateId: "no-such-template", attitude: -1 }],
      rollBand: "miss",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toMatch(/unknown npc template/);
  });

  test("rejects tools outside the current verb allowance on success", () => {
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "grant_xp", amount: 1, reason: "not this verb" }],
      form: FORM,
      location: LOCATION,
      intent: "ooze",
      rollBand: "success",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toMatch(/not allowed/);
  });
});
