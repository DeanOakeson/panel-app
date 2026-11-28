/**
 * Resubmission settings for an assignment (PANEL-113).
 *
 * - `allowResubmission`: false means a student gets one submission. Missing
 *   (every assignment made before PANEL-113) means resubmission is allowed.
 * - `maxAttempts`: the most submissions a student may make, counting the
 *   first, when resubmission is allowed. Missing or null means no limit.
 *
 * A student's attempts are counted on their submission document
 * (`attemptCount`), since `submissionHistory` keeps only the latest few files.
 */

export const MIN_MAX_ATTEMPTS = 2;
export const MAX_MAX_ATTEMPTS = 100;

export type ResubmissionSettings = {
  allowResubmission: boolean;
  maxAttempts: number | null;
};

type ParseResult =
  | { ok: true; settings: Partial<ResubmissionSettings> }
  | { ok: false; error: string };

/**
 * Validates the resubmission fields present in a request body. Only the
 * fields that are present come back, so a PATCH changes only what it sends.
 */
export function parseResubmissionSettings(body: Record<string, unknown>): ParseResult {
  const settings: Partial<ResubmissionSettings> = {};

  if ("allowResubmission" in body) {
    if (typeof body.allowResubmission !== "boolean") {
      return { ok: false, error: "Allow resubmission must be true or false." };
    }
    settings.allowResubmission = body.allowResubmission;
  }

  if ("maxAttempts" in body) {
    const value = body.maxAttempts;

    if (value === null || value === "") {
      settings.maxAttempts = null;
    } else if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= MIN_MAX_ATTEMPTS &&
      value <= MAX_MAX_ATTEMPTS
    ) {
      settings.maxAttempts = value;
    } else {
      return {
        ok: false,
        error: `Maximum attempts must be a whole number from ${MIN_MAX_ATTEMPTS} to ${MAX_MAX_ATTEMPTS}, or empty for no limit.`,
      };
    }
  }

  return { ok: true, settings };
}

/** Reads an assignment's settings, defaulting to today's behaviour: allowed, no limit. */
export function readResubmissionSettings(assignment: Record<string, unknown> | undefined): ResubmissionSettings {
  const maxAttempts = assignment?.maxAttempts;

  return {
    allowResubmission: assignment?.allowResubmission !== false,
    maxAttempts:
      typeof maxAttempts === "number" && Number.isInteger(maxAttempts) && maxAttempts >= 1
        ? maxAttempts
        : null,
  };
}

/** The most submissions a student may make, or null for no limit. */
export function getAttemptLimit(assignment: Record<string, unknown> | undefined): number | null {
  const { allowResubmission, maxAttempts } = readResubmissionSettings(assignment);
  if (!allowResubmission) return 1;
  return maxAttempts;
}

/**
 * How many times a student has submitted. Submissions saved before PANEL-113
 * have no `attemptCount`, so they count the files still on record (at least
 * one), which can only undercount.
 */
export function countAttempts(submission: Record<string, unknown> | undefined): number {
  if (!submission) return 0;

  const stored = submission.attemptCount;
  if (typeof stored === "number" && Number.isInteger(stored) && stored >= 0) {
    return stored;
  }

  const history = Array.isArray(submission.submissionHistory)
    ? submission.submissionHistory.filter(
        (entry) => typeof (entry as { filePath?: unknown })?.filePath === "string"
      ).length
    : 0;

  if (history > 0) return history;
  return typeof submission.filePath === "string" ? 1 : 0;
}

/**
 * The reason a student can't submit again, or null when they can. The
 * message is shown to the student as is.
 */
export function resubmissionBlockedReason(
  assignment: Record<string, unknown> | undefined,
  submission: Record<string, unknown> | undefined
): string | null {
  const attempts = countAttempts(submission);
  if (attempts === 0) return null;

  const { allowResubmission } = readResubmissionSettings(assignment);
  if (!allowResubmission) {
    return "Your professor doesn't allow resubmissions for this assignment, and you have already submitted it.";
  }

  const limit = getAttemptLimit(assignment);
  if (limit !== null && attempts >= limit) {
    return `You have used all ${limit} attempts for this assignment.`;
  }

  return null;
}
