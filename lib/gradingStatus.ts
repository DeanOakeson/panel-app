import type { MissingGradeSummary } from "@/app/components/Types";

/** Where a student's work on an assignment stands for the professor. */
export type GradingStatus =
  | "needs-grading"
  | "resubmitted"
  | "submitted-after-missing"
  | "graded"
  | "missing"
  | "missing-graded";

/** The status of a student who has not submitted, with or without a missing-work grade. */
export type MissingStatus = Extract<GradingStatus, "missing" | "missing-graded">;

/** The status of a student who has submitted. */
export type SubmittedStatus = Exclude<GradingStatus, MissingStatus>;

/** How many students on an assignment are in each grading state. */
export type GradingCounts = {
  /** Enrolled students plus anyone else who submitted or has a grade. */
  students: number;
  submitted: number;
  /** Submissions without a grade for their current file, resubmitted ones included. */
  toGrade: number;
  resubmitted: number;
  /** Ungraded submissions that arrived after a missing-work grade. Part of toGrade. */
  afterMissingGrade: number;
  graded: number;
  /** Students without a submission, missing-work grades included. */
  missing: number;
  /** Students without a submission who have a missing-work grade. Part of missing. */
  missingGraded: number;
};

/** The submittedAt a submission or grade stores. */
type Versioned = { submittedAt?: unknown };

/**
 * Returns whether a grade is a missing-work grade: a grade given to a student
 * without a submission, which stores a null submittedAt until the professor
 * grades a later submission over it.
 */
export function isMissingWorkGrade(grade: Versioned): boolean {
  return grade.submittedAt == null;
}

/**
 * Returns what the roster and the student see of a stored grade while it is a
 * missing-work grade, or null for a grade that belongs to a submission.
 */
export function summarizeMissingGrade(
  stored: (Versioned & Record<string, unknown>) | null | undefined
): MissingGradeSummary | null {
  if (!stored || !isMissingWorkGrade(stored)) return null;

  return {
    score: stored.score as number,
    feedback: (stored.feedback as string | undefined) ?? "",
    gradedAt: stored.gradedAt as string,
    updatedAt: (stored.updatedAt as string | undefined) ?? null,
  };
}

/**
 * Returns a student's grading status from their submission and their grade,
 * each null when absent. A grade covers the version whose submittedAt it
 * stores, and a missing-work grade covers none.
 */
export function getGradingStatus(
  submission: Versioned,
  grade: Versioned | null | undefined
): SubmittedStatus;
export function getGradingStatus(
  submission: Versioned | null | undefined,
  grade: Versioned | null | undefined
): GradingStatus;
export function getGradingStatus(
  submission: Versioned | null | undefined,
  grade: Versioned | null | undefined
): GradingStatus {
  if (!submission) {
    return grade ? "missing-graded" : "missing";
  }

  if (!grade) {
    return "needs-grading";
  }

  if (isMissingWorkGrade(grade)) {
    return "submitted-after-missing";
  }

  return grade.submittedAt === submission.submittedAt ? "graded" : "resubmitted";
}

/** Returns whether a status belongs to a student without a submission. */
export function isMissingStatus(status: GradingStatus): status is MissingStatus {
  return status === "missing" || status === "missing-graded";
}

/** Returns whether a roster row belongs to a student without a submission. */
export function isMissingRow<Row extends { gradingStatus: GradingStatus }>(
  row: Row
): row is Extract<Row, { gradingStatus: MissingStatus }> {
  return isMissingStatus(row.gradingStatus);
}

/** Returns whether a status still needs the professor to grade something. */
export function needsGrade(status: GradingStatus): boolean {
  return (
    status === "needs-grading" ||
    status === "resubmitted" ||
    status === "submitted-after-missing"
  );
}

/**
 * Returns where a status sorts on the professor's list: work to grade first,
 * then graded work, then missing work, then missing work that has a grade.
 */
export function gradingStatusRank(status: GradingStatus): number {
  if (needsGrade(status)) return 0;

  switch (status) {
    case "missing":
      return 2;
    case "missing-graded":
      return 3;
    default:
      return 1;
  }
}

/**
 * Returns the label a professor sees for a status. A student without a
 * submission is "Not submitted" while submissions are open and "Missing" once
 * they have closed.
 */
export function gradingStatusLabel(status: GradingStatus, closed: boolean): string {
  switch (status) {
    case "needs-grading":
      return "Needs grading";
    case "resubmitted":
      return "Resubmitted";
    case "submitted-after-missing":
      return "Submitted after missing grade";
    case "graded":
      return "Graded";
    case "missing":
      return closed ? "Missing" : "Not submitted";
    case "missing-graded":
      return "Missing work graded";
  }
}

/**
 * Returns what the work to grade includes, like
 * "1 resubmitted, 1 after a missing-work grade", or "" when it is all new.
 */
export function describeToGradeDetail(counts: GradingCounts): string {
  const details: string[] = [];

  if (counts.resubmitted > 0) {
    details.push(`${counts.resubmitted} resubmitted`);
  }

  if (counts.afterMissingGrade > 0) {
    details.push(`${counts.afterMissingGrade} after a missing-work grade`);
  }

  return details.join(", ");
}

/** Tallies one status per student into counts. */
export function countGradingStatuses(statuses: Iterable<GradingStatus>): GradingCounts {
  const counts: GradingCounts = {
    students: 0,
    submitted: 0,
    toGrade: 0,
    resubmitted: 0,
    afterMissingGrade: 0,
    graded: 0,
    missing: 0,
    missingGraded: 0,
  };

  for (const status of statuses) {
    counts.students += 1;

    if (isMissingStatus(status)) {
      counts.missing += 1;

      if (status === "missing-graded") {
        counts.missingGraded += 1;
      }

      continue;
    }

    counts.submitted += 1;

    if (status === "graded") {
      counts.graded += 1;
    } else {
      counts.toGrade += 1;
    }

    if (status === "resubmitted") {
      counts.resubmitted += 1;
    }

    if (status === "submitted-after-missing") {
      counts.afterMissingGrade += 1;
    }
  }

  return counts;
}
