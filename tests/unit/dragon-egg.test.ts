/**
 * Dragon-egg form #4 — wedge validation completing the four-form set.
 *
 * The egg is the most *passive* of the typed forms. It cannot move,
 * cannot speak, cannot see; it senses through its shell — pressure,
 * heat, chemistry. Its primary verb is `wait`. The clock is its
 * enemy: warmth bleeds out unless tended.
 *
 * Together with slime, cursed-book, and dungeon-core, this finishes
 * the four-form wedge proof. Each form has zero mechanical overlap
 * with any other across vitals/stats/verbs/dice/negativeVocab.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pickStartingRoom } from "@/lib/game/arc-routing";
import { classify } from "@/lib/game/classify";
import { loadForm, loadLocation } from "@/lib/game/content";
import { initialProjection } from "@/lib/game/projection";
import { checkToneFast } from "@/lib/game/tone";
import { buildFormCard } from "@/lib/narrator/prompts/form-card";

describe("dragon-egg form template", () => {
  test("loads with vitals + stats distinct from all three other typed forms", () => {
    const slime = loadForm("lesser-slime");
    const book = loadForm("cursed-book");
    const core = loadForm("dungeon-core");
    const egg = loadForm("dragon-egg");
    expect(egg.id).toBe("dragon-egg");
    // Vitals: warmth + heartbeat. Zero overlap with the other 3.
    const eggVitals = Object.keys(egg.vitals);
    expect(eggVitals).toEqual(
      expect.arrayContaining(["warmth", "heartbeat"]),
    );
    expect(eggVitals).not.toContain("cohesion"); // slime
    expect(eggVitals).not.toContain("pages_intact"); // book
    expect(eggVitals).not.toContain("integrity"); // core
    expect(Object.keys(slime.vitals)).not.toContain("warmth");
    expect(Object.keys(book.vitals)).not.toContain("heartbeat");
    expect(Object.keys(core.vitals)).not.toContain("warmth");
    // Stats: shell + kindling are egg-only.
    expect(Object.keys(egg.stats)).toContain("shell");
    expect(Object.keys(egg.stats)).toContain("kindling");
    expect(Object.keys(slime.stats)).not.toContain("shell");
    expect(Object.keys(book.stats)).not.toContain("kindling");
    expect(Object.keys(core.stats)).not.toContain("shell");
  });

  test("verbs are egg-shaped (passive, internal, sensing)", () => {
    const egg = loadForm("dragon-egg");
    expect(egg.verbs).toContain("rock");
    expect(egg.verbs).toContain("hum_low");
    expect(egg.verbs).toContain("kindle_glow");
    expect(egg.verbs).toContain("absorb_warmth");
    expect(egg.verbs).toContain("hatch_partial");
    expect(egg.verbs).toContain("warmth_pulse");
    expect(egg.verbs).toContain("wyrm_kin_call");
    // No locomotion verbs (the egg cannot walk/ooze/creep).
    expect(egg.verbs).not.toContain("ooze");
    expect(egg.verbs).not.toContain("creep");
    expect(egg.verbs).not.toContain("walk");
    // No body-form verbs.
    expect(egg.verbs).not.toContain("fall_open");
    expect(egg.verbs).not.toContain("spawn_minion");
  });

  test("classifier maps egg-flavored player input to egg verbs", () => {
    const egg = loadForm("dragon-egg");
    expect(classify("I rock gently in the hearth", egg).verb).toBe("rock");
    expect(classify("I hum low into the stone", egg).verb).toBe("hum_low");
    expect(classify("I kindle a glow against the cold", egg).verb).toBe(
      "kindle_glow",
    );
    expect(classify("I listen for footsteps", egg).verb).toBe("listen");
    expect(classify("I absorb the warmth from the embers", egg).verb).toBe(
      "absorb_warmth",
    );
    expect(classify("I dream outward toward the village", egg).verb).toBe(
      "dream_outward",
    );
    expect(classify("send a warmth pulse", egg).verb).toBe("warmth_pulse");
    expect(classify("call to my wyrm kin", egg).verb).toBe("wyrm_kin_call");
  });

  test("negativeVocab forbids body parts AND locomotion AND sight AND speech", () => {
    const egg = loadForm("dragon-egg") as unknown as {
      negativeVocab: { words: string[] };
    };
    const words = egg.negativeVocab.words;
    // Body
    expect(words).toContain("hand");
    expect(words).toContain("eye");
    expect(words).toContain("mouth");
    // Locomotion (the egg cannot move)
    expect(words).toContain("walk");
    expect(words).toContain("run");
    // Sight (the egg cannot see)
    expect(words).toContain("see");
    expect(words).toContain("look");
    // Speech (the egg cannot speak)
    expect(words).toContain("speak");
    expect(words).toContain("voice");
  });

  test("tone checker flags second-person with a forbidden body or locomotion word", () => {
    const egg = loadForm("dragon-egg");
    const ok = checkToneFast(
      "Warmth gathers slowly along the shell; the hearth above you exhales.",
      egg,
    );
    expect(ok.ok).toBe(true);
    const bad = checkToneFast(
      "You walk to the smith and grab their hand with yours.",
      egg,
    );
    expect(bad.ok).toBe(false);
    expect(bad.violations).toEqual(
      expect.arrayContaining(["walk"]),
    );
  });
});

describe("dragon-egg dice variant", () => {
  test("opted in to 2d6r1 (lucky-if-you-survive)", () => {
    const egg = loadForm("dragon-egg");
    expect(egg.dice).toBe("2d6r1");
  });
});

describe("dragon-egg initial projection", () => {
  test("starts with full heartbeat + partial warmth (the clock is its enemy)", () => {
    const form = loadForm("dragon-egg");
    const location = loadLocation("forsaken-village");
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });
    expect(proj.form.id).toBe("dragon-egg");
    expect(proj.form.vitals.warmth).toBe(8);
    expect(proj.form.vitalsMax.warmth).toBe(10);
    expect(proj.form.vitals.heartbeat).toBe(10);
    expect(proj.form.vitalsMax.heartbeat).toBe(10);
    // Both vitals are death-relevant (death=0).
    expect(proj.form.vitalsDeath.warmth).toBe(0);
    expect(proj.form.vitalsDeath.heartbeat).toBe(0);
  });

  test("starting-room override puts the egg in the smithy hearth, not the square", () => {
    const form = loadForm("dragon-egg");
    const location = loadLocation("forsaken-village");
    const override = pickStartingRoom("dragon-egg", "forsaken-village");
    expect(override).toBe("smith-house");
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
      startingRoomId: override ?? undefined,
    });
    // The keep-the-warmth beat says the egg sits in Berra's
    // banked hearth (smith-house). Without the override it would
    // wake in village-square.
    expect(proj.location.roomId).toBe("smith-house");
    expect(location.entryRoomId).toBe("village-square");
  });
});

describe("dragon-egg form-card prompt", () => {
  test("includes negativeVocab + hard-move menu + sample corpus", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "content", "forms", "dragon-egg.json"),
        "utf8",
      ),
    );
    const card = buildFormCard(raw);
    expect(card).toContain("Dragon Egg");
    expect(card).toContain("NEGATIVE VOCABULARY");
    expect(card).toContain("walk");
    expect(card).toContain("HARD-MOVE MENU");
    expect(card).toContain("ONE-SHOT EXEMPLARS");
  });
});
