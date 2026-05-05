/**
 * stripReasoningTags + createReasoningFilter — drop `<think>…</think>`
 * blocks emitted by reasoning models (MiniMax-M2.7, DeepSeek-R1, etc.)
 * before the narrator prose reaches the player.
 */
import {
  createReasoningFilter,
  stripReasoningTags,
} from "@/lib/ai/strip-reasoning-tags";

describe("stripReasoningTags (full-text)", () => {
  test("returns text untouched when there are no tags", () => {
    expect(stripReasoningTags("You absorb the morsel.")).toBe(
      "You absorb the morsel.",
    );
  });

  test("strips a single think block at the start", () => {
    expect(
      stripReasoningTags("<think>I should write a slime line.</think>You absorb the morsel."),
    ).toBe("You absorb the morsel.");
  });

  test("strips a think block in the middle", () => {
    expect(
      stripReasoningTags("Pre-text. <think>aside</think> Post-text."),
    ).toBe("Pre-text.  Post-text.");
  });

  test("strips multiple think blocks", () => {
    expect(
      stripReasoningTags(
        "A. <think>one</think>B. <think>two</think>C.",
      ),
    ).toBe("A. B. C.");
  });

  test("drops everything from an unclosed <think> to end", () => {
    // Model truncated mid-reasoning. We don't want to leak the
    // half-monologue.
    expect(
      stripReasoningTags("Visible text. <think>I was about to say more"),
    ).toBe("Visible text.");
  });

  test("trims surrounding whitespace from the result", () => {
    expect(stripReasoningTags("   <think>x</think>   ok   ")).toBe("ok");
  });

  test("empty input returns empty", () => {
    expect(stripReasoningTags("")).toBe("");
  });

  test("only-think input returns empty string", () => {
    expect(stripReasoningTags("<think>only this</think>")).toBe("");
  });
});

describe("createReasoningFilter (streaming)", () => {
  test("emits chunks unchanged when there are no tags", () => {
    const f = createReasoningFilter();
    expect(f.feed("Hello ")).toBe("Hello ");
    expect(f.feed("world.")).toBe("world.");
    expect(f.end()).toBe("");
  });

  test("strips a complete think block within one chunk", () => {
    const f = createReasoningFilter();
    expect(f.feed("Pre <think>aside</think> Post")).toBe("Pre  Post");
  });

  test("strips a think block split across chunks", () => {
    const f = createReasoningFilter();
    expect(f.feed("Pre <thi")).toBe("Pre ");
    expect(f.feed("nk>aside")).toBe("");
    expect(f.feed("</think> Post")).toBe(" Post");
  });

  test("handles partial closer split across chunks", () => {
    const f = createReasoningFilter();
    expect(f.feed("<think>reasoning</thi")).toBe("");
    expect(f.feed("nk>final")).toBe("final");
  });

  test("buffers a partial open tag that ends up not being one", () => {
    // The buffered "<thi" gets confirmed as just literal text
    // because the next chunk doesn't extend it into "<think>".
    const f = createReasoningFilter();
    expect(f.feed("Less than: <thi")).toBe("Less than: ");
    expect(f.feed("ngs are slow.")).toBe("<things are slow.");
  });

  test("end() emits any buffered partial-but-now-confirmed visible text", () => {
    const f = createReasoningFilter();
    f.feed("Pre <thi");
    expect(f.end()).toBe("<thi");
  });

  test("end() drops buffered text when stream ended inside a think block", () => {
    const f = createReasoningFilter();
    f.feed("<think>still in it");
    expect(f.end()).toBe("");
  });

  test("multiple think blocks across many small chunks", () => {
    const f = createReasoningFilter();
    let out = "";
    for (const c of "A.<think>x</think>B.<think>y</think>C.".split(/(?=)/)) {
      out += f.feed(c);
    }
    out += f.end();
    expect(out).toBe("A.B.C.");
  });
});
