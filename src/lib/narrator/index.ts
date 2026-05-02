/**
 * Narrator factory — env-flagged dispatch between TemplateNarrator and
 * RemoteNarrator. Default is "template" (M1; deterministic, no API
 * cost). Switching to "remote" lands on Day 8 with the Anthropic SDK.
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
}): Narrator {
  const mode = args.mode ?? getNarratorMode();
  if (mode === "remote") {
    // Lazy require to avoid loading the Anthropic SDK during tests.
    // Implementation lands Day 8 in src/lib/narrator/remote.ts.
    throw new Error(
      "RemoteNarrator is not implemented yet (Day 8). Set NARRATOR=template.",
    );
  }
  return new TemplateNarrator({ form: args.form, location: args.location });
}

export type { Narrator };
