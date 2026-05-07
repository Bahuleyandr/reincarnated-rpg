"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getManualTopic,
  isManualTopicId,
  MANUAL_TOPICS,
  type ManualTopicId,
} from "@/lib/game/manual";

const MANUAL_OPEN_EVENT = "rrpg:manual-open";

interface ManualOpenDetail {
  topicId?: ManualTopicId;
}

interface InstructionManualProps {
  defaultTopicId?: ManualTopicId;
}

interface ManualHelpButtonProps {
  topicId?: ManualTopicId;
  label?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
}

export function openInstructionManual(topicId: ManualTopicId = "basics") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ManualOpenDetail>(MANUAL_OPEN_EVENT, {
      detail: { topicId },
    }),
  );
}

export function ManualHelpButton({
  topicId = "basics",
  label = "?",
  compact = false,
  className = "",
  testId,
}: ManualHelpButtonProps) {
  const visibleLabel = compact ? "?" : label;
  const ariaLabel =
    topicId === "basics"
      ? "open manual"
      : `open ${getManualTopic(topicId).label.toLowerCase()} manual`;

  return (
    <button
      type="button"
      onClick={() => openInstructionManual(topicId)}
      title={ariaLabel}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`inline-flex shrink-0 items-center justify-center border border-stone-700 bg-stone-950/40 text-stone-400 hover:border-[var(--form-accent-border)] hover:text-stone-100 focus:ring-1 focus:ring-stone-500 focus:outline-none ${
        compact
          ? "h-5 w-5 text-[10px]"
          : "min-h-[28px] gap-1 px-2 text-[10px] tracking-widest uppercase"
      } ${className}`}
    >
      {compact ? visibleLabel : <span className="text-stone-500">?</span>}
      {!compact && <span>{visibleLabel}</span>}
    </button>
  );
}

export function InstructionManual({ defaultTopicId = "basics" }: InstructionManualProps) {
  const [open, setOpen] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<ManualTopicId>(defaultTopicId);
  const topicIds = useMemo(() => MANUAL_TOPICS.map((topic) => topic.id), []);
  const activeTopic = getManualTopic(activeTopicId);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<ManualOpenDetail>).detail;
      const nextTopicId = isManualTopicId(detail?.topicId) ? detail.topicId : defaultTopicId;
      setActiveTopicId(nextTopicId);
      setOpen(true);
    }

    window.addEventListener(MANUAL_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(MANUAL_OPEN_EVENT, handleOpen);
  }, [defaultTopicId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-title"
        className="mx-auto grid max-h-full w-full max-w-4xl overflow-hidden border border-stone-700 bg-stone-950 text-stone-200 shadow-2xl sm:grid-cols-[180px_1fr]"
        data-testid="instruction-manual"
      >
        <header className="flex items-center justify-between border-b border-stone-800 px-4 py-3 sm:col-span-2">
          <div>
            <div className="text-[10px] tracking-widest text-stone-600 uppercase">
              when in doubt
            </div>
            <h2 id="manual-title" className="text-sm text-stone-100">
              manual
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-8 w-8 border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-100"
            aria-label="close manual"
          >
            x
          </button>
        </header>

        <nav
          aria-label="manual topics"
          className="flex gap-1 overflow-x-auto border-b border-stone-800 bg-stone-900/50 p-2 sm:block sm:overflow-y-auto sm:border-r sm:border-b-0"
        >
          {topicIds.map((topicId) => {
            const topic = getManualTopic(topicId);
            const selected = topicId === activeTopicId;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => setActiveTopicId(topic.id)}
                className={`min-h-[36px] shrink-0 border-l-2 px-3 py-2 text-left text-xs transition-colors sm:w-full ${
                  selected
                    ? "border-[var(--form-accent)] bg-stone-800/80 text-stone-100"
                    : "border-transparent text-stone-500 hover:bg-stone-900 hover:text-stone-200"
                }`}
                aria-current={selected ? "page" : undefined}
              >
                {topic.label}
              </button>
            );
          })}
        </nav>

        <article className="overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] tracking-widest text-stone-600 uppercase">
                {activeTopic.id}
              </div>
              <h3 className="mt-1 text-lg text-stone-100">{activeTopic.label}</h3>
            </div>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-stone-300">{activeTopic.summary}</p>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-stone-400">
            {activeTopic.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-3">
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 bg-[var(--form-accent)]"
                  aria-hidden="true"
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          {activeTopic.keepInMind && (
            <p className="mt-6 border-l-2 border-[var(--form-accent-border)] bg-stone-900/50 px-3 py-2 text-xs leading-5 text-stone-300">
              {activeTopic.keepInMind}
            </p>
          )}
        </article>
      </section>
    </div>
  );
}
