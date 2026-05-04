"use client";

/**
 * /forms/new — Phase 9 loop closure.
 *
 * Player-authored form submission. Submissions land in
 * player_forms with status='pending_review'; admins review at
 * /god/forms. On approval the spec is written to
 * content/forms/<slug>.json and the form pool grows.
 *
 * Power-user UI on purpose. Players who want to author a form
 * already understand vitals/stats shape from the existing form
 * pool. The placeholders + examples give them a head start;
 * server-side validation catches the rest.
 */
import Link from "next/link";
import { useState } from "react";

const VITALS_PLACEHOLDER = `{
  "cohesion": { "max": 100, "start": 100, "death": 0 },
  "essence":  { "max": 50,  "start": 25 }
}`;

const STATS_PLACEHOLDER = `{
  "guile": 1,
  "force": -2,
  "tides": 0
}`;

export default function NewFormPage() {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const [vitalsJson, setVitalsJson] = useState(VITALS_PLACEHOLDER);
  const [statsJson, setStatsJson] = useState(STATS_PLACEHOLDER);
  const [verbs, setVerbs] = useState("");
  const [negVocab, setNegVocab] = useState("");
  const [corpus, setCorpus] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let vitals: Record<string, unknown>;
      let stats: Record<string, unknown>;
      try {
        vitals = JSON.parse(vitalsJson);
      } catch {
        setMsg("vitals: invalid JSON");
        return;
      }
      try {
        stats = JSON.parse(statsJson);
      } catch {
        setMsg("stats: invalid JSON");
        return;
      }
      const spec = {
        vitals,
        stats,
        verbs: verbs
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
        negativeVocab: negVocab
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
        sampleCorpus: corpus
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
      const r = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, theme, spec }),
      });
      const data = (await r.json()) as { id?: string; error?: string };
      if (r.ok && data.id) {
        setMsg(`submitted — id ${data.id}. an admin will review.`);
        setName("");
        setTheme("");
        setVerbs("");
        setNegVocab("");
        setCorpus("");
      } else {
        setMsg(`error: ${data.error ?? r.statusText}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const labelCls = "block text-xs text-stone-400 mb-1";
  const inputCls =
    "w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm";
  const taCls = `${inputCls} font-mono`;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">submit a new form</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          authorship is open. the more your form leans into a particular
          way of <em>not</em> being a person — vocabulary you cannot use,
          verbs only this thing would do — the more interesting it plays.
          submissions land in a review queue; expect 1-3 days for admin
          review.
        </p>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="name" className={labelCls}>
              name (3-40 chars)
            </label>
            <input
              id="name"
              type="text"
              required
              minLength={3}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. lichen colony"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="theme" className={labelCls}>
              theme (1-200 chars; the elevator pitch)
            </label>
            <input
              id="theme"
              type="text"
              required
              maxLength={200}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="a hivemind of slow growth; perceives by chemical & light"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="vitals" className={labelCls}>
              vitals (JSON) — at least one
            </label>
            <textarea
              id="vitals"
              rows={6}
              value={vitalsJson}
              onChange={(e) => setVitalsJson(e.target.value)}
              className={taCls}
            />
          </div>

          <div>
            <label htmlFor="stats" className={labelCls}>
              stats (JSON) — at least one
            </label>
            <textarea
              id="stats"
              rows={5}
              value={statsJson}
              onChange={(e) => setStatsJson(e.target.value)}
              className={taCls}
            />
          </div>

          <div>
            <label htmlFor="verbs" className={labelCls}>
              verbs (3-8, comma-separated; what does this form DO?)
            </label>
            <input
              id="verbs"
              type="text"
              value={verbs}
              onChange={(e) => setVerbs(e.target.value)}
              placeholder="creep, photosynth, cluster, sense_chem"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="neg" className={labelCls}>
              negative vocab (comma-separated; words this form CANNOT use)
            </label>
            <input
              id="neg"
              type="text"
              value={negVocab}
              onChange={(e) => setNegVocab(e.target.value)}
              placeholder="hand, see, speak, walk, run, foot"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="corpus" className={labelCls}>
              sample corpus (blank-line-separated; 2-5 prose snippets the
              narrator will model after)
            </label>
            <textarea
              id="corpus"
              rows={8}
              value={corpus}
              onChange={(e) => setCorpus(e.target.value)}
              placeholder={`The damp opens a register of green for them.\n\nVibration in the rock — three legs, descending.`}
              className={taCls}
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "submitting…" : "submit for review"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
