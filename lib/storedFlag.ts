"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Values set during this page load, which stand in when storage cannot be written. */
const memory = new Map<string, boolean>();

const CHANGE_EVENT = "panel-stored-flag";

/** Returns a flag from memory or localStorage, or `fallback()` when neither holds it. */
function readFlag(key: string, fallback: () => boolean): boolean {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;

  let stored: string | null = null;

  try {
    stored = window.localStorage.getItem(key);
  } catch {
    // Blocked storage reads as no stored choice
  }

  return stored === null ? fallback() : stored === "true";
}

/** The default for a flag nobody has set. */
const alwaysFalse = () => false;

/** Stores a flag in memory and, when the browser allows it, in localStorage. */
function writeFlag(key: string, value: boolean) {
  memory.set(key, value);

  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The choice then lasts only until the page reloads
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Calls `onChange` when any stored flag changes, in this tab or another, and
 * when the window resizes, which can change a default that follows its width.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("resize", onChange);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * Returns a true-or-false preference remembered in localStorage under `key`,
 * and a function that changes it. Until someone sets it, the preference is
 * `fallback()`, which a module-level function keeps stable. The server render
 * and hydration see false, and the real value follows straight after. Blocked
 * storage leaves the preference working until the page reloads.
 */
export function useStoredFlag(
  key: string,
  fallback: () => boolean = alwaysFalse
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(key, fallback),
    () => false
  );
  const setValue = useCallback((next: boolean) => writeFlag(key, next), [key]);

  return [value, setValue];
}
