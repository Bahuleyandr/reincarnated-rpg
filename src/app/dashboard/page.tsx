"use client";

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
  reincarnatedAs: string | null;
  status: string;
  createdAt: string;
}

/** Curated list for "surprise me". Half are typed-form aware (slime), half
 *  exercise the generic-creature path so the model has to flavor on prose. */
const SURPRISE_POOL: string[] = [
  "a lesser slime",
  "a cursed book left on an altar",
  "a dragon egg, still warm",
  "a dungeon core newly awakened",
  "a knight's discarded helmet, sentient",
  "a cartographer's ghost",
  "a coin that has changed hands too many times",
  "a wolf, wounded and hungry",
  "a cellar door that should not have opened",
  "a candle still burning at the bottom of a well",
  "a memory of a name no one will say aloud",
  "an apprentice who fell into the wrong puddle",
];

function pickSurprise(): string {
  const i = Math.floor(Math.random() * SURPRISE_POOL.length);
  return SURPRISE_POOL[i];
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reincarnatedAs, setReincarnatedAs] = useState("");
  const [title, setTitle] = useState("");

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

  async function submitNewRun(declaration: string, runTitle?: string) {
    setBusy(true);
    setError(null);
    try {
      // Server derives formId from reincarnatedAs (slime→typed,
      // everything else→generic-creature) and randomizes locationId.
      const cRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: runTitle?.trim() || undefined,
          reincarnatedAs: declaration.trim() || undefined,
        }),
      });
      if (!cRes.ok) {
        const data = (await cRes.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `create failed (${cRes.status})`);
        setBusy(false);
        return;
      }
      const { campaign } = (await cRes.json()) as { campaign: Campaign };
      // Immediately start a session in it and jump to /play.
      const sRes = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      });
      if (!sRes.ok) {
        // Fall back: campaign exists; user can open it from the list.
        setCampaigns((prev) => [campaign, ...prev]);
        setReincarnatedAs("");
        setTitle("");
        setBusy(false);
        return;
      }
      router.push("/play");
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    await submitNewRun(reincarnatedAs, title);
  }

  async function surpriseMe() {
    const pick = pickSurprise();
    setReincarnatedAs(pick);
    await submitNewRun(pick);
  }

  async function openCampaign(campaignId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `open failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/play");
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
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

          <label className="block space-y-1">
            <span className="text-xs text-stone-400">
              what do you wake up as?
            </span>
            <input
              type="text"
              value={reincarnatedAs}
              onChange={(e) => setReincarnatedAs(e.target.value)}
              placeholder="a cursed book · a dragon egg · a lesser slime · a dungeon core"
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
            />
            <span className="block text-[10px] text-stone-600">
              free text. leave blank to default to a lesser slime. say
              "slime" for the typed form; anything else uses the generic
              shape and the narrator flavors the prose.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-stone-400">
              title <span className="text-stone-600">(optional)</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="defaults to your reincarnation"
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500"
            />
          </label>

          <p className="text-xs text-stone-500">
            location is rolled randomly · 10-turn cap
          </p>
          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-sm"
            >
              {busy ? "creating…" : "begin"}
            </button>
            <button
              type="button"
              onClick={surpriseMe}
              disabled={busy}
              className="border border-stone-700 text-stone-300 py-1 px-4 hover:border-stone-500 hover:text-stone-100 transition-colors disabled:opacity-50 text-sm"
            >
              surprise me
            </button>
          </div>
        </form>

        <section className="space-y-2">
          <h2 className="text-stone-100 text-sm">all runs ({campaigns.length})</h2>
          {campaigns.length === 0 ? (
            <p className="text-stone-500 text-sm italic">none yet — create one above.</p>
          ) : (
            <ul className="divide-y divide-stone-800 border border-stone-800">
              {campaigns.map((c) => (
                <li
                  key={c.id}
                  className="px-4 py-3 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-stone-100 truncate">{c.title}</div>
                    {c.reincarnatedAs && c.reincarnatedAs !== c.title && (
                      <div className="text-[11px] text-stone-500 truncate">
                        as {c.reincarnatedAs}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-stone-500 whitespace-nowrap">
                    {c.formId} · {c.locationId} · {c.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => openCampaign(c.id)}
                    className="text-stone-300 hover:text-stone-100 underline underline-offset-2 text-xs"
                  >
                    open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
