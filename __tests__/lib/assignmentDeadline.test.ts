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
  it.each([
    { label: "a summer date", dueDate: "2026-07-15", cutoff: "2026-07-16T05:59:59.999Z" },
    { label: "an autumn date in MDT", dueDate: "2026-10-30", cutoff: "2026-10-31T05:59:59.999Z" },
    { label: "a winter date", dueDate: "2026-12-15", cutoff: "2026-12-16T06:59:59.999Z" },
    { label: "the day before DST starts", dueDate: "2026-03-07", cutoff: "2026-03-08T06:59:59.999Z" },
    { label: "the day DST starts", dueDate: "2026-03-08", cutoff: "2026-03-09T05:59:59.999Z" },
    { label: "the day before DST ends", dueDate: "2026-10-31", cutoff: "2026-11-01T05:59:59.999Z" },
    { label: "the day DST ends", dueDate: "2026-11-01", cutoff: "2026-11-02T06:59:59.999Z" },
    { label: "the day before DST starts in 2027", dueDate: "2027-03-13", cutoff: "2027-03-14T06:59:59.999Z" },
    { label: "the day DST starts in 2027", dueDate: "2027-03-14", cutoff: "2027-03-15T05:59:59.999Z" },
    { label: "the day before DST ends in 2027", dueDate: "2027-11-06", cutoff: "2027-11-07T05:59:59.999Z" },
    { label: "the day DST ends in 2027", dueDate: "2027-11-07", cutoff: "2027-11-08T06:59:59.999Z" },
  ])("ends $label ($dueDate) at 11:59:59.999 PM Mountain Time", ({ dueDate, cutoff }) => {
    const deadline = getDeadline(dueDate);

    expect(deadline?.toISOString()).toBe(cutoff);
    expect(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hourCycle: "h23",
      }).format(deadline!)
    ).toBe(`${dueDate}, 23:59:59.999`);
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
