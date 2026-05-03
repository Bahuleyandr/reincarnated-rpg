"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `login failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/dashboard");
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
        <h1 className="text-xl text-stone-100">log in</h1>
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
          <label className="block text-xs text-stone-500">password</label>
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
          {busy ? "signing in…" : "sign in"}
        </button>
        <p className="text-xs text-stone-500 text-center">
          no account?{" "}
          <Link
            href="/register"
            className="underline underline-offset-2 hover:text-stone-200"
          >
            register
          </Link>
        </p>
      </form>
    </main>
  );
}
