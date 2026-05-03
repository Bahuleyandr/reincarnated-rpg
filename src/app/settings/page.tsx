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
  classifierModel: string | null;
  toneModel: string | null;
  useLlmClassifier: boolean;
  useLlmTone: boolean;
  hasKey: boolean;
  updatedAt: string;
}

interface CostBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  estCostUsd: number;
}
interface CostResponse {
  last24h: CostBucket;
  last7d: CostBucket;
  last30d: CostBucket;
  turns30d: number;
  byModel: Array<CostBucket & { model: string }>;
}

export default function SettingsPage() {
  const router = useRouter();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Form state
  const [presetId, setPresetId] = useState("anthropic");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [classifierModel, setClassifierModel] = useState("");
  const [toneModel, setToneModel] = useState("");
  const [useLlmClassifier, setUseLlmClassifier] = useState(false);
  const [useLlmTone, setUseLlmTone] = useState(false);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<
    | { ok: true; latencyMs: number; sample: string; model: string }
    | { ok: false; error: string; latencyMs?: number }
    | null
  >(null);

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

      const [r, c] = await Promise.all([
        fetch("/api/settings/llm"),
        fetch("/api/settings/cost"),
      ]);
      if (!r.ok) return;
      const d = (await r.json()) as { presets: Preset[]; prefs: Prefs | null };
      if (cancelled) return;
      setPresets(d.presets);
      setPrefs(d.prefs);
      if (d.prefs) {
        setPresetId(d.prefs.presetId);
        setModel(d.prefs.model);
        setBaseUrl(d.prefs.baseUrl ?? "");
        setClassifierModel(d.prefs.classifierModel ?? "");
        setToneModel(d.prefs.toneModel ?? "");
        setUseLlmClassifier(d.prefs.useLlmClassifier);
        setUseLlmTone(d.prefs.useLlmTone);
      } else {
        const def = d.presets.find((p) => p.id === "anthropic");
        if (def) {
          setPresetId(def.id);
          setModel(def.defaultModel);
          setBaseUrl(def.baseUrl ?? "");
        }
      }
      if (c.ok) {
        const cd = (await c.json()) as CostResponse;
        if (!cancelled) setCost(cd);
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
    setTestResult(null);
    setWarnings([]);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    if (prefs && prefs.presetId === id) {
      setModel(prefs.model);
      setBaseUrl(prefs.baseUrl ?? "");
      setClassifierModel(prefs.classifierModel ?? "");
      setToneModel(prefs.toneModel ?? "");
      setUseLlmClassifier(prefs.useLlmClassifier);
      setUseLlmTone(prefs.useLlmTone);
    } else {
      setModel(p.defaultModel);
      setBaseUrl(p.baseUrl ?? "");
      setClassifierModel("");
      setToneModel("");
      setUseLlmClassifier(false);
      setUseLlmTone(false);
    }
  }

  const currentPreset = presets.find((p) => p.id === presetId);

  async function runTest() {
    setTesting(true);
    setError(null);
    setSaved(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/llm/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId,
          model: model.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as
        | { ok: true; latencyMs: number; sample: string; model: string }
        | { ok: false; error: string; latencyMs?: number };
      setTestResult(d);
      setTesting(false);
    } catch (e) {
      setTestResult({
        ok: false,
        error: `network: ${e instanceof Error ? e.message : "?"}`,
      });
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId,
          model: model.trim(),
          baseUrl: baseUrl.trim(),
          classifierModel: classifierModel.trim() || undefined,
          toneModel: toneModel.trim() || undefined,
          useLlmClassifier,
          useLlmTone,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `save failed (${res.status})`);
        setBusy(false);
        return;
      }
      const d = (await res.json()) as {
        prefs: Prefs;
        warnings?: string[];
      };
      setPrefs(d.prefs);
      setApiKey("");
      setSaved("saved.");
      setWarnings(d.warnings ?? []);
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
    setWarnings([]);
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
      setClassifierModel("");
      setToneModel("");
      setUseLlmClassifier(false);
      setUseLlmTone(false);
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

        <CostPanel cost={cost} />

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
            <label className="block text-xs text-stone-400">
              narration model
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={currentPreset?.defaultModel ?? ""}
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
            />
            <p className="text-[10px] text-stone-600 leading-4">
              The smart model that writes prose + emits state-changing tool
              calls. Per-provider format. e.g. claude-sonnet-4-6, gpt-4o-mini,
              MiniMax-Text-01, anthropic/claude-sonnet-4-6 (OpenRouter).
            </p>
          </div>

          <details className="border border-stone-800 bg-stone-950/50">
            <summary className="px-3 py-2 text-xs text-stone-400 cursor-pointer hover:text-stone-200">
              advanced: per-call-type model split
            </summary>
            <div className="p-3 space-y-3 border-t border-stone-800">
              <p className="text-[10px] text-stone-600 leading-4">
                The classifier maps free-text input to a verb. The tone judge
                catches off-form prose. Both default to a free regex layer —
                turning these on swaps in a cheap LLM call per turn (best for
                ambiguous inputs / strict tone). Use a small fast model like{" "}
                <code className="text-stone-500">claude-haiku-4-5</code>,{" "}
                <code className="text-stone-500">gpt-4o-mini</code>, or{" "}
                <code className="text-stone-500">
                  meta-llama/llama-3.1-8b-instruct
                </code>
                .
              </p>

              <label className="flex items-start gap-2 text-xs text-stone-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLlmClassifier}
                  onChange={(e) => setUseLlmClassifier(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  use LLM classifier
                  <span className="block text-[10px] text-stone-600 leading-4">
                    Falls back to regex on confidence &lt; 0.5.
                  </span>
                </span>
              </label>
              {useLlmClassifier && (
                <input
                  type="text"
                  value={classifierModel}
                  onChange={(e) => setClassifierModel(e.target.value)}
                  placeholder="leave blank to use the narration model"
                  className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
                />
              )}

              <label className="flex items-start gap-2 text-xs text-stone-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLlmTone}
                  onChange={(e) => setUseLlmTone(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  use LLM tone judge
                  <span className="block text-[10px] text-stone-600 leading-4">
                    Second-pass quality gate after the regex check.
                  </span>
                </span>
              </label>
              {useLlmTone && (
                <input
                  type="text"
                  value={toneModel}
                  onChange={(e) => setToneModel(e.target.value)}
                  placeholder="leave blank to use the narration model"
                  className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
                />
              )}
            </div>
          </details>

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
          {warnings.length > 0 && (
            <ul className="text-amber-300 text-xs space-y-1">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {testResult &&
            (testResult.ok ? (
              <p className="text-emerald-400 text-xs">
                ✓ connected in {testResult.latencyMs}ms · model{" "}
                <span className="text-stone-300">{testResult.model}</span>{" "}
                replied:{" "}
                <span className="text-stone-300">
                  &ldquo;{testResult.sample.trim()}&rdquo;
                </span>
              </p>
            ) : (
              <p className="text-red-400 text-xs">
                ✗ test failed
                {testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ""}:{" "}
                <span className="text-stone-400">{testResult.error}</span>
              </p>
            ))}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || testing}
              className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-sm"
            >
              {busy ? "saving…" : "save"}
            </button>
            <button
              type="button"
              onClick={runTest}
              disabled={busy || testing}
              className="border border-stone-700 text-stone-300 py-1 px-4 hover:border-stone-500 hover:text-stone-100 transition-colors disabled:opacity-50 text-sm"
            >
              {testing ? "testing…" : "test connection"}
            </button>
            {prefs && (
              <button
                type="button"
                onClick={clear}
                disabled={busy || testing}
                className="border border-stone-700 text-stone-400 py-1 px-4 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-50 text-sm ml-auto"
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

function CostPanel({ cost }: { cost: CostResponse | null }) {
  if (!cost) return null;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const usd = (n: number) =>
    n < 0.01 ? `$<0.01` : `$${n.toFixed(2)}`;
  return (
    <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
      <h2 className="text-stone-100 text-sm">cost (your runs)</h2>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          ["last 24h", cost.last24h],
          ["last 7d", cost.last7d],
          ["last 30d", cost.last30d],
        ].map(([label, b]) => (
          <div
            key={label as string}
            className="border border-stone-800 p-3 bg-stone-950 space-y-1"
          >
            <div className="text-stone-500">{label as string}</div>
            <div className="text-stone-100">
              {usd((b as CostBucket).estCostUsd)}
              <span className="text-stone-600 text-[10px]"> est</span>
            </div>
            <div className="text-stone-500 text-[10px]">
              {(b as CostBucket).calls} calls ·{" "}
              {fmt(
                (b as CostBucket).inputTokens +
                  (b as CostBucket).cacheReadTokens +
                  (b as CostBucket).cacheCreateTokens,
              )}
              {" → "}
              {fmt((b as CostBucket).outputTokens)} tok
            </div>
          </div>
        ))}
      </div>
      {cost.byModel.length > 0 && (
        <div className="text-[11px] text-stone-500 space-y-1">
          <div className="text-stone-400 mb-1">by model (last 30d)</div>
          {cost.byModel.slice(0, 5).map((m) => (
            <div
              key={m.model}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-stone-300 truncate">{m.model}</span>
              <span className="text-stone-500 whitespace-nowrap">
                {m.calls} calls · {fmt(m.inputTokens)}/{fmt(m.outputTokens)} tok
                · {usd(m.estCostUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-stone-600 leading-4">
        Cost estimate is accurate for Anthropic models (we know the rates).
        Other providers report tokens only — check your provider's dashboard
        for the dollar figure.
      </p>
    </section>
  );
}
