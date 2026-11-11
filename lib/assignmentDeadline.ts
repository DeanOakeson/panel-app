
export const DEADLINE_TIME_ZONE = "America/Denver";

/** Longest delay, in milliseconds, that setTimeout accepts. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Returns the last millisecond of a YYYY-MM-DD date in Mountain Time, or
 * null when `date` is not a string. Throws on a malformed or impossible date.
 */
export function getDeadline(date: unknown): Date | null {
  if (typeof date !== "string") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid assignment due date.");
  }

  const [year, month, day] = date.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new Error("Invalid assignment due date.");
  }

  const nextMidnightAsUtc = Date.UTC(year, month - 1, day + 1);

  const guess =
    nextMidnightAsUtc -
    getOffsetMinutes(new Date(nextMidnightAsUtc)) * 60 * 1000;

  const nextMidnight =
    nextMidnightAsUtc -
    getOffsetMinutes(new Date(guess)) * 60 * 1000;

  return new Date(nextMidnight - 1);
}

/** Returns Mountain Time's offset from UTC in minutes at `instant`. */
function getOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEADLINE_TIME_ZONE,
    timeZoneName: "longOffset",
    year: "numeric",
  }).formatToParts(instant);

  const offsetText =
    parts.find((part) => part.type === "timeZoneName")?.value;

  const offsetMatch = offsetText?.match(/^GMT([+-])(\d{2}):(\d{2})$/);

  if (!offsetMatch) {
    throw new Error("Could not determine assignment deadline timezone.");
  }

  const sign = offsetMatch[1] === "+" ? 1 : -1;

  return sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
}

/** Returns a date's closing instant as an ISO string, or null. */
export function getClosesAt(date: unknown): string | null {
  if (!date) {
    return null;
  }

  return getDeadline(date)?.toISOString() ?? null;
}

/**
 * Returns the effective closing instant.
 * Uses lateUntil when provided; otherwise uses dueDate.
 *
 * A lateUntil date requires a dueDate and must be later than it.
 */
export function getEffectiveClosesAt(
  dueDate: unknown,
  lateUntil: unknown
): string | null {
  if (lateUntil !== null && lateUntil !== undefined && lateUntil !== "") {
    if (typeof dueDate !== "string" || !dueDate) {
      throw new Error("A due date is required when setting Late until.");
    }

    // Validate both dates before comparing them.
    getDeadline(dueDate);
    getDeadline(lateUntil);

    if (typeof lateUntil !== "string" || lateUntil <= dueDate) {
      throw new Error("Late until date must be later than the due date.");
    }

    return getClosesAt(lateUntil);
  }

  return getClosesAt(dueDate);
}

/**
 * Returns whether a submission was received after the original due-date
 * cutoff. The optional lateUntil date does not affect this calculation.
 */
export function isLateSubmission(
  submittedAt: string | number | Date,
  dueDate: unknown
): boolean {
  const deadline = getDeadline(dueDate);

  if (!deadline) {
    return false;
  }

  const submittedTime =
    submittedAt instanceof Date
      ? submittedAt.getTime()
      : typeof submittedAt === "number"
        ? submittedAt
        : Date.parse(submittedAt);

  if (!Number.isFinite(submittedTime)) {
    return false;
  }

  return submittedTime > deadline.getTime();
}

/** Returns a closing instant, or null if the date is invalid. */
export function closesAtOrNull(date: unknown): string | null {
  try {
    return getClosesAt(date);
  } catch {
    return null;
  }
}

/** Formats a closing instant in Mountain Time. */
export function formatClosesAt(closesAt: string): string {
  return formatTimestamp(closesAt);
}

/** Formats an ISO instant in Mountain Time to the minute. */
export function formatTimestamp(instant: string): string {
  const date = new Date(instant);

  if (Number.isNaN(date.getTime())) {
    return instant;
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: DEADLINE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${formatted} MT`;
}

/** Returns whether a closing instant from the server has passed. */
export function hasClosed(closesAt: string | null | undefined): boolean {
  if (!closesAt) {
    return false;
  }

  const deadline = Date.parse(closesAt);

  return !Number.isFinite(deadline) || Date.now() >= deadline;
}

/**
 * Calls `onPassed` once `instant` has passed.
 * Returns a function that cancels the call.
 */
export function whenPassed(
  instant: string,
  onPassed: () => void
): () => void {
  const time = Date.parse(instant);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function check() {
    const delay = time - Date.now();

    if (delay < 0) {
      onPassed();
      return;
    }

    timer = setTimeout(check, Math.min(delay + 1, MAX_TIMEOUT));
  }

  check();

  return () => clearTimeout(timer);
}
