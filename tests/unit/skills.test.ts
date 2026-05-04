import {
  getSkill,
  listSkills,
  xpForLevel,
  xpToLevel,
} from "@/lib/economy/skills";
import {
  clearTrainerCache,
  getTrainerForNpc,
} from "@/lib/economy/trainers";
import { initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate, Projection } from "@/lib/game/types";

describe("skill catalog", () => {
  test("loads at least 7 skills", () => {
    expect(listSkills().length).toBeGreaterThanOrEqual(7);
  });
  test("ids unique + every entry has a trainer", () => {
    const ids = new Set(listSkills().map((s) => s.id));
    expect(ids.size).toBe(listSkills().length);
    for (const s of listSkills()) {
      expect(typeof s.trainerNpcId).toBe("string");
      expect(s.trainerNpcId.length).toBeGreaterThan(0);
    }
  });
  test("getSkill happy + null", () => {
    expect(getSkill("smithing")).not.toBeNull();
    expect(getSkill("nonsense")).toBeNull();
  });
});

describe("xpToLevel + xpForLevel", () => {
  test("level 0 at xp 0", () => {
    expect(xpToLevel(0)).toBe(0);
  });
  test("level 1 at xp 50 (sqrt(50/50)=1)", () => {
    expect(xpToLevel(50)).toBe(1);
  });
  test("level 5 at xp 1250 (sqrt(1250/50)=5)", () => {
    expect(xpToLevel(1250)).toBe(5);
  });
  test("level 10 at xp 5000", () => {
    expect(xpToLevel(5000)).toBe(10);
  });
  test("level 20 at xp 20000", () => {
    expect(xpToLevel(20000)).toBe(20);
  });
  test("monotonic: level never decreases as xp increases", () => {
    let prev = -1;
    for (let xp = 0; xp <= 30000; xp += 100) {
      const lvl = xpToLevel(xp);
      expect(lvl).toBeGreaterThanOrEqual(prev);
      prev = lvl;
    }
  });
  test("xpForLevel inverts xpToLevel exactly at boundaries", () => {
    for (let lvl = 0; lvl <= 20; lvl++) {
      expect(xpToLevel(xpForLevel(lvl))).toBeGreaterThanOrEqual(lvl);
    }
  });
  test("level cap at 30", () => {
    expect(xpToLevel(10_000_000)).toBe(30);
  });
});

describe("getTrainerForNpc", () => {
  beforeEach(() => clearTrainerCache());

  test("loads master-halrik (smithing)", () => {
    const t = getTrainerForNpc("master-halrik");
    expect(t).not.toBeNull();
    expect(t!.teachesSkill).toBe("smithing");
    expect(t!.teachingFee).toBeGreaterThan(0);
  });
  test("loads kethra-the-keeper (cooking)", () => {
    const t = getTrainerForNpc("kethra-the-keeper");
    expect(t).not.toBeNull();
    expect(t!.teachesSkill).toBe("cooking");
  });
  test("returns null for non-trainer NPCs", () => {
    expect(getTrainerForNpc("tunnel-rat")).toBeNull();
  });
  test("returns null for unknown NPCs", () => {
    expect(getTrainerForNpc("does-not-exist")).toBeNull();
  });
});

describe("learn_skill_from tool", () => {
  const FORM: FormTemplate = {
    id: "lesser-slime",
    vitals: { cohesion: { max: 8, start: 8, death: 0 } },
    stats: {},
    verbs: ["learn"],
    verbMappings: { learn: { tools: ["learn_skill_from"], rollStat: null } },
  };
  const LOCATION: LocationTemplate = {
    id: "iron-reach",
    entryRoomId: "start",
    rooms: [{ id: "start", exits: [] }],
  };

  function projWithTrainer(): Projection {
    const base = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form: FORM,
      location: LOCATION,
    });
    return {
      ...base,
      npcs: {
        ...base.npcs,
        "master-halrik-aabbccdd": {
          name: "Master Halrik",
          relationship: 1,
          templateId: "master-halrik",
        },
      },
    };
  }

  test("emits skill.learned + coins.spent", () => {
    const projection = projWithTrainer();
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "learn_skill_from", npcId: "master-halrik-aabbccdd" }],
      form: FORM,
      location: LOCATION,
      intent: "learn",
      rollBand: "success",
      currentCoins: 200,
      knownSkills: new Set(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["skill.learned", "coins.spent"]),
    );
    const learned = result.events.find((e) => e.kind === "skill.learned");
    if (learned?.kind !== "skill.learned") {
      throw new Error("expected skill.learned event");
    }
    expect(learned.skillId).toBe("smithing");
    expect(learned.fee).toBe(100);
  });

  test("rejects insufficient coins", () => {
    const projection = projWithTrainer();
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "learn_skill_from", npcId: "master-halrik-aabbccdd" }],
      form: FORM,
      location: LOCATION,
      intent: "learn",
      rollBand: "success",
      currentCoins: 5,
      knownSkills: new Set(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/insufficient coins/);
  });

  test("rejects when player already knows the skill", () => {
    const projection = projWithTrainer();
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "learn_skill_from", npcId: "master-halrik-aabbccdd" }],
      form: FORM,
      location: LOCATION,
      intent: "learn",
      rollBand: "success",
      currentCoins: 200,
      knownSkills: new Set(["smithing"]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/already know/);
  });

  test("rejects when NPC is not a trainer", () => {
    const base = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form: FORM,
      location: LOCATION,
    });
    const projection: Projection = {
      ...base,
      npcs: {
        "tunnel-rat-12345678": {
          name: "tunnel rat",
          relationship: -1,
          templateId: "tunnel-rat",
        },
      },
    };
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "learn_skill_from", npcId: "tunnel-rat-12345678" }],
      form: FORM,
      location: LOCATION,
      intent: "learn",
      rollBand: "success",
      currentCoins: 200,
      knownSkills: new Set(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/not a trainer/);
  });
});
