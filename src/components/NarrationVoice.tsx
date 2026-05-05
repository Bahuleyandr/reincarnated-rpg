"use client";

/**
 * NarrationVoice — opt-in TTS for the play-page transcript.
 *
 * Trial-run / proposal C (the "more than text" question): hosted
 * TTS like ElevenLabs is the right end state, but it costs per
 * character and adds backend complexity. As a v1, the browser's
 * built-in SpeechSynthesis API gives us free, offline, immediate
 * narration — the voice quality varies by OS but the experience
 * pivot ("the world reading itself to me") is what matters.
 *
 * Behavior:
 *   - A single toggle in the play-page header turns voice on/off.
 *     Preference persists in localStorage.
 *   - Once on, every NEW narration (entries[entries.length - 1]
 *     when its kind === 'narration') is spoken aloud.
 *   - Voice settings: prefer an English voice; otherwise the
 *     browser default.
 *   - Speech is cancelled when the user toggles off, navigates
 *     away, or starts a new turn (so we never overlap two
 *     narrations).
 *
 * Accessibility: this is text-as-audio, intended as opt-in flair
 * rather than primary input. Screen-reader users have their own
 * tooling.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "reincarnated.narrationVoice.enabled";

interface Props {
  /** Most recent narration text the play page has rendered. The
   *  component speaks it whenever this prop changes (and voice is
   *  enabled). */
  latestNarration: string | null;
  /** Reset key — typically the projection's upToSeq. Forces the
   *  speech to cancel on each new turn so two narrations never
   *  overlap. */
  resetKey: string | number;
}

export function NarrationVoice({ latestNarration, resetKey }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const lastSpokenRef = useRef<string | null>(null);

  // Detect support + restore preference on mount. Defer the
  // setState calls to a microtask so React 19's
  // react-hooks/set-state-in-effect rule passes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok =
      typeof window.speechSynthesis !== "undefined" &&
      typeof window.SpeechSynthesisUtterance !== "undefined";
    let storedEnabled = false;
    if (ok) {
      try {
        storedEnabled = window.localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        /* localStorage may be unavailable in incognito; ignore */
      }
    }
    void Promise.resolve().then(() => {
      setSupported(ok);
      if (ok) setEnabled(storedEnabled);
    });
  }, []);

  // Cancel any in-flight speech on toggle-off, on unmount, or on
  // resetKey change (a new turn started).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enabled) {
      window.speechSynthesis?.cancel();
    }
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, [enabled, resetKey]);

  // Speak when a fresh narration arrives.
  useEffect(() => {
    if (!enabled || !supported) return;
    if (!latestNarration) return;
    if (latestNarration === lastSpokenRef.current) return;
    lastSpokenRef.current = latestNarration;
    void Promise.resolve().then(() => {
      const utter = new SpeechSynthesisUtterance(latestNarration);
      // Prefer an English voice when one is available; fall back
      // to the first voice the browser advertises.
      const voices = window.speechSynthesis.getVoices();
      const english =
        voices.find((v) => /^en[-_]/.test(v.lang)) ?? voices[0];
      if (english) utter.voice = english;
      utter.rate = 0.95;
      utter.pitch = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    });
  }, [latestNarration, enabled, supported]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        if (next) window.localStorage.setItem(STORAGE_KEY, "1");
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      // Clear "lastSpoken" so toggling off-then-on speaks the
      // current narration once.
      lastSpokenRef.current = null;
      return next;
    });
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={
        enabled ? "stop narrating aloud" : "narrate the prose aloud"
      }
      title={
        enabled ? "narrating aloud — click to stop" : "narrate aloud"
      }
      className={`text-[10px] px-2 py-0.5 border rounded transition-colors ${
        enabled
          ? "border-stone-300 text-stone-100"
          : "border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500"
      }`}
    >
      {enabled ? "🔊 narrating" : "🔈 silent"}
    </button>
  );
}
