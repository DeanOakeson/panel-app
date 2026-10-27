import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatClosesAt,
  getClosesAt,
  getDeadline,
  hasClosed,
  MAX_TIMEOUT,
  whenPassed,
} from "@/lib/assignmentDeadline";

describe("getDeadline", () => {
  it("returns the last millisecond of the due date in Mountain Time", () => {
    expect(getDeadline("2026-10-30")?.toISOString()).toBe("2026-10-31T05:59:59.999Z");
    expect(getDeadline("2026-12-15")?.toISOString()).toBe("2026-12-16T06:59:59.999Z");
  });

  it("ends the day daylight saving time starts at 11:59 PM MDT", () => {
    expect(getDeadline("2026-03-08")?.toISOString()).toBe("2026-03-09T05:59:59.999Z");
  });

  it("ends the day daylight saving time ends at 11:59 PM MST", () => {
    expect(getDeadline("2026-11-01")?.toISOString()).toBe("2026-11-02T06:59:59.999Z");
  });

  it.each(["10/30/2026", "2026-1-5", "2026-10-30T12:00:00Z", ""])(
    "throws for the malformed date %j",
    (dueDate) => {
      expect(() => getDeadline(dueDate)).toThrow("Invalid assignment due date.");
    }
  );

  it.each(["2026-02-30", "2026-13-01", "2026-04-31"])(
    "throws for the impossible date %s",
    (dueDate) => {
      expect(() => getDeadline(dueDate)).toThrow("Invalid assignment due date.");
    }
  );

  it.each([null, undefined, 20261030])("returns null for %j", (dueDate) => {
    expect(getDeadline(dueDate)).toBeNull();
  });
});

describe("getClosesAt", () => {
  it("returns the deadline as an ISO instant", () => {
    expect(getClosesAt("2026-10-30")).toBe("2026-10-31T05:59:59.999Z");
  });

  it.each([null, undefined, ""])("returns null for a due date of %j", (dueDate) => {
    expect(getClosesAt(dueDate)).toBeNull();
  });

  it("throws for a malformed date", () => {
    expect(() => getClosesAt("2026-02-30")).toThrow("Invalid assignment due date.");
  });
});

describe("formatClosesAt", () => {
  it("formats the closing instant in Mountain Time", () => {
    expect(formatClosesAt("2026-10-31T05:59:59.999Z")).toMatch(/^Oct 30, 11:59\sPM MT$/);
  });
});

describe("hasClosed", () => {
  it("returns true once the closing instant has passed", () => {
    expect(hasClosed("2020-01-02T06:59:59.999Z")).toBe(true);
  });

  it.each(["2099-01-02T06:59:59.999Z", null, undefined])("returns false for %j", (closesAt) => {
    expect(hasClosed(closesAt)).toBe(false);
  });
});

describe("whenPassed", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  function startAt(instant: string) {
    vi.useFakeTimers({ now });
    const onPassed = vi.fn();
    const cancel = whenPassed(instant, onPassed);

    return { onPassed, cancel };
  }

  it("calls straight away for an instant that has passed", () => {
    const { onPassed } = startAt("2026-10-30T11:59:59.999Z");

    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  it("calls once the instant passes, and not before", () => {
    const { onPassed } = startAt("2026-10-30T12:00:05.000Z");

    vi.advanceTimersByTime(5000);
    expect(onPassed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onPassed).toHaveBeenCalledTimes(1);
    expect(hasClosed("2026-10-30T12:00:05.000Z")).toBe(true);
  });

  it("reaches an instant further away than setTimeout allows", () => {
    const delay = MAX_TIMEOUT + 60 * 60 * 1000;
    const { onPassed } = startAt(new Date(now + delay).toISOString());

    vi.advanceTimersByTime(MAX_TIMEOUT);
    expect(onPassed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(delay - MAX_TIMEOUT + 1);
    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  it("does not call after it is cancelled", () => {
    const { onPassed, cancel } = startAt("2026-10-30T12:00:05.000Z");

    cancel();
    vi.advanceTimersByTime(10_000);

    expect(onPassed).not.toHaveBeenCalled();
  });
});
