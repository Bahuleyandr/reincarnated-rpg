/**
 * Narrator factory — env-flagged dispatch between TemplateNarrator and
 * RemoteNarrator. Default is "template" (M1; deterministic, no API
 * cost). Set NARRATOR=remote (and ANTHROPIC_API_KEY) to use Sonnet 4.6
 * via the Anthropic SDK with prompt caching.
 */
import type { FormTemplate, LocationTemplate, Narrator } from "../game/types";

import { TemplateNarrator } from "./template";

export type NarratorMode = "template" | "remote";

export function getNarratorMode(): NarratorMode {
  const v = (process.env.NARRATOR ?? "template").toLowerCase();
  if (v === "remote") return "remote";
  return "template";
}

export function makeNarrator(args: {
  mode?: NarratorMode;
  form: FormTemplate;
  location: LocationTemplate;
  model?: string;
  /** BYO-LLM override. When set, the RemoteNarrator uses this instead
   *  of the env-default provider singleton. */
  provider?: import("../ai/provider").AIProvider;
  /** Optional telemetry sink — if set, RemoteNarrator writes per-call
   *  rows into ai_calls. Required if you want cost/latency analytics. */
  db?: import("../db/client").Db;
  sessionId?: string;
  /** Logged-in user id, threaded into ai_calls for the cost panel. */
  userId?: string | null;
  /** BYO preset id, threaded into ai_calls for the eval leaderboard. */
  presetId?: string | null;
  /** Current meta-arc phase flavor. Pre-fetched by the API route. */
  metaArcFlavor?: {
    phase: string;
    label: string;
    flavor: string;
  } | null;
  /** Resolved mood preset ('cozy' | 'standard' | 'brutal'). The
   *  fallback chain (session > user > standard) lives in the route.
   *  Phase 2 Day 11. */
  moodPreset?: string | null;
  /** Phase 7 Day 39. Active chapter's narrator fragment + label. */
  chapterFragment?: {
    book: number;
    chapter: number;
    title: string;
    fragment: string;
  } | null;
  /** Phase 9 atlas. Regional voice + sub-populations + signature
   *  resources for the current location. Pre-fetched once per
   *  turn by the API route via lib/world/regions. */
  regionFlavor?: {
    locationId: string;
    raceId: string | null;
    raceVoice: string | null;
    subPopulations: string[];
    signatureResources: string[];
  } | null;
}): Narrator {
  const mode = args.mode ?? getNarratorMode();
  if (mode === "remote") {
    // Lazy require so the Anthropic SDK is only loaded when we need it
    // (keeps cold-start fast on the template path).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RemoteNarrator } = require("./remote") as typeof import("./remote");
    return new RemoteNarrator({
      form: args.form,
      location: args.location,
      model: args.model,
      provider: args.provider,
      db: args.db,
      sessionId: args.sessionId,
      userId: args.userId,
      presetId: args.presetId,
      metaArcFlavor: args.metaArcFlavor,
      moodPreset: args.moodPreset,
      chapterFragment: args.chapterFragment,
      regionFlavor: args.regionFlavor,
    });
  }
  return new TemplateNarrator({ form: args.form, location: args.location });
}

export type { Narrator };
