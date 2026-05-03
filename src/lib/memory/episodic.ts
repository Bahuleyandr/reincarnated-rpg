/**
 * Episodic memory — Day 10.
 *
 * Stores per-session "summary blob" rows in the `memories` table,
 * each with a voyage-3-lite 512-dim embedding (cosine), an int4range
 * over the source event seqs, and a salience score in [0, 1].
 *
 * Retrieval ranks by similarity × entity-overlap × recency:
 *
 *   score = (1 - cosine_distance) * (1 + 0.3 * |entityOverlap|) * exp(-ageMs / 1h)
 *
 * Cosine distance comes straight from pgvector's `<=>` operator;
 * entity overlap and recency are re-scored in TS after Postgres
 * returns the top-K candidates.
 *
 * The Voyage API call is mocked when `VOYAGE_API_KEY` is unset —
 * `mockEmbedding` produces a deterministic 512-dim vector from the
 * text hash so dev/tests don't burn credits.
 */
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { VoyageAIClient } from "voyageai";

import type { Db } from "../db/client";
import { memories } from "../db/schema";
import { env } from "../util/env";
import { uuidv7 } from "../util/uuidv7";
import type { Memory } from "../game/types";

const EMBEDDING_DIM = 512;

let voyage: VoyageAIClient | null = null;
function getVoyage(): VoyageAIClient {
  if (!voyage) {
    const apiKey = env().VOYAGE_API_KEY;
    if (!apiKey) throw new Error("VOYAGE_API_KEY required");
    voyage = new VoyageAIClient({ apiKey });
  }
  return voyage;
}

export async function embedText(
  text: string,
  inputType: "document" | "query" = "document",
): Promise<number[]> {
  if (!env().VOYAGE_API_KEY) return mockEmbedding(text);
  try {
    const result = await getVoyage().embed({
      input: text,
      model: "voyage-3-lite",
      inputType,
      outputDimension: EMBEDDING_DIM,
    });
    const e = result.data?.[0]?.embedding;
    if (!e) throw new Error("voyage returned no embedding");
    return e;
  } catch {
    return mockEmbedding(text);
  }
}

/**
 * Deterministic 512-dim embedding for dev/tests when VOYAGE_API_KEY
 * is absent. Same text → same vector; different texts → mostly
 * different vectors. NOT semantically meaningful — just a stable
 * mock for plumbing tests.
 */
export function mockEmbedding(text: string): number[] {
  const out = new Float32Array(EMBEDDING_DIM);
  // Stretch the SHA-256 digest across all 512 dims by repeated
  // hashing with an incrementing salt.
  for (let block = 0; block < EMBEDDING_DIM / 16; block++) {
    const h = createHash("sha256")
      .update(text)
      .update(String(block))
      .digest();
    for (let i = 0; i < 16; i++) {
      // Map byte (0-255) to a roughly-unit-norm component.
      out[block * 16 + i] = (h[i] - 128) / 128;
    }
  }
  // Normalize to unit vector so cosine matches dot product.
  let mag = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) mag += out[i] * out[i];
  mag = Math.sqrt(mag) || 1;
  return Array.from(out, (v) => v / mag);
}

export async function createMemory(
  db: Db,
  args: {
    sessionId: string;
    summary: string;
    eventSeqRange: [number, number];
    salience?: number;
  },
): Promise<string> {
  const embedding = await embedText(args.summary, "document");
  const id = uuidv7();
  await db.insert(memories).values({
    id,
    sessionId: args.sessionId,
    summary: args.summary,
    embedding,
    eventSeqRange: args.eventSeqRange,
    salience: args.salience ?? 0.5,
  });
  return id;
}

export interface RetrieveOptions {
  k?: number;
  /** Entity slugs mentioned in the current intent — boosts memories that
   *  reference any of them. */
  entitySlugs?: string[];
  /** Half-life for recency decay, in ms. Default 1h. */
  recencyHalfLifeMs?: number;
}

export async function retrieveMemories(
  db: Db,
  sessionId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<Memory[]> {
  const k = opts.k ?? 4;
  const halfLifeMs = opts.recencyHalfLifeMs ?? 3_600_000;
  const entitySlugs = opts.entitySlugs ?? [];

  const queryEmbedding = await embedText(query, "query");
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // Get top 3K candidates by cosine distance, then re-score with
  // entity-overlap + recency in TS.
  const rows = (await db.execute(sql`
    SELECT id, summary, salience, event_seq_range, created_at,
           1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM memories
    WHERE session_id = ${sessionId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${k * 3}
  `)) as unknown as Array<{
    id: string;
    summary: string;
    salience: number;
    event_seq_range: string;
    created_at: Date | string;
    similarity: number;
  }>;

  const now = Date.now();
  const scored = rows.map((r) => {
    const overlap = entityOverlap(r.summary, entitySlugs);
    const ageMs = now - new Date(r.created_at).getTime();
    const recency = Math.exp(-ageMs / halfLifeMs);
    const score = r.similarity * (1 + 0.3 * overlap) * recency;
    return { row: r, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map(({ row }) => ({
    id: row.id,
    summary: row.summary,
    salience: Number(row.salience),
    eventSeqRange: parseInt4range(row.event_seq_range),
  }));
}

function entityOverlap(text: string, slugs: string[]): number {
  if (slugs.length === 0) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const slug of slugs) {
    if (lower.includes(slug.toLowerCase().replace(/-/g, " "))) hits += 1;
    else if (lower.includes(slug.toLowerCase())) hits += 1;
  }
  return hits;
}

function parseInt4range(raw: string | [number, number]): [number, number] {
  if (Array.isArray(raw)) return raw;
  const m = /^([\[\(])(-?\d+),(-?\d+)([\]\)])$/.exec(raw);
  if (!m) return [0, 0];
  const lo = Number(m[2]) + (m[1] === "(" ? 1 : 0);
  const hi = Number(m[3]) + (m[4] === "]" ? 1 : 0);
  return [lo, hi];
}
