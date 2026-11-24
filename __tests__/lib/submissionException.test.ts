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

  it("refuses at the exact closing instant of the exception", () => {
    const closesAt = "2026-11-15T12:00:00.000Z";

    expect(checkSubmission(pastDue, { closesAt, allowResubmit: true }, false, now).allowed).toBe(false);
    expect(checkSubmission(pastDue, { closesAt, allowResubmit: true }, false, now - 1).allowed).toBe(true);
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
  const submittedAt = "2026-11-12T12:00:00.000Z";

  it("measures a student without an exception against the class due date", () => {
    expect(isLateForStudent(submittedAt, "2026-11-10")).toBe(true);
    expect(isLateForStudent(submittedAt, "2026-11-14")).toBe(false);
    expect(isLateForStudent(submittedAt, "2026-11-10", null)).toBe(true);
  });

  it("is on time under the exception though late for the class", () => {
    expect(isLateForStudent(submittedAt, "2026-11-10", "2026-11-14")).toBe(false);
  });

  it("is late under the exception during its late window", () => {
    expect(isLateForStudent(submittedAt, "2026-11-10", "2026-11-11")).toBe(true);
  });

  it("is on time when the class due date is later than the exception's", () => {
    expect(isLateForStudent(submittedAt, "2026-11-14", "2026-11-11")).toBe(false);
  });

  it("is never late for a class with no due date or a malformed one", () => {
    expect(isLateForStudent(submittedAt, null, "2026-11-11")).toBe(false);
    expect(isLateForStudent(submittedAt, "soon", "2026-11-11")).toBe(false);
    expect(isLateForStudent(submittedAt, "soon")).toBe(false);
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
