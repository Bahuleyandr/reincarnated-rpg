"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  username: string;
}

interface Campaign {
  id: string;
  title: string;
  formId: string;
  locationId: string;
  status: string;
  createdAt: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        router.push("/login");
        return;
      }
      const { user: u } = (await meRes.json()) as { user: User | null };
      if (cancelled) return;
      if (!u) {
        router.push("/login");
        return;
      }
      setUser(u);
      const cRes = await fetch("/api/campaigns");
      if (cRes.ok) {
        const { campaigns: c } = (await cRes.json()) as {
          campaigns: Campaign[];
        };
        if (!cancelled) setCampaigns(c);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || "Untitled run",
          formId: "lesser-slime",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `create failed (${res.status})`);
        setBusy(false);
        return;
      }
      const { campaign } = (await res.json()) as { campaign: Campaign };
      setCampaigns((prev) => [campaign, ...prev]);
      setNewTitle("");
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">{user.username}'s runs</h1>
          <button
            type="button"
            onClick={logout}
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            sign out
          </button>
        </header>

        <form
          onSubmit={createCampaign}
          className="border border-stone-800 p-4 space-y-3 bg-stone-900/40"
        >
          <h2 className="text-stone-100 text-sm">new run</h2>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="title (e.g. 'first slime')"
            className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
          />
          <p className="text-xs text-stone-500">
            form: lesser-slime · location: collapsed-tunnel · 10-turn cap
          </p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-sm"
          >
            {busy ? "creating…" : "create"}
          </button>
        </form>

        <section className="space-y-2">
          <h2 className="text-stone-100 text-sm">all runs ({campaigns.length})</h2>
          {campaigns.length === 0 ? (
            <p className="text-stone-500 text-sm italic">none yet — create one above.</p>
          ) : (
            <ul className="divide-y divide-stone-800 border border-stone-800">
              {campaigns.map((c) => (
                <li key={c.id} className="px-4 py-3 flex items-center gap-4">
                  <span className="text-stone-100 flex-1">{c.title}</span>
                  <span className="text-xs text-stone-500">
                    {c.formId} · {c.status}
                  </span>
                  <Link
                    href={`/play?campaign=${c.id}`}
                    className="text-stone-300 hover:text-stone-100 underline underline-offset-2 text-xs"
                  >
                    open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
