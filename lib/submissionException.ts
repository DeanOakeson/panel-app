import type {
  OwnSubmissionException,
  SubmissionExceptionSummary,
} from "@/app/components/Types";
import {
  formatClosesAt,
  getEffectiveClosesAt,
  isLateSubmission,
} from "@/lib/assignmentDeadline";

/** The longest reason an exception can store, in characters. */
export const MAX_EXCEPTION_REASON_LENGTH = 500;

export const LOCKED_MESSAGE =
  "The professor has closed submissions for this assignment.";

export const CLOSED_MESSAGE =
  "The due date has passed or the late submission deadline has passed. You can no longer submit this assignment.";

export const EXCEPTION_USED_MESSAGE =
  "Your extension does not allow replacing a submission you have already made.";

/** The class-wide state that decides whether submissions are open. */
export type ClassWindow = {
  isLocked: boolean;
  /** When the class's submissions close, as an ISO instant. Null when they never close. */
  closesAt: string | null;
};

/** The part of a student's exception that decides whether it opens the assignment. */
export type ExceptionWindow = {
  /** When the exception's window closes, as an ISO instant. Null when it can never open. */
  closesAt: string | null;
  allowResubmit: boolean;
};

/** Whether a student may submit, and why not when they may not. */
export type SubmissionCheck =
  | {
      allowed: true;
      /** True when only the student's exception lets them submit. */
      byException: boolean;
    }
  | { allowed: false; error: string };

/** Returns whether an ISO instant has passed at `now`. A malformed instant counts as passed. */
function hasPassed(instant: string, now: number): boolean {
  const time = Date.parse(instant);

  return !Number.isFinite(time) || now >= time;
}

/** Returns the message for a student whose exception window has ended. */
function exceptionEndedMessage(closesAt: string | null): string {
  return closesAt
    ? `Your extension ended ${formatClosesAt(closesAt)}. You can no longer submit this assignment.`
    : "Your extension has ended. You can no longer submit this assignment.";
}

/**
 * Returns whether a student may submit at `now`. The class rules allow a
 * submission unless the assignment is locked or its closing instant has
 * passed. When they refuse, an exception whose own window is open still
 * allows it, unless the student has submitted and the exception does not
 * allow resubmission.
 */
export function checkSubmission(
  assignment: ClassWindow,
  exception: ExceptionWindow | null,
  hasSubmission: boolean,
  now: number
): SubmissionCheck {
  const classRefusal = assignment.isLocked
    ? LOCKED_MESSAGE
    : assignment.closesAt && hasPassed(assignment.closesAt, now)
      ? CLOSED_MESSAGE
      : null;

  if (!classRefusal) {
    return { allowed: true, byException: false };
  }

  if (!exception) {
    return { allowed: false, error: classRefusal };
  }

  if (!exception.closesAt || hasPassed(exception.closesAt, now)) {
    return { allowed: false, error: exceptionEndedMessage(exception.closesAt) };
  }

  if (hasSubmission && !exception.allowResubmit) {
    return { allowed: false, error: EXCEPTION_USED_MESSAGE };
  }

  return { allowed: true, byException: true };
}

/**
 * Returns when an exception's window closes, as an ISO instant, or null when
 * its stored dates are malformed.
 */
export function exceptionClosesAt(
  dueDate: unknown,
  lateUntil: unknown
): string | null {
  try {
    return typeof dueDate === "string"
      ? getEffectiveClosesAt(dueDate, lateUntil)
      : null;
  } catch {
    return null;
  }
}

/** Returns the window of a stored exception, or null when there is none. */
export function readExceptionWindow(
  stored: Record<string, unknown> | null | undefined
): ExceptionWindow | null {
  if (!stored) return null;

  return {
    closesAt: exceptionClosesAt(stored.dueDate, stored.lateUntil),
    allowResubmit: stored.allowResubmit === true,
  };
}

/** Returns what a student sees of their own stored exception, or null when there is none. */
export function summarizeOwnException(
  stored: Record<string, unknown> | null | undefined
): OwnSubmissionException | null {
  if (!stored) return null;

  const lateUntil = typeof stored.lateUntil === "string" ? stored.lateUntil : null;

  return {
    dueDate: stored.dueDate as string,
    lateUntil,
    closesAt: exceptionClosesAt(stored.dueDate, lateUntil),
    allowResubmit: stored.allowResubmit === true,
  };
}

/** Returns what the professor's list shows of a stored exception, or null when there is none. */
export function summarizeException(
  stored: Record<string, unknown> | null | undefined
): SubmissionExceptionSummary | null {
  const own = summarizeOwnException(stored);
  if (!stored || !own) return null;

  return {
    ...own,
    reason: typeof stored.reason === "string" ? stored.reason : "",
    grantedBy: stored.grantedBy as string,
    grantedAt: stored.grantedAt as string,
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
  };
}

/** Returns isLateSubmission's answer, or false for a malformed due date. */
function lateAgainst(submittedAt: string | number | Date, dueDate: unknown): boolean {
  try {
    return isLateSubmission(submittedAt, dueDate);
  } catch {
    return false;
  }
}

/**
 * Returns whether a submission is late. Without an exception it is measured
 * against the class due date. With one it is measured against the later of
 * the class due date and the exception's, so it is late only when both call
 * it late. A class with no due date never calls a submission late.
 */
export function isLateForStudent(
  submittedAt: string | number | Date,
  classDueDate: unknown,
  exceptionDueDate?: unknown
): boolean {
  const classLate = lateAgainst(submittedAt, classDueDate);

  if (exceptionDueDate === undefined || exceptionDueDate === null) {
    return classLate;
  }

  return classLate && lateAgainst(submittedAt, exceptionDueDate);
}
