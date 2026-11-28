import { isLateSubmission } from "@/lib/assignmentDeadline";

/**
 * Lateness of submitted work and whether a late penalty applies (PANEL-115
 * and PANEL-116, part of PANEL-107).
 *
 * Penalty rule: a late penalty applies when the graded attempt's `isLate` is
 * true, unless the submission's `lateExcused` is set or the attempt answered
 * a newer `instructionsRevision` than the first submission.
 *
 * Fields read here:
 * - `lateExcused: { by, at, reason, submittedAt }` on the submission doc
 *   (PANEL-115). It covers the version it was given for and any earlier one,
 *   so a later late resubmission isn't excused without the professor's say.
 * - `instructionsRevision` on the assignment and on each attempt (PANEL-115).
 *   Assignments and attempts saved before PANEL-115 have none and count as
 *   revision 0, the instructions as first published.
 * - `firstSubmissionLate` on the submission doc (PANEL-112), once stored.
 *   Until then, the oldest attempt still in `submissionHistory` stands in.
 */

type StoredDoc = Record<string, unknown>;

/** A professor's decision to excuse a submission's lateness. */
export type LateExcused = {
  /** The uid of who excused it. */
  by: string;
  /** When it was excused, as an ISO instant. */
  at: string;
  reason: string;
  /** The submittedAt of the version that was excused. Missing: every version. */
  submittedAt: string | null;
};

/** Reads an instructions revision, counting a missing one as 0. */
export function readInstructionsRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** How late work stands for grading and display. */
export type Lateness = {
  /** Whether the attempt arrived after the due date. */
  late: boolean;
  /** Set when a professor excused the lateness. */
  excused: LateExcused | null;
  /** Whether the attempt answered newer instructions than the first submission did. */
  newerInstructions: boolean;
  /** Whether the first submission was on time, when it is known. Null when unknown. */
  firstOnTime: boolean | null;
  /** Whether a late penalty applies, by the penalty rule. */
  penalty: boolean;
};

/** Reads `lateExcused`, or null when it is not set or is malformed. */
export function readLateExcused(value: unknown): LateExcused | null {
  if (!value || typeof value !== "object") return null;

  const record = value as StoredDoc;
  if (typeof record.at !== "string" || record.at === "") return null;

  return {
    by: typeof record.by === "string" ? record.by : "",
    at: record.at,
    reason: typeof record.reason === "string" ? record.reason : "",
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : null,
  };
}

/**
 * Whether a stored attempt was late: its stored `isLate`, or, for attempts
 * saved without one, its submittedAt measured against the due date.
 */
export function attemptIsLate(attempt: StoredDoc | undefined, dueDate: unknown): boolean {
  if (!attempt) return false;
  if (typeof attempt.isLate === "boolean") return attempt.isLate;

  const submittedAt = attempt.submittedAt;
  if (typeof submittedAt !== "string") return false;

  try {
    return isLateSubmission(submittedAt, dueDate);
  } catch {
    return false;
  }
}

/** The attempts on a submission doc that still have a file, oldest first. */
function attemptsOnRecord(submission: StoredDoc): StoredDoc[] {
  const history = Array.isArray(submission.submissionHistory)
    ? (submission.submissionHistory as unknown[]).filter(
        (entry): entry is StoredDoc =>
          !!entry && typeof entry === "object" && typeof (entry as StoredDoc).filePath === "string"
      )
    : [];

  const attempts = history.length > 0 ? history : [submission];

  return [...attempts].sort((first, second) =>
    String(first.submittedAt ?? "").localeCompare(String(second.submittedAt ?? ""))
  );
}

/**
 * The first submission: its lateness and the instructions it answered.
 * A missing revision counts as 0, the instructions as first published.
 * `firstSubmissionLate` (PANEL-112) wins when stored; otherwise the oldest
 * attempt on record stands in, which is the first until older files rotate out.
 */
export function firstSubmission(
  submission: StoredDoc,
  dueDate: unknown
): { late: boolean; instructionsRevision: number; submittedAt: string | null } {
  const oldest = attemptsOnRecord(submission)[0];
  const revision = submission.firstInstructionsRevision ?? oldest?.instructionsRevision;
  const submittedAt = submission.firstSubmittedAt ?? oldest?.submittedAt;

  return {
    late:
      typeof submission.firstSubmissionLate === "boolean"
        ? submission.firstSubmissionLate
        : attemptIsLate(oldest, dueDate),
    instructionsRevision: readInstructionsRevision(revision),
    submittedAt: typeof submittedAt === "string" ? submittedAt : null,
  };
}

/**
 * Finds the attempt with a submittedAt on a submission doc: the current one or
 * one in its history. Undefined once that attempt has rotated out.
 */
export function findAttempt(submission: StoredDoc, submittedAt: unknown): StoredDoc | undefined {
  if (typeof submittedAt !== "string") return undefined;
  if (submission.submittedAt === submittedAt) return submission;

  return attemptsOnRecord(submission).find((attempt) => attempt.submittedAt === submittedAt);
}

/**
 * Works out an attempt's lateness and whether the penalty applies.
 * `knownLate` overrides the attempt's own flag, as a grade's copied `isLate`
 * does for an attempt that may since have rotated out of the history.
 */
export function describeLateness(
  submission: StoredDoc,
  attempt: StoredDoc | undefined,
  dueDate: unknown,
  knownLate?: boolean
): Lateness {
  const late = typeof knownLate === "boolean" ? knownLate : attemptIsLate(attempt, dueDate);
  const excuse = readLateExcused(submission.lateExcused);
  const attemptSubmittedAt = typeof attempt?.submittedAt === "string" ? attempt.submittedAt : null;
  // An excuse covers the version it was given for and earlier ones
  const excused =
    excuse &&
    (excuse.submittedAt === null ||
      attemptSubmittedAt === null ||
      attemptSubmittedAt <= excuse.submittedAt)
      ? excuse
      : null;
  const first = firstSubmission(submission, dueDate);
  const newerInstructions =
    !!attempt &&
    readInstructionsRevision(attempt.instructionsRevision) > first.instructionsRevision;

  // The attempt is the first one when nothing earlier is on record
  const isFirst = !attempt || first.submittedAt === null || attempt.submittedAt === first.submittedAt;

  return {
    late,
    excused: late ? excused : null,
    newerInstructions: late && newerInstructions,
    firstOnTime: isFirst ? null : !first.late,
    penalty: late && !excused && !newerInstructions,
  };
}

/**
 * The label for late work, or null for work on time:
 * "Late (excused)", "Late (updated instructions)",
 * "Late resubmission (original on time)" or "Late".
 */
export function latenessLabel(lateness: Lateness | null | undefined): string | null {
  if (!lateness?.late) return null;
  if (lateness.excused) return "Late (excused)";
  if (lateness.newerInstructions) return "Late (updated instructions)";
  if (lateness.firstOnTime) return "Late resubmission (original on time)";

  return "Late";
}

/** A short tag for a gradebook cell, where room is tight, or null for work on time. */
export function latenessTag(lateness: Lateness | null | undefined): string | null {
  if (!lateness?.late) return null;
  if (lateness.excused) return "Excused";
  if (lateness.newerInstructions) return "No penalty";
  if (lateness.firstOnTime) return "Late resubmit";

  return "Late";
}
