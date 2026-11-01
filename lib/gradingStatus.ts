/** Where a student's work on an assignment stands for the professor. */
export type GradingStatus = "needs-grading" | "resubmitted" | "graded" | "missing";

/** The status of a student who has submitted. */
export type SubmittedStatus = Exclude<GradingStatus, "missing">;

/** How many students on an assignment are in each grading state. */
export type GradingCounts = {
  /** Enrolled students plus anyone else who submitted. */
  students: number;
  submitted: number;
  /** Submissions without a grade for their current file, resubmitted ones included. */
  toGrade: number;
  resubmitted: number;
  graded: number;
  missing: number;
};

/** The submittedAt a submission or grade stores. */
type Versioned = { submittedAt?: unknown };

/**
 * Returns a student's grading status from their submission and their grade,
 * each null when absent. A grade covers the version whose submittedAt it stores.
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
    return "missing";
  }

  if (!grade) {
    return "needs-grading";
  }

  return grade.submittedAt === submission.submittedAt ? "graded" : "resubmitted";
}

/** Returns whether a status still needs the professor to grade something. */
export function needsGrade(status: GradingStatus): boolean {
  return status === "needs-grading" || status === "resubmitted";
}

/**
 * Returns where a status sorts on the professor's list: work to grade first,
 * then graded work, then missing work.
 */
export function gradingStatusRank(status: GradingStatus): number {
  if (needsGrade(status)) return 0;

  return status === "graded" ? 1 : 2;
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
    case "graded":
      return "Graded";
    case "missing":
      return closed ? "Missing" : "Not submitted";
  }
}

/** Tallies one status per student into counts. */
export function countGradingStatuses(statuses: Iterable<GradingStatus>): GradingCounts {
  const counts: GradingCounts = {
    students: 0,
    submitted: 0,
    toGrade: 0,
    resubmitted: 0,
    graded: 0,
    missing: 0,
  };

  for (const status of statuses) {
    counts.students += 1;

    if (status === "missing") {
      counts.missing += 1;
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
  }

  return counts;
}
