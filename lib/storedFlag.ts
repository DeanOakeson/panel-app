"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Choices that storage refused during this page load, which stand in until it reloads. */
const memory = new Map<string, boolean>();

const CHANGE_EVENT = "panel-stored-flag";

/**
 * Returns a flag from localStorage, or from memory when storage refused it,
 * or `fallback()` when neither holds it.
 */
export function readFlag(key: string, fallback: () => boolean): boolean {
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

/**
 * Stores a flag in localStorage, where other tabs see it change. Only when
 * storage refuses it does the flag live in memory instead.
 */
export function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
    memory.delete(key);
  } catch {
    // The choice then lasts only until the page reloads
    memory.set(key, value);
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
 * `fallback()`, read again on every render and resize. The server render and
 * hydration see `initial`, and the real value follows straight after. Blocked
 * storage leaves the preference working until the page reloads.
 */
export function useStoredFlag(
  key: string,
  fallback: () => boolean = alwaysFalse,
  initial = false
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(key, fallback),
    () => initial
  );
  const setValue = useCallback((next: boolean) => writeFlag(key, next), [key]);

  return [value, setValue];
}
