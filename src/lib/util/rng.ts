/**
 * Deterministic seeded PRNG. Mulberry32 — small, fast, good distribution
 * for 32-bit seeds. We only need ~2 die rolls per turn so quality
 * concerns are dwarfed by replay determinism, which this guarantees.
 *
 * Seed convention: 32-bit unsigned. The session.started event seed is the
 * source for the per-session sequence; per-turn we derive a roll seed
 * from session_seed XOR seq so each turn is independently reproducible.
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(rng: () => number, sides = 6): number {
  return Math.floor(rng() * sides) + 1;
}

/**
 * Derive a per-roll seed from a session seed and a turn sequence number.
 * Mixing avoids correlated outcomes when the same session_seed is reused
 * across turns. XOR + multiply by a large prime keeps it cheap and seed-stable.
 */
export function deriveSeed(sessionSeed: number, seq: number): number {
  return ((sessionSeed >>> 0) ^ Math.imul(seq | 0, 0x9e3779b1)) >>> 0;
}
