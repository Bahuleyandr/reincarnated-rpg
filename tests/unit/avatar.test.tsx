/**
 * Avatar registry coverage. Verifies one glyph exists for every
 * form template authored on disk so a future form can't ship without
 * its avatar (the run-start screen and map panel both lean on
 * <Avatar formId={form.id} />).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  Avatar,
  hasAvatar,
  knownAvatarFormIds,
} from "@/components/Avatar";

function listAuthoredFormIds(): string[] {
  const dir = join(process.cwd(), "content/forms");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

describe("Avatar registry", () => {
  test("exports a glyph for every authored form", () => {
    const authored = listAuthoredFormIds();
    const known = knownAvatarFormIds();
    const missing = authored.filter((id) => !known.includes(id));
    expect(missing).toEqual([]);
  });

  test("hasAvatar returns true for a known form", () => {
    expect(hasAvatar("lesser-slime")).toBe(true);
  });

  test("hasAvatar returns false for an unknown form", () => {
    expect(hasAvatar("nonexistent-form-xyz")).toBe(false);
  });

  test("Avatar component returns a JSX element for a known form", () => {
    // Sanity — no React render needed; just confirm the function
    // doesn't throw and returns the expected element shape. The
    // returned element wraps the inner Svg; its props are the
    // {size, aria, className} we passed to it (NOT yet the resolved
    // <svg> attributes — those come out only at render time).
    const result = Avatar({ formId: "lesser-slime", size: 32 });
    expect(result).toBeTruthy();
    const props = (result as unknown as { props: Record<string, unknown> }).props;
    expect(props.size).toBe(32);
    expect(props.aria).toContain("lesser slime");
  });

  test("Avatar falls back to generic-creature for unknown form ids", () => {
    const result = Avatar({ formId: "nonexistent-form-xyz", size: 24 });
    expect(result).toBeTruthy();
    const props = (result as unknown as { props: Record<string, unknown> }).props;
    expect(props.size).toBe(24);
    // Aria label still reflects the requested form (not 'generic-creature')
    // so the surrounding UI keeps the player-visible labelling.
    expect(props.aria).toContain("nonexistent");
  });

  test("ariaLabel override is respected", () => {
    const result = Avatar({
      formId: "lesser-slime",
      size: 16,
      ariaLabel: "the slime, awakening",
    });
    const props = (result as unknown as { props: Record<string, unknown> }).props;
    expect(props.aria).toBe("the slime, awakening");
  });
});
