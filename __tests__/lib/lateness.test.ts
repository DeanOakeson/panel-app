// PANEL-116: lateness of submitted work and the late penalty rule.

import { describe, expect, it } from "vitest";
import {
  attemptIsLate,
  describeLateness,
  findAttempt,
  firstSubmission,
  latenessLabel,
  latenessTag,
  readLateExcused,
} from "@/lib/lateness";

const dueDate = "2026-11-10"; // closes Nov 10, 11:59 PM Mountain Time
const onTime = "2026-11-09T18:00:00.000Z";
const lateTime = "2026-11-12T18:00:00.000Z";
const later = "2026-11-13T18:00:00.000Z";

const attempt = (submittedAt: string, isLate: boolean, extra: Record<string, unknown> = {}) => ({
  filePath: `files/${submittedAt}.pdf`,
  submittedAt,
  isLate,
  ...extra,
});

/** A submission doc whose top level is the newest attempt, with its history. */
function submissionOf(...attempts: ReturnType<typeof attempt>[]) {
  return { ...attempts[attempts.length - 1], submissionHistory: attempts };
}

const excused = { by: "prof", at: "2026-11-14T16:00:00.000Z", reason: "Doctor's note", submittedAt: null };

describe("readLateExcused", () => {
  it("reads a set excuse and ignores anything malformed", () => {
    expect(readLateExcused(excused)).toEqual(excused);
    expect(readLateExcused({ at: excused.at })).toEqual({ by: "", at: excused.at, reason: "", submittedAt: null });
    expect(readLateExcused({ ...excused, submittedAt: lateTime })?.submittedAt).toBe(lateTime);
    expect(readLateExcused(undefined)).toBeNull();
    expect(readLateExcused(true)).toBeNull();
    expect(readLateExcused({ by: "prof" })).toBeNull();
  });
});

describe("attemptIsLate", () => {
  it("uses the stored flag, and measures attempts without one against the due date", () => {
    expect(attemptIsLate({ isLate: true, submittedAt: onTime }, dueDate)).toBe(true);
    expect(attemptIsLate({ submittedAt: lateTime }, dueDate)).toBe(true);
    expect(attemptIsLate({ submittedAt: onTime }, dueDate)).toBe(false);
    expect(attemptIsLate({ submittedAt: lateTime }, null)).toBe(false);
    expect(attemptIsLate(undefined, dueDate)).toBe(false);
  });
});

describe("firstSubmission", () => {
  it("uses the oldest attempt on record", () => {
    const submission = submissionOf(attempt(onTime, false), attempt(lateTime, true));
    expect(firstSubmission(submission, dueDate)).toMatchObject({ late: false, submittedAt: onTime });
  });

  it("prefers firstSubmissionLate and firstSubmittedAt from PANEL-112 once stored", () => {
    // The on-time first attempt rotated out of the history
    const submission = {
      ...submissionOf(attempt(lateTime, true), attempt(later, true)),
      firstSubmittedAt: onTime,
      firstSubmissionLate: false,
    };
    expect(firstSubmission(submission, dueDate)).toMatchObject({ late: false, submittedAt: onTime });
  });
});

describe("describeLateness", () => {
  it("is on time, with no penalty, for work before the due date", () => {
    const submission = submissionOf(attempt(onTime, false));
    const lateness = describeLateness(submission, submission, dueDate);

    expect(lateness).toEqual({
      late: false,
      excused: null,
      newerInstructions: false,
      firstOnTime: null,
      penalty: false,
    });
    expect(latenessLabel(lateness)).toBeNull();
    expect(latenessTag(lateness)).toBeNull();
  });

  it("is plain Late, with a penalty, when the first and only version was late", () => {
    const submission = submissionOf(attempt(lateTime, true));
    const lateness = describeLateness(submission, submission, dueDate);

    expect(lateness).toMatchObject({ late: true, penalty: true, firstOnTime: null });
    expect(latenessLabel(lateness)).toBe("Late");
    expect(latenessTag(lateness)).toBe("Late");
  });

  it("tells a late resubmission after an on-time first version apart from plain Late", () => {
    const submission = submissionOf(attempt(onTime, false), attempt(lateTime, true));
    const lateness = describeLateness(submission, submission, dueDate);

    // The penalty rule looks at the graded attempt, which was late
    expect(lateness).toMatchObject({ late: true, firstOnTime: true, penalty: true });
    expect(latenessLabel(lateness)).toBe("Late resubmission (original on time)");
    expect(latenessTag(lateness)).toBe("Late resubmit");
  });

  it("keeps plain Late when the first version was late too", () => {
    const submission = submissionOf(attempt(lateTime, true), attempt(later, true));
    const lateness = describeLateness(submission, submission, dueDate);

    expect(lateness).toMatchObject({ late: true, firstOnTime: false, penalty: true });
    expect(latenessLabel(lateness)).toBe("Late");
  });

  it("applies no penalty when the lateness is excused", () => {
    const submission = { ...submissionOf(attempt(lateTime, true)), lateExcused: excused };
    const lateness = describeLateness(submission, submission, dueDate);

    expect(lateness).toMatchObject({ late: true, excused, penalty: false });
    expect(latenessLabel(lateness)).toBe("Late (excused)");
    expect(latenessTag(lateness)).toBe("Excused");
  });

  it("applies no penalty to an attempt that answered newer instructions than the first", () => {
    const submission = submissionOf(
      attempt(lateTime, true, { instructionsRevision: 1 }),
      attempt(later, true, { instructionsRevision: 2 })
    );
    const lateness = describeLateness(submission, submission, dueDate);

    expect(lateness).toMatchObject({ late: true, newerInstructions: true, penalty: false });
    expect(latenessLabel(lateness)).toBe("Late (updated instructions)");
    expect(latenessTag(lateness)).toBe("No penalty");
  });

  it("keeps the penalty when the attempt answered the same instructions", () => {
    const submission = submissionOf(
      attempt(lateTime, true, { instructionsRevision: 2 }),
      attempt(later, true, { instructionsRevision: 2 })
    );
    expect(describeLateness(submission, submission, dueDate).penalty).toBe(true);
  });

  it("lets a grade's copied isLate stand for an attempt that rotated out", () => {
    const submission = submissionOf(attempt(onTime, false), attempt(lateTime, true));
    const gone = findAttempt(submission, "2026-11-01T00:00:00.000Z");

    expect(gone).toBeUndefined();
    expect(describeLateness(submission, gone, dueDate, true)).toMatchObject({ late: true, penalty: true });
    expect(describeLateness(submission, gone, dueDate, false)).toMatchObject({ late: false, penalty: false });
  });

  it("finds the graded attempt in the history", () => {
    const submission = submissionOf(attempt(onTime, false), attempt(lateTime, true));

    expect(findAttempt(submission, onTime)).toMatchObject({ submittedAt: onTime, isLate: false });
    expect(findAttempt(submission, lateTime)).toBe(submission);
    expect(describeLateness(submission, findAttempt(submission, onTime), dueDate)).toMatchObject({
      late: false,
      penalty: false,
    });
  });
});

// PANEL-115: excuses cover the version they were given for, and a missing
// instructions revision counts as 0, the instructions as first published.
describe("excused lateness and instruction revisions", () => {
  it("excuses the version it was given for and earlier ones, not a later late resubmission", () => {
    const first = attempt(lateTime, true);
    const second = attempt(later, true);
    const submission = {
      ...submissionOf(first, second),
      lateExcused: { ...excused, submittedAt: lateTime },
    };

    expect(describeLateness(submission, findAttempt(submission, lateTime), dueDate)).toMatchObject({
      excused: { submittedAt: lateTime },
      penalty: false,
    });
    expect(describeLateness(submission, submission, dueDate)).toMatchObject({ excused: null, penalty: true });
  });

  it("counts a missing revision as 0, so a version answering revision 1 has no penalty", () => {
    const submission = submissionOf(attempt(lateTime, true), attempt(later, true, { instructionsRevision: 1 }));

    expect(describeLateness(submission, submission, dueDate)).toMatchObject({
      newerInstructions: true,
      penalty: false,
    });
  });

  it("keeps the first submission's lateness on record when a later version has no penalty", () => {
    const submission = submissionOf(attempt(lateTime, true), attempt(later, true, { instructionsRevision: 1 }));

    expect(firstSubmission(submission, dueDate)).toMatchObject({ late: true, instructionsRevision: 0 });
    expect(describeLateness(submission, submission, dueDate).firstOnTime).toBe(false);
  });
});
