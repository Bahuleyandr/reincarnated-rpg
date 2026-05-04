/**
 * Public read-only run transcript. Anyone with the share-token URL
 * can render the campaign's narrative as a story — no auth, no
 * mutation. The campaign's events power the timeline.
 *
 * Privacy: only narration.emitted + roll.resolved + session.ended
 * are surfaced. Player input lines (turn.begun.input) are
 * deliberately omitted to avoid leaking anything the player typed
 * — only the narrator's prose + the dice + the verdict are shown.
 */
import { eq, and, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db/client";
import { campaigns, events as eventsTable, sessions, users } from "@/lib/db/schema";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RunPage({ params }: PageProps) {
  const { token } = await params;
  const rows = await db
    .select({
      id: campaigns.id,
      userId: campaigns.userId,
      title: campaigns.title,
      formId: campaigns.formId,
      locationId: campaigns.locationId,
      reincarnatedAs: campaigns.reincarnatedAs,
      status: campaigns.status,
      sharedAt: campaigns.sharedAt,
      createdAt: campaigns.createdAt,
      endedAt: campaigns.endedAt,
    })
    .from(campaigns)
    .where(
      and(eq(campaigns.shareToken, token), isNotNull(campaigns.shareToken)),
    )
    .limit(1);
  const campaign = rows[0];
  if (!campaign) notFound();

  // Owner username (best-effort).
  const owner = (
    await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, campaign.userId))
      .limit(1)
  )[0];

  // Sessions in this campaign.
  const sessionRows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.campaignId, campaign.id));
  const sessionIds = sessionRows.map((s) => s.id);

  // Events for those sessions.
  const eventRows = sessionIds.length
    ? await db
        .select({
          kind: eventsTable.kind,
          payload: eventsTable.payload,
          createdAt: eventsTable.createdAt,
        })
        .from(eventsTable)
        .where(eq(eventsTable.sessionId, sessionIds[0]))
        .orderBy(eventsTable.seq)
    : [];

  // Project: only narration / roll / session-ended.
  type Beat =
    | { kind: "narration"; text: string }
    | { kind: "roll"; total: number; band: string }
    | { kind: "ended"; reason: string };
  const beats: Beat[] = [];
  for (const e of eventRows) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.kind === "narration.emitted") {
      const text = typeof p.text === "string" ? p.text : "";
      if (text) beats.push({ kind: "narration", text });
    } else if (e.kind === "roll.resolved") {
      const roll = p.roll as { total?: number; band?: string } | undefined;
      if (roll && typeof roll.total === "number" && typeof roll.band === "string") {
        beats.push({ kind: "roll", total: roll.total, band: roll.band });
      }
    } else if (e.kind === "session.ended") {
      const reason = typeof p.reason === "string" ? p.reason : "unknown";
      beats.push({ kind: "ended", reason });
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-stone-600">
            shared run
          </p>
          <h1 className="text-xl text-stone-100">
            {campaign.reincarnatedAs ?? campaign.title}
          </h1>
          <p className="text-stone-500 text-xs">
            {campaign.formId} · {campaign.locationId} · {campaign.status}
            {owner && (
              <>
                {" "}· run by{" "}
                <span className="text-stone-300">{owner.username}</span>
              </>
            )}
          </p>
        </header>

        <section className="space-y-4">
          {beats.length === 0 ? (
            <p className="text-stone-600 italic text-sm">
              this run has no recorded narration yet.
            </p>
          ) : (
            beats.map((b, i) => {
              if (b.kind === "narration") {
                return (
                  <p key={i} className="text-stone-200 leading-7">
                    {b.text}
                  </p>
                );
              }
              if (b.kind === "roll") {
                const tone =
                  b.band === "success"
                    ? "text-emerald-400"
                    : b.band === "miss"
                      ? "text-red-400"
                      : "text-amber-300";
                return (
                  <p key={i} className={`text-xs ${tone} text-center select-none`}>
                    🎲 {b.total} ({b.band})
                  </p>
                );
              }
              const verdictTone =
                b.reason === "win"
                  ? "text-amber-300"
                  : b.reason === "death"
                    ? "text-red-400"
                    : "text-stone-400";
              return (
                <p
                  key={i}
                  className={`${verdictTone} text-sm text-center tracking-widest uppercase pt-4 border-t border-stone-900`}
                >
                  ✦ {b.reason}
                </p>
              );
            })
          )}
        </section>

        <footer className="border-t border-stone-900 pt-4 text-[10px] text-stone-600 text-center">
          <Link href="/" className="hover:text-stone-400 underline underline-offset-2">
            reincarnate yourself →
          </Link>
        </footer>
      </div>
    </main>
  );
}
