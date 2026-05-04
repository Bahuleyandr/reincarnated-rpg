"use client";

/**
 * /marketplace — Phase 9 loop closure.
 *
 * Two tabs:
 *   - Browse: public active listings, cheapest-first; optional
 *     itemId + minPrice filter; Buy button (logged-in users).
 *   - Yours: the logged-in user's own listings (any status);
 *     Cancel button on active rows.
 *
 * Note: listing NEW items happens through the in-game `list_item`
 * tool (not yet exposed; Phase 9 follow-up will surface a "list
 * to marketplace" affordance from the inventory UI). For now
 * this page is browse + manage.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Listing {
  id: string;
  itemId: string;
  qty: number;
  pricePerUnit: number;
  note: string | null;
  sellerUserId: string;
  listedAtMs: number;
  expiresAtMs: number;
  status?: string;
  buyerUserId?: string | null;
  soldAtMs?: number | null;
}

type Tab = "browse" | "yours";

export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [browse, setBrowse] = useState<Listing[]>([]);
  const [mine, setMine] = useState<Listing[]>([]);
  const [filterItem, setFilterItem] = useState("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadBrowse = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterItem.trim()) params.set("itemId", filterItem.trim());
    if (minPrice.trim()) params.set("minPrice", minPrice.trim());
    const r = await fetch(`/api/marketplace?${params.toString()}`);
    if (r.ok) {
      const data = (await r.json()) as { listings: Listing[] };
      setBrowse(data.listings);
    }
  }, [filterItem, minPrice]);

  const loadMine = useCallback(async () => {
    const r = await fetch(`/api/marketplace?mine=1`);
    if (r.ok) {
      const data = (await r.json()) as { listings: Listing[] };
      setMine(data.listings);
    } else if (r.status === 401) {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    // Defer to a microtask — calling setState synchronously inside
    // an effect trips React 19's react-hooks/set-state-in-effect rule.
    void Promise.resolve().then(() =>
      tab === "browse" ? loadBrowse() : loadMine(),
    );
  }, [tab, loadBrowse, loadMine]);

  async function handleBuy(id: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/${id}?action=buy`, {
        method: "POST",
      });
      const data = (await r.json()) as
        | {
            ok: true;
            buyerSpent: number;
            sinkFee: number;
            sellerEarned: number;
          }
        | { ok: false; error: string };
      if (data.ok) {
        setMsg(
          `bought — paid ${data.buyerSpent} (${data.sinkFee} sink, ${data.sellerEarned} to seller)`,
        );
        await loadBrowse();
      } else {
        setMsg(`error: ${data.error}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/${id}?action=cancel`, {
        method: "POST",
      });
      const data = (await r.json()) as
        | { ok: true; itemId: string; qty: number }
        | { ok: false; error: string };
      if (data.ok) {
        setMsg(`cancelled — ${data.qty}× ${data.itemId} returned`);
        await loadMine();
      } else {
        setMsg(`error: ${data.error}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    active
      ? "px-3 py-1 text-stone-100 border-b border-stone-300"
      : "px-3 py-1 text-stone-500 hover:text-stone-300";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">marketplace</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          player listings. 7-day expiry. 10% sink fee on every sale —
          coins drain from the economy at 1/10 of every transaction so
          coin floods don&apos;t accumulate. items are escrowed at list
          time; cancel returns them.
        </p>

        <nav className="flex gap-1 border-b border-stone-800">
          <button
            type="button"
            className={tabClass(tab === "browse")}
            onClick={() => setTab("browse")}
          >
            browse
          </button>
          <button
            type="button"
            className={tabClass(tab === "yours")}
            onClick={() => setTab("yours")}
          >
            your listings
          </button>
        </nav>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        {tab === "browse" && (
          <section className="space-y-3">
            <form
              className="flex gap-2 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                void loadBrowse();
              }}
            >
              <input
                type="text"
                value={filterItem}
                onChange={(e) => setFilterItem(e.target.value)}
                placeholder="filter by item id (e.g. iron-ingot)"
                className="flex-1 bg-stone-900 border border-stone-700 px-2 py-1 rounded text-stone-200"
              />
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="min price"
                className="w-24 bg-stone-900 border border-stone-700 px-2 py-1 rounded text-stone-200"
              />
              <button
                type="submit"
                className="px-3 py-1 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-200"
              >
                filter
              </button>
            </form>

            {browse.length === 0 ? (
              <p className="text-xs text-stone-600">no active listings.</p>
            ) : (
              <ul className="divide-y divide-stone-800 border border-stone-800 rounded">
                {browse.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between p-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-stone-200">
                        <span className="font-semibold">{l.itemId}</span>
                        <span className="text-stone-500"> ×{l.qty}</span>
                        <span className="text-stone-400">
                          {" "}
                          @ {l.pricePerUnit} ea ({l.qty * l.pricePerUnit}{" "}
                          total)
                        </span>
                      </div>
                      {l.note && (
                        <div className="text-xs text-stone-500 mt-0.5 truncate">
                          {l.note}
                        </div>
                      )}
                      <div className="text-[10px] text-stone-600 mt-0.5">
                        expires{" "}
                        {new Date(l.expiresAtMs).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleBuy(l.id)}
                      className="ml-3 px-3 py-1 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      buy
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "yours" && (
          <section className="space-y-3">
            {mine.length === 0 ? (
              <p className="text-xs text-stone-600">
                no listings. (list items via the in-game `list_item` tool —
                say &quot;list 3 iron ingots at 30c&quot; while playing.)
              </p>
            ) : (
              <ul className="divide-y divide-stone-800 border border-stone-800 rounded">
                {mine.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between p-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-stone-200">
                        <span className="font-semibold">{l.itemId}</span>
                        <span className="text-stone-500"> ×{l.qty}</span>
                        <span className="text-stone-400">
                          {" "}
                          @ {l.pricePerUnit} ea
                        </span>
                        <span
                          className={`ml-2 text-[10px] uppercase tracking-wide ${
                            l.status === "active"
                              ? "text-emerald-500"
                              : l.status === "sold"
                                ? "text-amber-500"
                                : "text-stone-600"
                          }`}
                        >
                          {l.status ?? "active"}
                        </span>
                      </div>
                      {l.note && (
                        <div className="text-xs text-stone-500 mt-0.5 truncate">
                          {l.note}
                        </div>
                      )}
                    </div>
                    {l.status === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleCancel(l.id)}
                        className="ml-3 px-3 py-1 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
