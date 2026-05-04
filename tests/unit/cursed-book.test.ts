/**
 * Cursed-book form #2 — wedge validation.
 *
 * The slime and the book share NO mechanics. These tests pin
 * down the differences end-to-end so a refactor that accidentally
 * conflates "form" with "slime" gets caught before reaching prod.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pickStartingRoom } from "@/lib/game/arc-routing";
import { classify } from "@/lib/game/classify";
import { loadForm, loadLocation } from "@/lib/game/content";
import { initialProjection } from "@/lib/game/projection";
import { checkToneFast } from "@/lib/game/tone";
import { buildFormCard } from "@/lib/narrator/prompts/form-card";

describe("cursed-book form template", () => {
  test("loads with vitals + stats distinct from the slime", () => {
    const slime = loadForm("lesser-slime");
    const book = loadForm("cursed-book");
    expect(book.id).toBe("cursed-book");
    // Vitals: book uses pages_intact + ink. Slime uses cohesion +
    // essence. Zero overlap is the whole point of the wedge.
    const slimeVitals = Object.keys(slime.vitals);
    const bookVitals = Object.keys(book.vitals);
    expect(bookVitals).toContain("pages_intact");
    expect(bookVitals).toContain("ink");
    expect(slimeVitals).not.toContain("pages_intact");
    expect(bookVitals).not.toContain("cohesion");
    // Stats also differ.
    expect(Object.keys(book.stats)).toContain("binding");
    expect(Object.keys(book.stats)).not.toContain("guile");
  });

  test("verbs are book-shaped, not body-shaped", () => {
    const book = loadForm("cursed-book");
    expect(book.verbs).toContain("fall_open");
    expect(book.verbs).toContain("absorb_word");
    expect(book.verbs).toContain("bleed_ink");
    expect(book.verbs).toContain("wait_for_a_reader");
    // No locomotion verbs — the book moves only when carried.
    expect(book.verbs).not.toContain("ooze");
    expect(book.verbs).not.toContain("creep");
    expect(book.verbs).not.toContain("walk");
  });

  test("classifier maps book-flavored player input to book verbs", () => {
    const book = loadForm("cursed-book");
    expect(classify("I open to the warm page", book).verb).toBe("fall_open");
    expect(classify("I shut suddenly", book).verb).toBe("snap_shut");
    expect(classify("I read the marginal note", book).verb).toBe(
      "absorb_word",
    );
    expect(classify("I bleed ink onto the page", book).verb).toBe(
      "bleed_ink",
    );
    expect(classify("I decode the passage", book).verb).toBe("decode_passage");
    expect(classify("wait for someone to come", book).verb).toBe(
      "wait_for_a_reader",
    );
  });

  test("negativeVocab forbids body parts AND locomotion AND speech AND sight", () => {
    const book = loadForm("cursed-book") as unknown as {
      negativeVocab: { words: string[] };
    };
    const words = book.negativeVocab.words;
    // Body
    expect(words).toContain("hand");
    expect(words).toContain("eye");
    expect(words).toContain("mouth");
    // Locomotion
    expect(words).toContain("walk");
    expect(words).toContain("run");
    // Speech
    expect(words).toContain("speak");
    expect(words).toContain("voice");
    // Sight
    expect(words).toContain("see");
    expect(words).toContain("look");
  });

  test("tone checker flags second-person with a forbidden word", () => {
    const book = loadForm("cursed-book");
    const ok = checkToneFast(
      "Awareness arrives in the gutter; the page settles.",
      book,
    );
    expect(ok.ok).toBe(true);
    const bad = checkToneFast(
      "You walk toward the candle and pick it up.",
      book,
    );
    expect(bad.ok).toBe(false);
  });
});

describe("cursed-book initial projection", () => {
  test("starts with full pages + ink and zero state", () => {
    const form = loadForm("cursed-book");
    const location = loadLocation("sunless-spire");
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });
    expect(proj.form.id).toBe("cursed-book");
    expect(proj.form.vitals.pages_intact).toBe(12);
    expect(proj.form.vitals.ink).toBe(8);
    expect(proj.form.vitalsMax.pages_intact).toBe(12);
    // pages_intact has explicit death=0; ink does not.
    expect(proj.form.vitalsDeath.pages_intact).toBe(0);
    expect(proj.form.vitalsDeath.ink).toBeNull();
  });

  test("respects the (cursed-book, sunless-spire) starting-room override", () => {
    const form = loadForm("cursed-book");
    const location = loadLocation("sunless-spire");
    const override = pickStartingRoom("cursed-book", "sunless-spire");
    expect(override).toBe("spire-archive");
    const proj = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
      startingRoomId: override ?? undefined,
    });
    // The book wakes mid-page on a still-warm candle — in the
    // archive room, not the mid-landing the location defaults to.
    expect(proj.location.roomId).toBe("spire-archive");
    expect(location.entryRoomId).toBe("spire-mid-landing");
  });

  test("no override is set for a slime in collapsed-tunnel", () => {
    expect(pickStartingRoom("lesser-slime", "collapsed-tunnel")).toBeNull();
  });
});

describe("cursed-book form-card prompt", () => {
  test("includes negativeVocab list + hard-move menu + sample corpus", () => {
    const form = loadForm("cursed-book");
    // buildFormCard expects the raw JSON shape; loadForm returns
    // the FormTemplate. Re-read the JSON directly so the assertion
    // matches what the RemoteNarrator actually injects.
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "content", "forms", "cursed-book.json"),
        "utf8",
      ),
    );
    const card = buildFormCard(raw);
    expect(card).toContain("Cursed Book");
    expect(card).toContain("NEGATIVE VOCABULARY");
    expect(card).toContain("hand");
    expect(card).toContain("walk");
    expect(card).toContain("HARD-MOVE MENU");
    expect(card).toContain("page_torn");
    expect(card).toContain("wyrm_passage_surfaces");
    expect(card).toContain("ONE-SHOT EXEMPLARS");
    expect(card).toContain("01-awakening");
    void form;
  });
});
