import { describe, expect, it } from "vitest";
import {
  countGradingStatuses,
  getGradingStatus,
  gradingStatusLabel,
  gradingStatusRank,
} from "@/lib/gradingStatus";

const version = { submittedAt: "2026-10-30T12:00:00.000Z" };
const laterVersion = { submittedAt: "2026-10-31T12:00:00.000Z" };

describe("getGradingStatus", () => {
  it("returns missing without a submission", () => {
    expect(getGradingStatus(null, null)).toBe("missing");
  });

  it("returns needs-grading for a submission without a grade", () => {
    expect(getGradingStatus(version, undefined)).toBe("needs-grading");
  });

  it("returns graded when the grade covers the submitted version", () => {
    expect(getGradingStatus(version, { ...version })).toBe("graded");
  });

  it("returns resubmitted when the grade covers an earlier version", () => {
    expect(getGradingStatus(laterVersion, version)).toBe("resubmitted");
  });
});

describe("gradingStatusLabel", () => {
  it("labels a student without a submission Not submitted while submissions are open", () => {
    expect(gradingStatusLabel("missing", false)).toBe("Not submitted");
  });

  it("labels a student without a submission Missing once submissions close", () => {
    expect(gradingStatusLabel("missing", true)).toBe("Missing");
  });

  it.each([
    ["needs-grading", "Needs grading"],
    ["resubmitted", "Resubmitted"],
    ["graded", "Graded"],
  ] as const)("labels %s the same whether open or closed", (status, label) => {
    expect(gradingStatusLabel(status, false)).toBe(label);
    expect(gradingStatusLabel(status, true)).toBe(label);
  });
});

describe("gradingStatusRank", () => {
  it("puts work to grade first, then graded, then missing", () => {
    expect(gradingStatusRank("needs-grading")).toBe(gradingStatusRank("resubmitted"));
    expect(gradingStatusRank("resubmitted")).toBeLessThan(gradingStatusRank("graded"));
    expect(gradingStatusRank("graded")).toBeLessThan(gradingStatusRank("missing"));
  });
});

describe("countGradingStatuses", () => {
  it("counts resubmitted work as work to grade", () => {
    expect(
      countGradingStatuses([
        "needs-grading",
        "resubmitted",
        "graded",
        "graded",
        "missing",
      ])
    ).toEqual({
      students: 5,
      submitted: 4,
      toGrade: 2,
      resubmitted: 1,
      graded: 2,
      missing: 1,
    });
  });

  it("returns zeros for no students", () => {
    expect(countGradingStatuses([])).toEqual({
      students: 0,
      submitted: 0,
      toGrade: 0,
      resubmitted: 0,
      graded: 0,
      missing: 0,
    });
  });
});
