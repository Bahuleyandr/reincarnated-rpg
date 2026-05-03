"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `register failed (${res.status})`);
        setBusy(false);
        return;
      }
      // First-time login: route to /reincarnate so the God of the new
      // world makes the first offer. If they already had an anon run
      // claimed during register, /reincarnate still works — they can
      // start a SECOND campaign from there or back out to /dashboard.
      const data = (await res.json().catch(() => ({}))) as {
        claimed?: { campaignId?: string };
      };
      if (data.claimed?.campaignId) {
        // The anon run was claimed — send them to dashboard which
        // shows the new campaign card.
        router.push("/dashboard");
      } else {
        router.push("/reincarnate");
      }
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="max-w-md w-full space-y-6 border border-stone-800 p-6 bg-stone-900/40"
      >
        <h1 className="text-xl text-stone-100">register</h1>
        <div className="space-y-2">
          <label className="block text-xs text-stone-500">email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-stone-500">
            username (shown on the leaderboard)
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            maxLength={32}
            className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-stone-500">
            password (≥8 chars)
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
          />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full border border-stone-300 text-stone-100 py-2 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50"
        >
          {busy ? "creating…" : "create account"}
        </button>
        <p className="text-xs text-stone-500 text-center">
          already registered?{" "}
          <Link
            href="/login"
            className="underline underline-offset-2 hover:text-stone-200"
          >
            log in
          </Link>
        </p>
      </form>
    </main>
  );
}
