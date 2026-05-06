"use client";

/**
 * NudgeBanner — POLISH_PLAN sub-phase 0c.5.
 *
 * Renders the current onboarding nudge (when one applies) above the
 * verb-button surface on /play. Dismissing one drops its id into
 * localStorage so it never re-surfaces in this browser. The /api/state
 * call passes the dismissed ids back so the server-side runner skips
 * them on subsequent turns.
 *
 * The banner is intentionally subtle: small, single-line, dismissible
 * with one tap. Its job is "I'm here when you need me," not
 * "interrupt your read."
 */
import { useEffect } from "react";

interface Props {
  nudge: { id: string; text: string } | null;
  /** Called when the player dismisses. Parent persists the id and
   *  re-fetches state with the updated `dismissedNudgeIds` so a new
   *  nudge can fire next turn. */
  onDismiss(id: string): void;
}

export function NudgeBanner({ nudge, onDismiss }: Props) {
  // Auto-fade after 30s on first paint — the player isn't blocked
  // by the banner; if they ignore it, fade it out so the surface
  // doesn't accumulate visual debt.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => {
      onDismiss(nudge.id);
    }, 30_000);
    return () => clearTimeout(t);
  }, [nudge, onDismiss]);

  if (!nudge) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-nudge-id={nudge.id}
      className="px-4 py-2 border-t border-stone-800 bg-stone-900/40 text-[11px] text-stone-300 leading-snug flex items-start gap-3"
    >
      <span
        className="mt-0.5 select-none"
        style={{ color: "var(--form-accent)" }}
        aria-hidden="true"
      >
        ✦
      </span>
      <p className="flex-1">{nudge.text}</p>
      <button
        type="button"
        onClick={() => onDismiss(nudge.id)}
        className="ml-2 text-stone-500 hover:text-stone-300 active:text-stone-100 transition-colors px-1 -my-1"
        aria-label="dismiss this hint"
      >
        ✕
      </button>
    </div>
  );
}

// ---- localStorage persistence (small util used by /play) ------------

const STORAGE_KEY = "rrpg.dismissedNudgeIds";

/** Read the dismissed-id set from localStorage. SSR-safe (returns
 *  empty list when window is undefined). */
export function readDismissedNudgeIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Persist a newly-dismissed nudge id. Idempotent. */
export function recordDismissedNudgeId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = readDismissedNudgeIds();
    if (current.includes(id)) return;
    const next = [...current, id];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be disabled (Safari private mode, blocked
    // cookies, etc.); we silently no-op.
  }
}
