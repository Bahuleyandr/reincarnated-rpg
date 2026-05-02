/**
 * Player-input sanitization, applied before storage as `inputSanitized`
 * on `turn.begun` events. The raw input is also stored (for debugging,
 * audits, and faithful replay), but only the sanitized version is fed
 * back to the model.
 *
 * Defenses:
 *   - Strip C0/C1 control characters except common whitespace (\t, \n, \r).
 *   - Normalize Unicode (NFC) so visually-identical strings compare equal.
 *   - Cap at 500 chars (after normalization).
 *   - Collapse runs of whitespace.
 *
 * What we do NOT do:
 *   - HTML/JSON escape: nothing here is rendered as markup.
 *   - "Ignore prior instructions" detection: that's an arms race we lose.
 *     Defense lives in the system prompt + delimited <player_input> wrap
 *     (see ARCHITECTURE.md "Prompt-injection mitigation").
 */

export const MAX_INPUT_LEN = 500;

export interface SanitizedInput {
  raw: string;
  sanitized: string;
}

// C0 controls 0x00-0x1F minus 0x09 (\t), 0x0A (\n), 0x0D (\r);
// plus the DEL byte 0x7F and the C1 range 0x80-0x9F.
const STRIP_CONTROLS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]",
  "g",
);

export function sanitizePlayerInput(input: string): SanitizedInput {
  if (typeof input !== "string") {
    return { raw: String(input), sanitized: "" };
  }
  let s = input.replace(STRIP_CONTROLS, "");
  s = s.normalize("NFC");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > MAX_INPUT_LEN) s = s.slice(0, MAX_INPUT_LEN);
  return { raw: input, sanitized: s };
}
