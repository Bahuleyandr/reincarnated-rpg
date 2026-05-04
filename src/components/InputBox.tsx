"use client";

import { useState } from "react";

interface InputBoxProps {
  onSubmit(value: string): void;
  disabled?: boolean;
  /** Distinct from generic disabled: a previous turn is still
   *  settling (turn-lock 409). Shows a soft spinner + retry-aware
   *  copy so the user knows the system is auto-recovering, not
   *  permanently locked out. */
  settling?: boolean;
}

export function InputBox({ onSubmit, disabled, settling }: InputBoxProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled || settling) return;
    onSubmit(value.trim());
    setValue("");
  }

  const placeholder = settling
    ? "settling…"
    : disabled
      ? "(session ended)"
      : "what do you do?";

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-stone-800 px-2 py-3 flex gap-2 items-center"
    >
      <span className="text-stone-600 self-center select-none">
        {settling ? (
          <span
            className="inline-block animate-pulse text-amber-400"
            aria-label="turn settling"
          >
            ⌛
          </span>
        ) : (
          ">"
        )}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || settling}
        placeholder={placeholder}
        className={`flex-1 bg-transparent text-stone-100 focus:outline-none disabled:cursor-not-allowed ${
          settling
            ? "placeholder:text-amber-400/70 placeholder:italic"
            : "placeholder:text-stone-700"
        }`}
        data-testid="input"
        autoFocus
      />
      <button
        type="submit"
        disabled={disabled || settling || !value.trim()}
        className="text-stone-400 hover:text-stone-100 disabled:opacity-50 disabled:hover:text-stone-400"
      >
        {settling ? "wait" : "send"}
      </button>
    </form>
  );
}
