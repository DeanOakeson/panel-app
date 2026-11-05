import { describe, expect, it } from "vitest";
import {
  buildGradebook,
  describeCell,
  gradingHref,
  gridLayout,
  moveInGrid,
  rosterIds,
  standingFeedback,
  standingScore,
  type GradebookCell,
  type GradebookSource,
  type GridPosition,
  type StoredDoc,
  type StoredWork,
} from "@/lib/gradebook";
import { countGradingStatuses, getGradingStatus } from "@/lib/gradingStatus";

const firstVersion = "2026-10-30T12:00:00.000Z";
const secondVersion = "2026-10-31T12:00:00.000Z";
const gradedAt = "2026-11-01T09:00:00.000Z";
const NOW = Date.parse("2026-11-04T12:00:00.000Z");

/** Returns stored work on one assignment, built from plain objects keyed by uid. */
function work({
  submissions = {},
  grades = {},
  missingGrades = {},
}: {
  submissions?: Record<string, StoredDoc>;
  grades?: Record<string, StoredDoc>;
  missingGrades?: Record<string, StoredDoc>;
} = {}): StoredWork {
  return {
    submissions: new Map(Object.entries(submissions)),
    grades: new Map(Object.entries(grades)),
    missingGrades: new Map(Object.entries(missingGrades)),
  };
}

/** Returns a source with one class and the given assignments, work and students. */
function source(overrides: Partial<GradebookSource>): GradebookSource {
  return {
    class: {
      id: "class-1",
      name: "Software Engineering",
      courseCode: "CS 3450",
      term: "Fall",
      year: 2026,
      section: "001",
    },
    canGradeSubmissions: true,
    assignments: [],
    work: [],
    enrolledIds: [],
    profiles: new Map(),
    now: NOW,
    ...overrides,
  };
}

/** Returns a cell with the given status and parts. */
function cell(overrides: Partial<GradebookCell> & Pick<GradebookCell, "status">): GradebookCell {
  const base = {
    submittedAt: null,
    grade: null,
    missingGrade: null,
    ...overrides,
  };

  return { score: standingScore(base), ...base };
}

const grade = (score: number, feedback = "", submittedAt = firstVersion) => ({
  score,
  feedback,
  gradedAt,
  updatedAt: null,
  submittedAt,
});
const missingGrade = (feedback = "") => ({
  score: 0,
  feedback,
  gradedAt,
  updatedAt: null,
});

const closedAssignment = { points: 100, closed: true };
const openAssignment = { points: 100, closed: false };

describe("describeCell", () => {
  const cases: {
    name: string;
    cell: GradebookCell | null;
    assignment: { points: number; closed: boolean };
    expected: Record<string, unknown>;
    professorAction: string | null;
    adminAction: string | null;
  }[] = [
    {
      name: "a graded score with feedback",
      cell: cell({ status: "graded", submittedAt: firstVersion, grade: grade(90, "Nice") }),
      assignment: closedAssignment,
      expected: {
        primary: "90",
        reason: null,
        badge: null,
        missingTag: false,
        hasFeedback: true,
        srText: "90 out of 100, has feedback",
      },
      professorAction: "Edit grade",
      adminAction: "Open assignment",
    },
    {
      name: "a graded 0 with no tag",
      cell: cell({ status: "graded", submittedAt: firstVersion, grade: grade(0) }),
      assignment: closedAssignment,
      expected: {
        primary: "0",
        missingTag: false,
        hasFeedback: false,
        badge: null,
        srText: "0 out of 100",
      },
      professorAction: "Edit grade",
      adminAction: "Open assignment",
    },
    {
      name: "a submission to grade",
      cell: cell({ status: "needs-grading", submittedAt: firstVersion }),
      assignment: closedAssignment,
      expected: {
        primary: null,
        badge: { label: "Needs grading", tone: "needs-grading" },
        srText: "Needs grading",
      },
      professorAction: "Grade submission",
      adminAction: "Open assignment",
    },
    {
      name: "a resubmission as work to grade, with the earlier score",
      cell: cell({
        status: "resubmitted",
        submittedAt: secondVersion,
        grade: grade(82, "Good start"),
      }),
      assignment: closedAssignment,
      expected: {
        primary: null,
        badge: { label: "Needs grading", tone: "needs-grading" },
        reason: { label: "Resubmitted", earlier: "earlier 82/100" },
        hasFeedback: false,
        srText: "Needs grading, resubmitted, earlier score 82 out of 100 stands until then",
      },
      professorAction: "Grade new version",
      adminAction: "Open assignment",
    },
    {
      name: "a submission after a missing-work grade",
      cell: cell({
        status: "submitted-after-missing",
        submittedAt: secondVersion,
        missingGrade: missingGrade(),
      }),
      assignment: closedAssignment,
      expected: {
        primary: null,
        badge: { label: "Needs grading", tone: "needs-grading" },
        reason: { label: "After Missing", earlier: "earlier 0/100" },
        missingTag: false,
        srText: "Needs grading, turned in after a missing-work grade of 0 out of 100",
      },
      professorAction: "Grade submission",
      adminAction: "Open assignment",
    },
    {
      name: "missing work once submissions close",
      cell: cell({ status: "missing" }),
      assignment: closedAssignment,
      expected: {
        primary: null,
        badge: { label: "Missing", tone: "missing" },
        placeholder: null,
        srText: "Missing, no grade yet",
      },
      professorAction: "Mark missing",
      adminAction: "Mark missing",
    },
    {
      name: "work not submitted while submissions are open",
      cell: cell({ status: "missing" }),
      assignment: openAssignment,
      expected: {
        primary: null,
        badge: null,
        placeholder: "Not submitted",
        srText: "Not submitted",
      },
      professorAction: "Open assignment",
      adminAction: "Open assignment",
    },
    {
      name: "a missing-work grade with feedback",
      cell: cell({ status: "missing-graded", missingGrade: missingGrade("Nothing turned in") }),
      assignment: closedAssignment,
      expected: {
        primary: "0",
        reason: null,
        badge: null,
        missingTag: true,
        hasFeedback: true,
        srText: "0 out of 100, Missing, has feedback",
      },
      professorAction: "Edit feedback",
      adminAction: "Edit feedback",
    },
    {
      name: "a student not on the assignment's roster",
      cell: null,
      assignment: closedAssignment,
      expected: {
        primary: null,
        badge: null,
        placeholder: "–",
        srText: "Not in the class for this assignment",
      },
      professorAction: null,
      adminAction: null,
    },
  ];

  for (const testCase of cases) {
    it(`shows ${testCase.name} to the professor`, () => {
      const display = describeCell(testCase.cell, testCase.assignment, true);

      expect(display).toMatchObject(testCase.expected);
      expect(display.action?.label ?? null).toBe(testCase.professorAction);
    });

    it(`shows ${testCase.name} to an admin`, () => {
      const display = describeCell(testCase.cell, testCase.assignment, false);

      expect(display).toMatchObject(testCase.expected);
      expect(display.action?.label ?? null).toBe(testCase.adminAction);
    });
  }

  it("marks work waiting on the professor as urgent", () => {
    const urgent = (value: GradebookCell) =>
      describeCell(value, closedAssignment, true).action?.urgent;

    expect(urgent(cell({ status: "needs-grading", submittedAt: firstVersion }))).toBe(true);
    expect(urgent(cell({ status: "missing" }))).toBe(true);
    expect(urgent(cell({ status: "graded", submittedAt: firstVersion, grade: grade(5) }))).toBe(
      false
    );
  });

  it("ignores feedback that is only whitespace", () => {
    const display = describeCell(
      cell({ status: "graded", submittedAt: firstVersion, grade: grade(5, "  \n ") }),
      closedAssignment,
      true
    );

    expect(display.hasFeedback).toBe(false);
  });
});

describe("standingScore and standingFeedback", () => {
  it("prefers the grade over a missing-work grade", () => {
    const value = cell({
      status: "graded",
      submittedAt: firstVersion,
      grade: grade(70, "Late but solid"),
      missingGrade: missingGrade("Was missing"),
    });

    expect(standingScore(value)).toBe(70);
    expect(standingFeedback(value)).toBe("Late but solid");
  });

  it("falls back to the missing-work grade", () => {
    const value = cell({ status: "missing-graded", missingGrade: missingGrade("Nothing") });

    expect(standingScore(value)).toBe(0);
    expect(standingFeedback(value)).toBe("Nothing");
  });

  it("returns null without any grade", () => {
    expect(standingScore({ grade: null, missingGrade: null })).toBeNull();
  });
});

describe("gradingHref", () => {
  it("links to the assignment with the student and the way back", () => {
    expect(gradingHref("class-1", "a-1", "uid-1")).toBe(
      "/classes/class-1/assignments/a-1?student=uid-1&from=grades"
    );
  });
});

describe("rosterIds", () => {
  it("joins enrolled students with anyone who submitted or has a missing-work grade", () => {
    const ids = rosterIds(
      ["ava", "ben"],
      [
        work({ submissions: { ava: {}, dropped: {} } }),
        work({ missingGrades: { gone: {} } }),
      ]
    );

    expect(ids.sort()).toEqual(["ava", "ben", "dropped", "gone"]);
  });
});

describe("buildGradebook", () => {
  it("sorts assignments by due date, with no due date last and ties by creation", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [
          { id: "none", name: "Reading", points: 10, dueDate: null, createdAt: "2026-09-01" },
          { id: "late", name: "Project", points: 100, dueDate: "2026-12-01", createdAt: "2026-09-02" },
          { id: "tie-b", name: "Quiz B", points: 10, dueDate: "2026-10-01", createdAt: "2026-09-05" },
          { id: "tie-a", name: "Quiz A", points: 10, dueDate: "2026-10-01", createdAt: "2026-09-04" },
          { id: "bad", name: "Broken", points: 10, dueDate: "2026-13-45", createdAt: "2026-08-01" },
        ],
        work: [work(), work(), work(), work(), work()],
      })
    );

    expect(gradebook.assignments.map((assignment) => assignment.id)).toEqual([
      "tie-a",
      "tie-b",
      "late",
      "bad",
      "none",
    ]);
  });

  it("gives a malformed due date no closing time and leaves it open", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [{ id: "bad", name: "Broken", points: 10, dueDate: "soon" }],
        work: [work()],
      })
    );

    expect(gradebook.assignments[0]).toMatchObject({
      dueDate: "soon",
      closesAt: null,
      closed: false,
    });
  });

  it("marks an assignment closed once its due date has passed", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [
          { id: "past", name: "Past", points: 10, dueDate: "2026-11-01" },
          { id: "future", name: "Future", points: 10, dueDate: "2026-11-30" },
        ],
        work: [work(), work()],
      })
    );

    expect(gradebook.assignments.map((assignment) => assignment.closed)).toEqual([true, false]);
  });

  it("sorts enrolled students by name, then students who left, unknown names last", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [{ id: "a", name: "A", points: 10, dueDate: "2026-11-01" }],
        work: [
          work({
            submissions: {
              "left-named": { submittedAt: firstVersion },
              "left-unknown": { submittedAt: firstVersion },
            },
          }),
        ],
        enrolledIds: ["cara", "unknown", "ava", "email-only", "ben"],
        profiles: new Map<string, StoredDoc | undefined>([
          ["ava", { name: "Ava Martin", email: "ava@example.edu" }],
          ["ben", { name: "ben carter", email: "ben@example.edu" }],
          ["cara", { name: "Cara Diaz", email: "cara@example.edu" }],
          ["email-only", { email: "dev@example.edu" }],
          ["left-named", { name: "Zed Former", email: "zed@example.edu" }],
        ]),
      })
    );

    expect(gradebook.students.map((student) => student.id)).toEqual([
      "ava",
      "ben",
      "cara",
      "email-only",
      "unknown",
      "left-named",
      "left-unknown",
    ]);
    expect(gradebook.students.find((student) => student.id === "unknown")).toMatchObject({
      name: null,
      email: null,
      enrolled: true,
    });
    expect(gradebook.students.find((student) => student.id === "left-named")?.enrolled).toBe(
      false
    );
  });

  it("builds a cell for every status, aligned with the sorted assignments", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [
          { id: "second", name: "Second", points: 20, dueDate: "2026-11-02" },
          { id: "first", name: "First", points: 100, dueDate: "2026-11-01" },
        ],
        work: [
          work({ submissions: { ava: { submittedAt: firstVersion } } }),
          work({
            submissions: {
              ava: { submittedAt: firstVersion },
              ben: { submittedAt: secondVersion },
              dev: { submittedAt: secondVersion },
            },
            grades: {
              ava: { score: 0, feedback: "", submittedAt: firstVersion, gradedAt },
              ben: { score: 82, feedback: "Good", submittedAt: firstVersion, gradedAt },
            },
            missingGrades: {
              cara: { score: 0, feedback: "Nothing", gradedAt },
              dev: { score: 0, feedback: "", gradedAt },
            },
          }),
        ],
        enrolledIds: ["ava", "ben", "cara", "dev", "eve"],
      })
    );
    const statuses = Object.fromEntries(
      gradebook.students.map((student) => [
        student.id,
        student.cells.map((value) => value?.status),
      ])
    );

    expect(gradebook.assignments.map((assignment) => assignment.id)).toEqual(["first", "second"]);
    expect(statuses).toEqual({
      ava: ["graded", "needs-grading"],
      ben: ["resubmitted", "missing"],
      cara: ["missing-graded", "missing"],
      dev: ["submitted-after-missing", "missing"],
      eve: ["missing", "missing"],
    });

    const ava = gradebook.students.find((student) => student.id === "ava")!;
    const ben = gradebook.students.find((student) => student.id === "ben")!;
    const dev = gradebook.students.find((student) => student.id === "dev")!;

    expect(ava.cells[0]).toMatchObject({ score: 0, submittedAt: firstVersion });
    expect(ben.cells[0]).toMatchObject({
      score: 82,
      submittedAt: secondVersion,
      grade: { score: 82, feedback: "Good", submittedAt: firstVersion, updatedAt: null },
    });
    expect(dev.cells[0]).toMatchObject({
      score: 0,
      grade: null,
      missingGrade: { score: 0, feedback: "", gradedAt },
    });
  });

  it("gives a student who left no cell where they have no work", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [
          { id: "a", name: "A", points: 10, dueDate: "2026-11-01" },
          { id: "b", name: "B", points: 10, dueDate: "2026-11-02" },
          { id: "c", name: "C", points: 10, dueDate: "2026-11-03" },
        ],
        work: [
          work({ submissions: { gone: { submittedAt: firstVersion } } }),
          work(),
          work({ missingGrades: { gone: { score: 0, feedback: "", gradedAt } } }),
        ],
        enrolledIds: ["ava"],
      })
    );
    const gone = gradebook.students.find((student) => student.id === "gone")!;

    expect(gone.enrolled).toBe(false);
    expect(gone.cells.map((value) => value?.status ?? null)).toEqual([
      "needs-grading",
      null,
      "missing-graded",
    ]);
  });

  it("counts each assignment's grading states like countGradingStatuses", () => {
    const stored = work({
      submissions: {
        ava: { submittedAt: firstVersion },
        ben: { submittedAt: secondVersion },
        gone: { submittedAt: firstVersion },
        dev: { submittedAt: firstVersion },
      },
      grades: {
        ava: { score: 9, submittedAt: firstVersion, gradedAt },
        ben: { score: 8, submittedAt: firstVersion, gradedAt },
      },
      missingGrades: {
        dev: { score: 0, gradedAt },
        cara: { score: 0, gradedAt },
      },
    });
    const enrolledIds = ["ava", "ben", "cara", "dev", "eve"];
    const gradebook = buildGradebook(
      source({
        assignments: [
          { id: "a", name: "A", points: 10, dueDate: "2026-11-01" },
          { id: "empty", name: "Empty", points: 10, dueDate: "2026-11-02" },
        ],
        work: [stored, work()],
        enrolledIds,
      })
    );
    const expected = countGradingStatuses(
      ["ava", "ben", "cara", "dev", "eve", "gone"].map((studentId) =>
        getGradingStatus(
          stored.submissions.get(studentId),
          stored.grades.get(studentId),
          stored.missingGrades.has(studentId) ? {} : null
        )
      )
    );

    expect(gradebook.assignments[0].grading).toEqual(expected);
    expect(gradebook.assignments[1].grading).toEqual(
      countGradingStatuses(enrolledIds.map(() => "missing" as const))
    );
  });

  it("gives a student without a profile null name and email", () => {
    const gradebook = buildGradebook(
      source({
        assignments: [{ id: "a", name: "A", points: 10, dueDate: null }],
        work: [work()],
        enrolledIds: ["ghost"],
        profiles: new Map([["ghost", undefined]]),
      })
    );

    expect(gradebook.students).toEqual([
      {
        id: "ghost",
        name: null,
        email: null,
        enrolled: true,
        cells: [
          { status: "missing", score: null, submittedAt: null, grade: null, missingGrade: null },
        ],
      },
    ]);
  });

  it("handles a course with no students or assignments", () => {
    const gradebook = buildGradebook(source({}));

    expect(gradebook).toMatchObject({ assignments: [], students: [], canGradeSubmissions: true });
  });
});

describe("moveInGrid", () => {
  // Three students and three assignments. The middle student has no cell in the middle column.
  const size = { rows: 3, cols: 3 };
  const holes = new Set(["1:1"]);
  const isFocusable = ({ row, col }: GridPosition) =>
    col >= 0 && col < 3 && row >= -1 && row < 3 && !holes.has(`${row}:${col}`);
  const move = (from: GridPosition, key: Parameters<typeof moveInGrid>[1], toGridEnds = false) =>
    moveInGrid(from, key, { ...size, toGridEnds }, isFocusable);

  it("moves one cell with each arrow key", () => {
    expect(move({ row: 0, col: 0 }, "ArrowRight")).toEqual({ row: 0, col: 1 });
    expect(move({ row: 0, col: 1 }, "ArrowLeft")).toEqual({ row: 0, col: 0 });
    expect(move({ row: 0, col: 0 }, "ArrowDown")).toEqual({ row: 1, col: 0 });
    expect(move({ row: 2, col: 2 }, "ArrowUp")).toEqual({ row: 1, col: 2 });
  });

  it("skips a cell with nothing to focus", () => {
    expect(move({ row: 1, col: 0 }, "ArrowRight")).toEqual({ row: 1, col: 2 });
    expect(move({ row: 0, col: 1 }, "ArrowDown")).toEqual({ row: 2, col: 1 });
  });

  it("goes up from the first student into the column headers and back down", () => {
    expect(move({ row: 0, col: 2 }, "ArrowUp")).toEqual({ row: -1, col: 2 });
    expect(move({ row: -1, col: 2 }, "ArrowDown")).toEqual({ row: 0, col: 2 });
  });

  it("stays put at the grid's edges", () => {
    expect(move({ row: 0, col: 2 }, "ArrowRight")).toBeNull();
    expect(move({ row: 0, col: 0 }, "ArrowLeft")).toBeNull();
    expect(move({ row: 2, col: 0 }, "ArrowDown")).toBeNull();
    expect(move({ row: -1, col: 0 }, "ArrowUp")).toBeNull();
  });

  it("goes to the ends of the row with Home and End", () => {
    expect(move({ row: 1, col: 2 }, "Home")).toEqual({ row: 1, col: 0 });
    expect(move({ row: 0, col: 0 }, "End")).toEqual({ row: 0, col: 2 });
  });

  it("goes to the first and last student cells with Ctrl+Home and Ctrl+End", () => {
    expect(move({ row: 1, col: 2 }, "Home", true)).toEqual({ row: 0, col: 0 });
    expect(move({ row: -1, col: 0 }, "End", true)).toEqual({ row: 2, col: 2 });
  });

  it("finds nothing in a grid without students", () => {
    expect(moveInGrid({ row: 0, col: 0 }, "Home", { rows: 0, cols: 3, toGridEnds: true }, isFocusable)).toBeNull();
  });
});

describe("gridLayout", () => {
  it("keeps 120-pixel columns while every assignment fits", () => {
    expect(gridLayout(727, 6)).toEqual({ columnWidth: 120, overflows: false });
  });

  it("widens overflowing columns so a whole number of them fills the room", () => {
    const layout = gridLayout(470, 6);

    expect(layout.overflows).toBe(true);
    expect(layout.columnWidth).toBeGreaterThanOrEqual(120);
    expect(470 / layout.columnWidth).toBe(3);
  });

  it("shows at least one whole column in a very narrow room", () => {
    expect(gridLayout(100, 2)).toEqual({ columnWidth: 120, overflows: true });
  });

  it("uses the narrow columns before the room is measured", () => {
    expect(gridLayout(null, 6)).toEqual({ columnWidth: 120, overflows: false });
  });
});
