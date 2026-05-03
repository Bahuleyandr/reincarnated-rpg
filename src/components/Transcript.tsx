"use client";

import { useEffect, useRef } from "react";

interface TranscriptProps {
  entries: Array<{ kind: "narration" | "input"; text: string }>;
}

export function Transcript({ entries }: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto px-2 py-4 space-y-4 text-stone-200"
      data-testid="transcript"
    >
      {entries.length === 0 ? (
        <p className="text-stone-600 italic">awaiting first impression&hellip;</p>
      ) : (
        entries.map((e, i) => (
          <div
            key={i}
            className={
              e.kind === "narration"
                ? "leading-7 text-stone-100"
                : "leading-7 text-stone-500 italic before:content-['>_']"
            }
          >
            {e.text}
          </div>
        ))
      )}
    </div>
  );
}
