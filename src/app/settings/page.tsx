"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Preset {
  id: string;
  label: string;
  kind: "anthropic" | "openai-compatible";
  baseUrl?: string;
  baseUrlEditable: boolean;
  defaultModel: string;
  blurb: string;
  needsApiKey: boolean;
}

interface Prefs {
  presetId: string;
  providerKind: "anthropic" | "openai-compatible";
  baseUrl: string | null;
  model: string;
  hasKey: boolean;
  updatedAt: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Form state
  const [presetId, setPresetId] = useState("anthropic");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        router.push("/login");
        return;
      }
      const { user } = (await meRes.json()) as { user: unknown };
      if (cancelled) return;
      if (!user) {
        router.push("/login");
        return;
      }

      const r = await fetch("/api/settings/llm");
      if (!r.ok) return;
      const d = (await r.json()) as { presets: Preset[]; prefs: Prefs | null };
      if (cancelled) return;
      setPresets(d.presets);
      setPrefs(d.prefs);
      if (d.prefs) {
        setPresetId(d.prefs.presetId);
        setModel(d.prefs.model);
        setBaseUrl(d.prefs.baseUrl ?? "");
      } else {
        const def = d.presets.find((p) => p.id === "anthropic");
        if (def) {
          setPresetId(def.id);
          setModel(def.defaultModel);
          setBaseUrl(def.baseUrl ?? "");
        }
      }
      setLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function selectPreset(id: string) {
    setPresetId(id);
    setSaved(null);
    setError(null);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    // When switching presets, prefill model + baseUrl from the preset
    // unless we already have saved prefs for this exact preset (then
    // keep the user's customized values).
    if (prefs && prefs.presetId === id) {
      setModel(prefs.model);
      setBaseUrl(prefs.baseUrl ?? "");
    } else {
      setModel(p.defaultModel);
      setBaseUrl(p.baseUrl ?? "");
    }
  }

  const currentPreset = presets.find((p) => p.id === presetId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId,
          model: model.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `save failed (${res.status})`);
        setBusy(false);
        return;
      }
      const d = (await res.json()) as { prefs: Prefs };
      setPrefs(d.prefs);
      setApiKey("");
      setSaved("saved.");
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Reset LLM settings to the deploy default?")) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/settings/llm", { method: "DELETE" });
      if (!res.ok) {
        setError(`clear failed (${res.status})`);
        setBusy(false);
        return;
      }
      setPrefs(null);
      const def = presets.find((p) => p.id === "anthropic");
      if (def) {
        setPresetId(def.id);
        setModel(def.defaultModel);
        setBaseUrl(def.baseUrl ?? "");
      }
      setApiKey("");
      setSaved("cleared. now using the deploy default.");
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">LLM settings</h1>
          <Link
            href="/dashboard"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← back to runs
          </Link>
        </header>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-2 text-xs text-stone-400 leading-5">
          <p>
            Bring your own LLM. Pick a provider, paste your API key, and your
            future runs use it instead of the deploy default. Your key is
            encrypted at rest with AES-256-GCM (key derived from the server's
            session secret) — it is never returned to your browser after save.
          </p>
          <p className="text-stone-500">
            Status:{" "}
            {prefs ? (
              <span className="text-stone-300">
                using <span className="text-stone-100">{prefs.presetId}</span> ·{" "}
                <span className="text-stone-100">{prefs.model}</span>
                {prefs.hasKey ? " · key on file" : " · no key"}
              </span>
            ) : (
              <span className="text-stone-500 italic">
                using deploy default (whatever AI_PROVIDER is set to in env)
              </span>
            )}
          </p>
        </section>

        <form
          onSubmit={save}
          className="border border-stone-800 p-4 space-y-4 bg-stone-900/40"
        >
          <div className="space-y-2">
            <label className="block text-xs text-stone-400">provider</label>
            <select
              value={presetId}
              onChange={(e) => selectPreset(e.target.value)}
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {currentPreset && (
              <p className="text-[11px] text-stone-500 leading-4">
                {currentPreset.blurb}
              </p>
            )}
          </div>

          {currentPreset?.kind === "openai-compatible" && (
            <div className="space-y-1">
              <label className="block text-xs text-stone-400">
                base URL{" "}
                {!currentPreset.baseUrlEditable && (
                  <span className="text-stone-600">(fixed)</span>
                )}
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!currentPreset.baseUrlEditable}
                placeholder={currentPreset.baseUrl ?? "https://..."}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500 disabled:opacity-50"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs text-stone-400">model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={currentPreset?.defaultModel ?? ""}
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
            />
            <p className="text-[10px] text-stone-600 leading-4">
              Per-provider format. e.g. claude-sonnet-4-6, gpt-4o-mini,
              MiniMax-Text-01, anthropic/claude-sonnet-4-6 (OpenRouter).
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs text-stone-400">
              API key{" "}
              {prefs?.hasKey && presetId === prefs.presetId && (
                <span className="text-stone-600">
                  (key on file — leave blank to keep)
                </span>
              )}
              {!currentPreset?.needsApiKey && (
                <span className="text-stone-600">(not required)</span>
              )}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                !currentPreset?.needsApiKey ? "(none — local model)" : "sk-…"
              }
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500 font-mono"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          {saved && <p className="text-emerald-400 text-xs">{saved}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-sm"
            >
              {busy ? "saving…" : "save"}
            </button>
            {prefs && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="border border-stone-700 text-stone-400 py-1 px-4 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-50 text-sm"
              >
                reset to deploy default
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
