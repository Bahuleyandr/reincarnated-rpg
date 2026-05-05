/**
 * Strip <think>…</think> blocks from LLM output.
 *
 * Some "reasoning" models (MiniMax-M2.7, DeepSeek-R1, QwQ, and
 * various open-weight derivatives) wrap their internal chain-of-
 * thought in literal `<think>…</think>` tags before emitting the
 * final answer. The narrator only wants the answer; the chain-of-
 * thought leaks the model's planning into the prose ("the user
 * wants me to describe a slime, so I should focus on tactile
 * detail…") which is both wrong-tone and confusing.
 *
 * VH Health hit this in May 2026 (per memory) — the symptom was
 * downstream JSON-parse failures because the response started with
 * `<think>...`. Reincarnated reads the response as freeform prose
 * for narration, so the failure mode here is "first paragraph of
 * narration is a meta-monologue." Same fix.
 *
 * The strip is cheap and idempotent. No-op for non-reasoning
 * models that never emit the tags.
 *
 * Edge cases handled:
 *   - Multiple think-blocks in one response (rare but possible)
 *   - Unclosed `<think>` (model truncated mid-thought) — drop
 *     everything from `<think>` to end-of-text rather than show
 *     a half-monologue
 *   - Whitespace before/after the stripped block: trimmed
 *   - Nested or malformed tags: handled by treating as a single
 *     non-greedy match per pass
 */
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export function stripReasoningTags(text: string): string {
  if (!text) return text;
  // Fast path: no tags at all.
  if (!text.includes(THINK_OPEN) && !text.includes(THINK_CLOSE)) {
    return text;
  }

  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(THINK_OPEN, i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    // Append the text before the <think> opener.
    out += text.slice(i, open);
    const close = text.indexOf(THINK_CLOSE, open + THINK_OPEN.length);
    if (close === -1) {
      // Unclosed think block — model was truncated mid-reasoning.
      // Drop everything from the open tag to end-of-text. (Showing
      // a half-monologue is worse than showing nothing.)
      break;
    }
    // Skip past the closing tag and continue scanning.
    i = close + THINK_CLOSE.length;
  }
  return out.trim();
}

/**
 * Streaming variant — feed each delta as it arrives, get back only
 * the parts that should be emitted to the user. Maintains state
 * across calls so partial tags split across chunk boundaries are
 * handled correctly.
 *
 * Usage:
 *   const filter = createReasoningFilter();
 *   for await (const chunk of stream) {
 *     const visible = filter.feed(chunk);
 *     if (visible) emit(visible);
 *   }
 *   const tail = filter.end();
 *   if (tail) emit(tail);
 */
export interface StreamingReasoningFilter {
  /** Process a chunk and return any visible (post-strip) text. */
  feed(chunk: string): string;
  /** Drain any buffered visible text at end-of-stream. */
  end(): string;
}

export function createReasoningFilter(): StreamingReasoningFilter {
  let inThink = false;
  let buffer = ""; // For partial tag matches across chunk boundaries

  // Largest partial we'd buffer is `</think>` minus 1 = 7 chars.
  // We hold back up to that many chars at the end of each visible
  // segment to handle "</think" arriving split across chunks.
  const MAX_PARTIAL = THINK_CLOSE.length - 1;

  function isPotentialOpen(s: string): boolean {
    // Could `s` be a prefix of `<think>` ?
    return THINK_OPEN.startsWith(s) && s.length > 0;
  }
  function isPotentialClose(s: string): boolean {
    return THINK_CLOSE.startsWith(s) && s.length > 0;
  }

  return {
    feed(chunk: string): string {
      const text = buffer + chunk;
      let out = "";
      let i = 0;
      while (i < text.length) {
        if (!inThink) {
          // Look for `<think>` in remaining text.
          const open = text.indexOf(THINK_OPEN, i);
          if (open === -1) {
            // No full opener found. But the text may end with a
            // partial like "<thi" that could become `<think>` next
            // chunk. Buffer the trailing chars that could still
            // grow into the open tag.
            const remaining = text.slice(i);
            // Find the smallest tail that's a strict prefix of
            // THINK_OPEN. If found, buffer from that position.
            let bufferStart = -1;
            for (
              let k = remaining.length - Math.min(MAX_PARTIAL, remaining.length);
              k < remaining.length;
              k++
            ) {
              const tail = remaining.slice(k);
              if (isPotentialOpen(tail)) {
                bufferStart = k;
                break;
              }
            }
            if (bufferStart >= 0) {
              out += remaining.slice(0, bufferStart);
              buffer = remaining.slice(bufferStart);
            } else {
              out += remaining;
              buffer = "";
            }
            return out;
          }
          // Found a full `<think>` — emit everything up to it.
          out += text.slice(i, open);
          i = open + THINK_OPEN.length;
          inThink = true;
        } else {
          // We're inside a think block — drop everything up to
          // `</think>`.
          const close = text.indexOf(THINK_CLOSE, i);
          if (close === -1) {
            // Still inside the think; drop everything but buffer
            // any trailing partial closer.
            const remaining = text.slice(i);
            let bufferStart = -1;
            for (
              let k = remaining.length - Math.min(MAX_PARTIAL, remaining.length);
              k < remaining.length;
              k++
            ) {
              const tail = remaining.slice(k);
              if (isPotentialClose(tail)) {
                bufferStart = k;
                break;
              }
            }
            buffer = bufferStart >= 0 ? remaining.slice(bufferStart) : "";
            return out;
          }
          i = close + THINK_CLOSE.length;
          inThink = false;
        }
      }
      buffer = "";
      return out;
    },

    end(): string {
      // If the stream ended mid-think, drop the buffer entirely
      // (we never want to emit partial reasoning). If we ended
      // outside-think with a partial open tag in buffer, that
      // text was visible content the model planned to emit;
      // surfacing it is correct.
      if (inThink) return "";
      const tail = buffer;
      buffer = "";
      return tail;
    },
  };
}
