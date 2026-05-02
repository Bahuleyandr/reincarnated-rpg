/**
 * Runtime content loaders. Reads from `content/` on disk so dev/turn
 * loops don't have to round-trip through Postgres for every read.
 * The seed script keeps templates_* in sync for query-only flows.
 *
 * Safe to call from API routes; the JSONs are tiny.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  FormTemplate,
  LocationTemplate,
} from "./types";
import type { BeatPack } from "./beats";

const REPO_ROOT = process.cwd();

export function loadForm(id: string): FormTemplate {
  const path = join(REPO_ROOT, "content", "forms", `${id}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as FormTemplate;
}

export function loadLocation(id: string): LocationTemplate {
  const path = join(REPO_ROOT, "content", "locations", `${id}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as LocationTemplate;
}

export function loadBeatPack(id: string): BeatPack {
  const path = join(REPO_ROOT, "content", "beats", `${id}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as BeatPack;
}
