"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fillPrompt } from "@/lib/ideas";
import { HOME_AIRPORT_KEY, readStored } from "@/lib/storage";

type SearchState = {
  text: string;
  setText: (text: string) => void;
  /** Fills the box with an idea's sentence and focuses it, selecting the origin blank. Never submits. */
  fillFromIdea: (prompt: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const SearchContext = createContext<SearchState | null>(null);

/** Shares the search box's text so the idea cards can fill it. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  const fillFromIdea = useCallback((prompt: string) => {
    const filled = fillPrompt(prompt, readStored(HOME_AIRPORT_KEY));
    pendingSelection.current = filled.select ?? [filled.text.length, filled.text.length];
    setText(filled.text);
  }, []);

  // After a card fills the box: focus it and put the cursor on the blank to replace.
  useEffect(() => {
    const el = textareaRef.current;
    const selection = pendingSelection.current;
    if (!el || !selection) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(selection[0], selection[1]);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [text]);

  return <SearchContext.Provider value={{ text, setText, fillFromIdea, textareaRef }}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used inside <SearchProvider>.");
  return ctx;
}
