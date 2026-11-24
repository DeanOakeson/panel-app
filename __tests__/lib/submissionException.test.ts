import { describe, expect, it } from "vitest";
import { getClosesAt } from "@/lib/assignmentDeadline";
import {
  CLOSED_MESSAGE,
  checkSubmission,
  EXCEPTION_USED_MESSAGE,
  exceptionClosesAt,
  isLateForStudent,
  LOCKED_MESSAGE,
  readExceptionWindow,
  summarizeException,
  summarizeOwnException,
} from "@/lib/submissionException";

const now = Date.parse("2026-11-15T12:00:00.000Z");
const past = getClosesAt("2026-11-10")!;
const future = getClosesAt("2026-11-20")!;

const open = { isLocked: false, closesAt: future };
const pastDue = { isLocked: false, closesAt: past };
const locked = { isLocked: true, closesAt: future };

describe("checkSubmission", () => {
  it("allows a submission the class rules allow, with or without an exception", () => {
    expect(checkSubmission(open, null, false, now)).toEqual({ allowed: true, byException: false });
    expect(checkSubmission({ isLocked: false, closesAt: null }, null, true, now)).toEqual({
      allowed: true,
      byException: false,
    });
    expect(
      checkSubmission(open, { closesAt: past, allowResubmit: false }, true, now)
    ).toEqual({ allowed: true, byException: false });
  });

  it("refuses with the class message when the student has no exception", () => {
    expect(checkSubmission(locked, null, false, now)).toEqual({
      allowed: false,
      error: LOCKED_MESSAGE,
    });
    expect(checkSubmission(pastDue, null, false, now)).toEqual({
      allowed: false,
      error: CLOSED_MESSAGE,
    });
  });

  it.each([
    { label: "a locked assignment", assignment: locked },
    { label: "an assignment past its deadline", assignment: pastDue },
    { label: "a locked assignment past its deadline", assignment: { isLocked: true, closesAt: past } },
  ])("lets an open exception reopen $label", ({ assignment }) => {
    expect(
      checkSubmission(assignment, { closesAt: future, allowResubmit: false }, false, now)
    ).toEqual({ allowed: true, byException: true });
  });

  it("refuses once the exception's window has ended, naming when it ended", () => {
    const check = checkSubmission(pastDue, { closesAt: past, allowResubmit: true }, false, now);

    expect(check).toEqual({
      allowed: false,
      error: "Your extension ended Nov 10, 11:59 PM MT. You can no longer submit this assignment.",
    });
  });

  it("accepts at the exception's closing instant and refuses a millisecond later", () => {
    const closesAt = "2026-11-15T12:00:00.000Z";

    expect(checkSubmission(pastDue, { closesAt, allowResubmit: true }, false, now).allowed).toBe(true);
    expect(checkSubmission(pastDue, { closesAt, allowResubmit: true }, false, now + 1).allowed).toBe(false);
  });

  it("accepts at the class's closing instant and refuses a millisecond later", () => {
    const closesAt = "2026-11-15T12:00:00.000Z";
    const assignment = { isLocked: false, closesAt };

    expect(checkSubmission(assignment, null, false, now)).toEqual({ allowed: true, byException: false });
    expect(checkSubmission(assignment, null, false, now + 1)).toEqual({ allowed: false, error: CLOSED_MESSAGE });
  });

  it("refuses an exception with malformed dates", () => {
    expect(checkSubmission(pastDue, { closesAt: null, allowResubmit: true }, false, now)).toEqual({
      allowed: false,
      error: "Your extension has ended. You can no longer submit this assignment.",
    });
  });

  it("lets an exception without resubmission open the assignment only before a first submission", () => {
    const exception = { closesAt: future, allowResubmit: false };

    expect(checkSubmission(pastDue, exception, false, now)).toEqual({ allowed: true, byException: true });
    expect(checkSubmission(pastDue, exception, true, now)).toEqual({
      allowed: false,
      error: EXCEPTION_USED_MESSAGE,
    });
  });

  it("lets an exception with resubmission replace a submission", () => {
    expect(
      checkSubmission(locked, { closesAt: future, allowResubmit: true }, true, now)
    ).toEqual({ allowed: true, byException: true });
  });
});

describe("isLateForStudent", () => {
  const submittedAt = "2026-11-23T12:00:00.000Z";

  it("measures a student without an exception against the class due date", () => {
    expect(isLateForStudent(submittedAt, "2026-11-20")).toBe(true);
    expect(isLateForStudent(submittedAt, "2026-11-25")).toBe(false);
    expect(isLateForStudent(submittedAt, "2026-11-20", null, true)).toBe(true);
    expect(isLateForStudent(submittedAt, "soon")).toBe(false);
  });

  describe("a submission only the exception let in", () => {
    it("is on time before the exception's due date, though late for the class", () => {
      expect(isLateForStudent(submittedAt, "2026-11-20", "2026-11-25", true)).toBe(false);
    });

    it("is late during the exception's late window", () => {
      expect(isLateForStudent(submittedAt, "2026-11-20", "2026-11-22", true)).toBe(true);
    });

    it("is late after the exception's due date on a class with no due date", () => {
      expect(isLateForStudent(submittedAt, null, "2026-11-22", true)).toBe(true);
    });

    it("is late after the exception's due date though the class due date is later", () => {
      expect(isLateForStudent(submittedAt, "2026-11-30", "2026-11-22", true)).toBe(true);
    });
  });

  describe("a submission the class rules allowed, by a student with an exception", () => {
    it("is on time when the class due date has not passed, though the exception's has", () => {
      expect(isLateForStudent(submittedAt, "2026-11-30", "2026-11-22")).toBe(false);
    });

    it("is on time in the class late window before the exception's due date", () => {
      expect(isLateForStudent(submittedAt, "2026-11-20", "2026-11-25")).toBe(false);
    });

    it("is late when late against both due dates", () => {
      expect(isLateForStudent(submittedAt, "2026-11-20", "2026-11-22")).toBe(true);
    });

    it("is on time for a class with no due date or a malformed one", () => {
      expect(isLateForStudent(submittedAt, null, "2026-11-22")).toBe(false);
      expect(isLateForStudent(submittedAt, "soon", "2026-11-22")).toBe(false);
    });
  });
});

describe("an exception's deadline at its boundary instants", () => {
  // Locked, so only the exception decides whether a submission is accepted
  const lockedClass = { isLocked: true, closesAt: null };

  describe.each([
    {
      label: "across the March change to daylight time",
      dueDate: "2026-03-07",
      lastOnTime: "2026-03-08T06:59:59.999Z",
      firstLate: "2026-03-08T07:00:00.000Z",
      lateUntil: "2026-03-08",
      lastAccepted: "2026-03-09T05:59:59.999Z",
      firstRefused: "2026-03-09T06:00:00.000Z",
    },
    {
      label: "across the November change to standard time",
      dueDate: "2026-10-31",
      lastOnTime: "2026-11-01T05:59:59.999Z",
      firstLate: "2026-11-01T06:00:00.000Z",
      lateUntil: "2026-11-01",
      lastAccepted: "2026-11-02T06:59:59.999Z",
      firstRefused: "2026-11-02T07:00:00.000Z",
    },
  ])("$label", ({ dueDate, lastOnTime, firstLate, lateUntil, lastAccepted, firstRefused }) => {
    it(`is on time at 11:59:59.999 PM MT on the due date (${dueDate}) and late at midnight`, () => {
      expect(isLateForStudent(lastOnTime, null, dueDate, true)).toBe(false);
      expect(isLateForStudent(firstLate, null, dueDate, true)).toBe(true);
    });

    it(`accepts at 11:59:59.999 PM MT on the late-until date (${lateUntil}) and refuses at midnight`, () => {
      const exception = readExceptionWindow({ dueDate, lateUntil });

      expect(checkSubmission(lockedClass, exception, false, Date.parse(lastAccepted))).toEqual({
        allowed: true,
        byException: true,
      });
      expect(checkSubmission(lockedClass, exception, false, Date.parse(firstRefused)).allowed).toBe(
        false
      );
    });
  });
});

describe("exception summaries", () => {
  const stored = {
    studentId: "ada",
    classId: "class-1",
    assignmentId: "assignment-1",
    dueDate: "2026-11-20",
    lateUntil: "2026-11-22",
    allowResubmit: true,
    reason: "Hospital stay",
    grantedBy: "prof",
    grantedAt: "2026-11-15T10:00:00.000Z",
  };

  it("gives the student their dates and closing instant, without the reason or who granted it", () => {
    expect(summarizeOwnException(stored)).toEqual({
      dueDate: "2026-11-20",
      lateUntil: "2026-11-22",
      closesAt: getClosesAt("2026-11-22"),
      allowResubmit: true,
    });
  });

  it("gives the professor the reason, who granted it and when it was last replaced", () => {
    expect(summarizeException({ ...stored, updatedAt: "2026-11-16T10:00:00.000Z" })).toEqual({
      dueDate: "2026-11-20",
      lateUntil: "2026-11-22",
      closesAt: getClosesAt("2026-11-22"),
      allowResubmit: true,
      reason: "Hospital stay",
      grantedBy: "prof",
      grantedAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-16T10:00:00.000Z",
    });
  });

  it("returns null without a stored exception", () => {
    expect(summarizeOwnException(undefined)).toBeNull();
    expect(summarizeException(null)).toBeNull();
    expect(readExceptionWindow(undefined)).toBeNull();
  });

  it("closes at the due date without a late window, and never for malformed dates", () => {
    expect(exceptionClosesAt("2026-11-20", null)).toBe(getClosesAt("2026-11-20"));
    expect(exceptionClosesAt("2026-11-20", "2026-11-19")).toBeNull();
    expect(exceptionClosesAt("someday", null)).toBeNull();
    expect(readExceptionWindow({ dueDate: "2026-11-20" })).toEqual({
      closesAt: getClosesAt("2026-11-20"),
      allowResubmit: false,
    });
  });
});
