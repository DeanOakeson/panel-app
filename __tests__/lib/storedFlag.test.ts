import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFlag, writeFlag } from "@/lib/storedFlag";

/** Stands in for the browser's localStorage, shared by every tab. */
class FakeStorage {
  values = new Map<string, string>();
  blocked = false;

  getItem(key: string) {
    if (this.blocked) throw new Error("blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.blocked) throw new Error("blocked");
    this.values.set(key, value);
  }
}

const KEY = "test-flag";
const fallsBackFalse = () => false;
let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.assign(globalThis, { window: { localStorage: storage, dispatchEvent: () => true } });
});

afterEach(() => {
  storage.blocked = false;
  delete (globalThis as { window?: unknown }).window;
});

describe("stored flags", () => {
  it("uses the fallback until someone chooses", () => {
    expect(readFlag(KEY, () => true)).toBe(true);
    writeFlag(KEY, false);
    expect(readFlag(KEY, () => true)).toBe(false);
  });

  it("sees another tab's later choice after this tab chose", () => {
    writeFlag(KEY, true);
    expect(readFlag(KEY, fallsBackFalse)).toBe(true);

    // Another tab writes the shared storage directly
    storage.values.set(KEY, "false");
    expect(readFlag(KEY, fallsBackFalse)).toBe(false);
  });

  it("keeps a choice in memory while storage refuses it", () => {
    storage.blocked = true;
    writeFlag(KEY, true);
    expect(readFlag(KEY, fallsBackFalse)).toBe(true);

    // Once storage takes a write again, it holds the choice
    storage.blocked = false;
    writeFlag(KEY, false);
    storage.values.set(KEY, "true");
    expect(readFlag(KEY, fallsBackFalse)).toBe(true);
  });
});
