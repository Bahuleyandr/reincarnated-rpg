"use client";

import { useState } from "react";

interface InputBoxProps {
  onSubmit(value: string): void;
  disabled?: boolean;
}

export function InputBox({ onSubmit, disabled }: InputBoxProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-stone-800 px-2 py-3 flex gap-2"
    >
      <span className="text-stone-600 self-center select-none">&gt;</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? "(session ended)" : "what do you do?"}
        className="flex-1 bg-transparent text-stone-100 placeholder:text-stone-700 focus:outline-none disabled:cursor-not-allowed"
        data-testid="input"
        autoFocus
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="text-stone-400 hover:text-stone-100 disabled:opacity-50 disabled:hover:text-stone-400"
      >
        send
      </button>
    </form>
  );
}
