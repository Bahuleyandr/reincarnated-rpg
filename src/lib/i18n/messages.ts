/**
 * Localization loader scaffold (T5.3, Phase-9 follow-up).
 *
 * Reads messages/<locale>.json and exposes a `t(key)` accessor
 * for dotted paths into the message tree. Defaults to 'en'.
 *
 * The substrate exists so a second locale (Spanish, Japanese,
 * etc.) can be added by copying messages/en.json to
 * messages/<locale>.json and translating values. No call sites
 * are wired in yet — this is scaffold; UI components can adopt
 * t() incrementally.
 *
 * Locale detection precedence:
 *   1. process.env.LOCALE if set
 *   2. fallback to 'en'
 *
 * Build-time: messages are loaded synchronously at module init
 * (small JSON, no network).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Locale = "en";
const SUPPORTED_LOCALES: Locale[] = ["en"];

interface MessageTree {
  [key: string]: string | MessageTree;
}

function loadMessages(locale: Locale): MessageTree {
  const path = join(process.cwd(), "messages", `${locale}.json`);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as MessageTree;
    return raw;
  } catch {
    return {};
  }
}

const cache: Partial<Record<Locale, MessageTree>> = {};

function getMessages(locale: Locale): MessageTree {
  if (!cache[locale]) cache[locale] = loadMessages(locale);
  return cache[locale]!;
}

function detectLocale(): Locale {
  const v = (process.env.LOCALE ?? "en").toLowerCase();
  if ((SUPPORTED_LOCALES as string[]).includes(v)) return v as Locale;
  return "en";
}

/**
 * Resolve a dotted-path key against the current locale's messages.
 * Returns the key itself when missing — easy to spot in UI.
 *
 *   t("home.tagline")       → "A persistent text RPG..."
 *   t("common.begin")       → "Begin"
 *   t("nope.notakey")       → "nope.notakey" (unmissable in UI)
 */
export function t(key: string, locale: Locale = detectLocale()): string {
  const tree = getMessages(locale);
  const parts = key.split(".");
  let node: string | MessageTree = tree;
  for (const p of parts) {
    if (typeof node !== "object" || node === null) return key;
    const child: string | MessageTree | undefined = (node as MessageTree)[p];
    if (child === undefined) return key;
    node = child;
  }
  return typeof node === "string" ? node : key;
}

/** Test/dev — clear the loaded message cache. */
export function _resetMessageCacheForTests(): void {
  for (const k of Object.keys(cache) as Locale[]) {
    delete cache[k];
  }
}

export const SUPPORTED = SUPPORTED_LOCALES;
