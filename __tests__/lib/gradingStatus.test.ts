import { describe, expect, it } from "vitest";
import {
  countGradingStatuses,
  describeToGradeDetail,
  getGradingStatus,
  gradingStatusLabel,
  gradingStatusRank,
  isMissingRow,
  isMissingStatus,
  isMissingWorkGrade,
  needsGrade,
  summarizeMissingGrade,
} from "@/lib/gradingStatus";

const version = { submittedAt: "2026-10-30T12:00:00.000Z" };
const laterVersion = { submittedAt: "2026-10-31T12:00:00.000Z" };
const missingGrade = {
  score: 0,
  feedback: "Nothing received.",
  submittedAt: null,
  gradedAt: "2026-10-29T12:00:00.000Z",
};

const noCounts = {
  students: 0,
  submitted: 0,
  toGrade: 0,
  resubmitted: 0,
  afterMissingGrade: 0,
  graded: 0,
  missing: 0,
  missingGraded: 0,
};

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

  it("returns missing-graded without a submission but with a grade", () => {
    expect(getGradingStatus(null, missingGrade)).toBe("missing-graded");
  });

  it("returns submitted-after-missing for a submission whose grade is still a missing-work grade", () => {
    expect(getGradingStatus(version, missingGrade)).toBe("submitted-after-missing");
  });

  it("returns graded once the later submission is graded over the missing-work grade", () => {
    expect(getGradingStatus(version, { ...missingGrade, ...version })).toBe("graded");
  });
});

describe("isMissingWorkGrade", () => {
  it("is true for a grade with no submittedAt", () => {
    expect(isMissingWorkGrade(missingGrade)).toBe(true);
    expect(isMissingWorkGrade({})).toBe(true);
  });

  it("is false for a grade that belongs to a submission", () => {
    expect(isMissingWorkGrade(version)).toBe(false);
  });
});

describe("summarizeMissingGrade", () => {
  it("summarizes a missing-work grade", () => {
    expect(summarizeMissingGrade(missingGrade)).toEqual({
      score: 0,
      feedback: "Nothing received.",
      gradedAt: missingGrade.gradedAt,
      updatedAt: null,
    });
  });

  it("returns null for no grade or a grade that belongs to a submission", () => {
    expect(summarizeMissingGrade(undefined)).toBeNull();
    expect(summarizeMissingGrade({ ...missingGrade, ...version })).toBeNull();
  });
});

describe("isMissingStatus and isMissingRow", () => {
  it.each([
    ["missing", true],
    ["missing-graded", true],
    ["needs-grading", false],
    ["resubmitted", false],
    ["submitted-after-missing", false],
    ["graded", false],
  ] as const)("returns whether %s has no submission", (status, missing) => {
    expect(isMissingStatus(status)).toBe(missing);
    expect(isMissingRow({ gradingStatus: status })).toBe(missing);
  });
});

describe("needsGrade", () => {
  it.each([
    ["needs-grading", true],
    ["resubmitted", true],
    ["submitted-after-missing", true],
    ["graded", false],
    ["missing", false],
    ["missing-graded", false],
  ] as const)("returns whether %s needs grading", (status, toGrade) => {
    expect(needsGrade(status)).toBe(toGrade);
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
    ["submitted-after-missing", "Submitted after missing grade"],
    ["graded", "Graded"],
    ["missing-graded", "Missing work graded"],
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

  it("puts a submission after a missing-work grade with work to grade", () => {
    expect(gradingStatusRank("submitted-after-missing")).toBe(
      gradingStatusRank("needs-grading")
    );
  });

  it("puts missing work with a grade after missing work without one", () => {
    expect(gradingStatusRank("missing")).toBeLessThan(gradingStatusRank("missing-graded"));
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
      ...noCounts,
      students: 5,
      submitted: 4,
      toGrade: 2,
      resubmitted: 1,
      graded: 2,
      missing: 1,
    });
  });

  it("counts missing-work grades as missing and later submissions as work to grade", () => {
    expect(
      countGradingStatuses([
        "missing",
        "missing-graded",
        "missing-graded",
        "submitted-after-missing",
        "graded",
      ])
    ).toEqual({
      students: 5,
      submitted: 2,
      toGrade: 1,
      resubmitted: 0,
      afterMissingGrade: 1,
      graded: 1,
      missing: 3,
      missingGraded: 2,
    });
  });

  it("returns zeros for no students", () => {
    expect(countGradingStatuses([])).toEqual(noCounts);
  });
});

describe("describeToGradeDetail", () => {
  it("returns an empty string when all the work to grade is new", () => {
    expect(describeToGradeDetail({ ...noCounts, toGrade: 2 })).toBe("");
  });

  it("lists resubmissions and submissions after a missing-work grade", () => {
    expect(
      describeToGradeDetail({ ...noCounts, toGrade: 3, resubmitted: 1, afterMissingGrade: 2 })
    ).toBe("1 resubmitted, 2 after a missing-work grade");
  });
});
