/**
 * Narrator factory — env-flagged dispatch between TemplateNarrator and
 * RemoteNarrator. Default is "template" (M1; deterministic, no API
 * cost). Set NARRATOR=remote (and ANTHROPIC_API_KEY) to use Sonnet 4.6
 * via the Anthropic SDK with prompt caching.
 */
import type {
  FormTemplate,
  LocationTemplate,
  Narrator,
} from "../game/types";

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
}): Narrator {
  const mode = args.mode ?? getNarratorMode();
  if (mode === "remote") {
    // Lazy require so the Anthropic SDK is only loaded when we need it
    // (keeps cold-start fast on the template path).
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { RemoteNarrator } = require("./remote") as typeof import("./remote");
    return new RemoteNarrator({
      form: args.form,
      location: args.location,
      model: args.model,
      provider: args.provider,
      db: args.db,
      sessionId: args.sessionId,
    });
  }
  return new TemplateNarrator({ form: args.form, location: args.location });
}

export type { Narrator };
