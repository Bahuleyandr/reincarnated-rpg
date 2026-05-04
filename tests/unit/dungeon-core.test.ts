/**
 * Dungeon-core form #3 — wedge validation.
 *
 * The core is the most different from slime/book of the typed
 * forms: it's stationary (cannot move from its chamber), it
 * "senses through the substance of its dungeon", and it shapes
 * rooms instead of moving through them. These tests pin down
 * those distinguishing properties so the wedge stays real.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classify } from "@/lib/game/classify";
import { loadForm, loadLocation } from "@/lib/game/content";
import { initialProjection } from "@/lib/game/projection";
import { checkToneFast } from "@/lib/game/tone";
import { buildFormCard } from "@/lib/narrator/prompts/form-card";

describe("dungeon-core form template", () => {
  test("loads with vitals + stats distinct from slime AND book", () => {
    const slime = loadForm("lesser-slime");
    const book = loadForm("cursed-book");
    const core = loadForm("dungeon-core");
    expect(core.id).toBe("dungeon-core");
    // Vitals: core uses mana + integrity. Zero overlap with slime
    // (cohesion + essence) or book (pages_intact + ink).
    const coreVitals = Object.keys(core.vitals);
    expect(coreVitals).toEqual(
      expect.arrayContaining(["mana", "integrity"]),
    );
    expect(coreVitals).not.toContain("cohesion");
    expect(coreVitals).not.toContain("pages_intact");
    expect(Object.keys(slime.vitals)).not.toContain("integrity");
    expect(Object.keys(book.vitals)).not.toContain("integrity");
    // Stats: domain_size + mana_recovery are core-only.
    expect(Object.keys(core.stats)).toContain("domain_size");
    expect(Object.keys(core.stats)).toContain("mana_recovery");
    expect(Object.keys(slime.stats)).not.toContain("domain_size");
  });

  test("verbs are dungeon-core-shaped, not body- or page-shaped", () => {
    const core = loadForm("dungeon-core");
    expect(core.verbs).toContain("spawn_minion");
    expect(core.verbs).toContain("shape_room");
    expect(core.verbs).toContain("weave_illusion");
    expect(core.verbs).toContain("siphon_intruder");
    expect(core.verbs).toContain("deepen_chamber");
    // No locomotion of the core itself (it's stationary), no
    // body-form verbs.
    expect(core.verbs).not.toContain("ooze");
    expect(core.verbs).not.toContain("creep");
    expect(core.verbs).not.toContain("walk");
    expect(core.verbs).not.toContain("fall_open");
    expect(core.verbs).not.toContain("absorb_word");
  });

  test("classifier maps core-flavored player input to core verbs", () => {
    const core = loadForm("dungeon-core");
    expect(classify("I spawn a minion in the eastern corridor", core).verb).toBe(
      "spawn_minion",
    );
    expect(classify("I shape this room into a longer one", core).verb).toBe(
      "shape_room",
    );
    expect(classify("I lure them deeper", core).verb).toBe("lure");
    expect(classify("I sense intruder footsteps above", core).verb).toBe(
      "sense_intruder",
    );
    expect(classify("weave an illusion of an empty room", core).verb).toBe(
      "weave_illusion",
    );
    expect(classify("I drain mana from the wall", core).verb).toBe(
      "drain_mana",
    );
    expect(classify("deepen the chamber by half a meter", core).verb).toBe(
      "deepen_chamber",
    );
    expect(classify("I siphon the intruder", core).verb).toBe(
      "siphon_intruder",
    );
    expect(classify("conjure a false room", core).verb).toBe("false_room");
    expect(classify("I bind the minion", core).verb).toBe("bind_minion");
  });

  test("negativeVocab forbids body parts AND locomotion AND speech AND sight", () => {
    const core = loadForm("dungeon-core") as unknown as {
      negativeVocab: { words: string[] };
    };
    const words = core.negativeVocab.words;
    // Body
    expect(words).toContain("hand");
    expect(words).toContain("eye");
    expect(words).toContain("mouth");
    // Locomotion (the core is stationary)
    expect(words).toContain("walk");
    expect(words).toContain("run");
    expect(words).toContain("step");
    // Sight
    expect(words).toContain("see");
    expect(words).toContain("look");
    // Speech
    expect(words).toContain("speak");
    expect(words).toContain("voice");
  });

  test("tone checker flags second-person with a forbidden body or locomotion word", () => {
    const core = loadForm("dungeon-core");
    const ok = checkToneFast(
      "Awareness arrives across more space than you expected; the chamber's reserves draw down.",
      core,
    );
    expect(ok.ok).toBe(true);
    const bad = checkToneFast(
      "You walk to the corridor and grab the minion with your hand.",
      core,
    );
    expect(bad.ok).toBe(false);
    // Specifically: locomotion is forbidden because the core
    // cannot move from its chamber.
    expect(bad.violations).toEqual(
      expect.arrayContaining(["walk"]),
    );
  });
});

describe("dungeon-core initial projection", () => {
  test("starts with full integrity + partial mana", () => {
    const form = loadForm("dungeon-core");
    const location = loadLocation("sunless-spire");
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });
    expect(proj.form.id).toBe("dungeon-core");
    expect(proj.form.vitals.mana).toBe(8);
    expect(proj.form.vitalsMax.mana).toBe(12);
    expect(proj.form.vitals.integrity).toBe(8);
    expect(proj.form.vitalsMax.integrity).toBe(8);
    // integrity has explicit death=0; mana is non-lethal
    // (the core can run dry without dying — it just can't act).
    expect(proj.form.vitalsDeath.integrity).toBe(0);
    expect(proj.form.vitalsDeath.mana).toBeNull();
  });

  test("wakes in the location's default entry (no override needed)", () => {
    const form = loadForm("dungeon-core");
    const location = loadLocation("sunless-spire");
    // The first beat's narrative places the core at the
    // mid-landing — which IS sunless-spire's entryRoomId. So
    // unlike cursed-book, dungeon-core needs no override.
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });
    expect(proj.location.roomId).toBe("spire-mid-landing");
  });
});

describe("dungeon-core form-card prompt", () => {
  test("includes negativeVocab + hard-move menu + sample corpus", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "content", "forms", "dungeon-core.json"),
        "utf8",
      ),
    );
    const card = buildFormCard(raw);
    expect(card).toContain("Dungeon Core");
    expect(card).toContain("NEGATIVE VOCABULARY");
    expect(card).toContain("walk");
    expect(card).toContain("HARD-MOVE MENU");
    expect(card).toContain("mana_overspent");
    expect(card).toContain("minion_misshapen");
    expect(card).toContain("wyrm_resonance");
    expect(card).toContain("ONE-SHOT EXEMPLARS");
    expect(card).toContain("01-awakening");
  });
});
