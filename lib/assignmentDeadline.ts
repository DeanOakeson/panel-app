export const DEADLINE_TIME_ZONE = "America/Denver";

/** Longest delay, in milliseconds, that setTimeout accepts. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Returns the last millisecond of a YYYY-MM-DD due date in Mountain Time, or
 * null when `dueDate` is not a string. Throws on a malformed or impossible date.
 */
export function getDeadline(dueDate: unknown): Date | null {
  if (typeof dueDate !== "string") {
    return null;
  }

  // Expect a date-only string: YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("Invalid assignment due date.");
  }

  const [year, month, day] = dueDate.split("-").map(Number);

  // Validate that the date actually exists.
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new Error("Invalid assignment due date.");
  }

  // Find the UTC offset for Mountain Time on the following
  // calendar day, then convert local midnight to UTC.
  const nextDay = new Date(
    Date.UTC(year, month - 1, day + 1)
  );

  const nextDateString = [
    nextDay.getUTCFullYear(),
    String(nextDay.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDay.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEADLINE_TIME_ZONE,
    timeZoneName: "longOffset",
    year: "numeric",
  }).formatToParts(
    new Date(`${nextDateString}T12:00:00Z`)
  );

  const offsetText =
    parts.find((part) => part.type === "timeZoneName")?.value;

  const offsetMatch = offsetText?.match(
    /^GMT([+-])(\d{2}):(\d{2})$/
  );

  if (!offsetMatch) {
    throw new Error("Could not determine assignment deadline timezone.");
  }

  const sign = offsetMatch[1] === "+" ? 1 : -1;
  const offsetMinutes =
    sign *
    (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));

  // Midnight at the start of the following local day, minus 1 ms
  return new Date(
    nextDay.getTime() -
      offsetMinutes * 60 * 1000 -
      1
  );
}

/**
 * Returns when submissions close for an assignment's due date as an ISO
 * instant, or null when the assignment has no due date. Throws like
 * getDeadline on a malformed date.
 */
export function getClosesAt(dueDate: unknown): string | null {
  if (!dueDate) {
    return null;
  }

  return getDeadline(dueDate)?.toISOString() ?? null;
}

/** Formats a closing instant in Mountain Time, like "Oct 30, 11:59 PM MT". */
export function formatClosesAt(closesAt: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: DEADLINE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(closesAt));

  return `${formatted} MT`;
}

/** Returns whether a closing instant from the server has passed. */
export function hasClosed(closesAt: string | null | undefined): boolean {
  return !!closesAt && Date.now() > Date.parse(closesAt);
}

/**
 * Calls `onPassed` once `instant` has passed, straight away if it already has.
 * An instant further away than setTimeout allows is reached in MAX_TIMEOUT
 * steps. Returns a function that cancels the call.
 */
export function whenPassed(instant: string, onPassed: () => void): () => void {
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
