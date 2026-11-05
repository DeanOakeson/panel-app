import type { MissingGradeSummary } from "@/app/components/Types";
import { closesAtOrNull } from "@/lib/assignmentDeadline";
import {
  countGradingStatuses,
  getGradingStatus,
  type GradingCounts,
  type GradingStatus,
} from "@/lib/gradingStatus";

// #region Types

/** The course a gradebook belongs to. */
export type GradebookClass = {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
  year: number | null;
  section: string | null;
};

/** One column of the gradebook. */
export type GradebookAssignment = {
  id: string;
  name: string;
  points: number;
  dueDate: string | null;
  /** When submissions close, as an ISO instant. Null without a valid due date. */
  closesAt: string | null;
  /** Whether submissions had closed when the gradebook was built. */
  closed: boolean;
  grading: GradingCounts;
};

/** A saved grade for a submission. */
export type GradebookGrade = {
  score: number;
  feedback: string;
  gradedAt: string;
  /** Null until the grade is edited. */
  updatedAt: string | null;
  /** The submittedAt of the version that was graded. */
  submittedAt: string;
};

/** One student's work on one assignment. */
export type GradebookCell = {
  status: GradingStatus;
  /** The score that stands for the student, or null when none is saved. */
  score: number | null;
  /** When the current submission arrived. Null without a submission. */
  submittedAt: string | null;
  /** The grade saved for a submission, which may cover an earlier version. */
  grade: GradebookGrade | null;
  missingGrade: MissingGradeSummary | null;
};

/** One row of the gradebook. */
export type GradebookStudent = {
  id: string;
  /** Null when the student has no profile. */
  name: string | null;
  /** Null when the student has no profile. */
  email: string | null;
  enrolled: boolean;
  /**
   * One cell per assignment, in the gradebook's assignment order. Null where
   * a student who left the class has no work on that assignment.
   */
  cells: (GradebookCell | null)[];
};

/** Every student's work on every assignment in a course. */
export type Gradebook = {
  class: GradebookClass;
  /** Whether the viewer can grade submissions, which only the class's professor can. */
  canGradeSubmissions: boolean;
  /** Sorted by due date, with assignments without one last. */
  assignments: GradebookAssignment[];
  /** Enrolled students by name, then students who left, with unknown names last in each. */
  students: GradebookStudent[];
};

/** A stored document's fields. */
export type StoredDoc = Record<string, unknown>;

/** An assignment document as stored, with its ID. */
export type StoredAssignment = StoredDoc & { id: string };

/** The submissions, grades and missing-work grades stored on one assignment, by student uid. */
export type StoredWork = {
  submissions: Map<string, StoredDoc>;
  grades: Map<string, StoredDoc>;
  missingGrades: Map<string, StoredDoc>;
};

/** Everything buildGradebook reads. */
export type GradebookSource = {
  class: GradebookClass;
  canGradeSubmissions: boolean;
  assignments: StoredAssignment[];
  /** The work on each assignment, in the same order as `assignments`. */
  work: StoredWork[];
  enrolledIds: string[];
  /** Each student's profile by uid. A missing entry means no profile. */
  profiles: Map<string, StoredDoc | undefined>;
  /** The time `closed` is judged at, in milliseconds. Defaults to now. */
  now?: number;
};

// #endregion

// #region Building

/** Returns a string field, or null when it is absent or not a string. */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Returns every student on any assignment's roster: the enrolled students,
 * and anyone who submitted or has a missing-work grade.
 */
export function rosterIds(enrolledIds: string[], work: StoredWork[]): string[] {
  const ids = new Set(enrolledIds);

  for (const assignmentWork of work) {
    for (const studentId of assignmentWork.submissions.keys()) ids.add(studentId);
    for (const studentId of assignmentWork.missingGrades.keys()) ids.add(studentId);
  }

  return [...ids];
}

/** Returns the score that stands for a cell: its grade, else its missing-work grade. */
export function standingScore(
  cell: Pick<GradebookCell, "grade" | "missingGrade">
): number | null {
  if (cell.grade) return cell.grade.score;
  if (cell.missingGrade) return cell.missingGrade.score;

  return null;
}

/** Returns a stored missing-work grade as the roster sees it. */
function summarizeMissingGrade(stored: StoredDoc | undefined): MissingGradeSummary | null {
  if (!stored) return null;

  return {
    score: stored.score as number,
    feedback: text(stored.feedback) ?? "",
    gradedAt: text(stored.gradedAt) ?? "",
    updatedAt: text(stored.updatedAt),
  };
}

/**
 * Returns one student's cell for an assignment, or null when they are not on
 * its roster: not enrolled, with no submission and no missing-work grade.
 */
function buildCell(studentId: string, enrolled: boolean, work: StoredWork): GradebookCell | null {
  const submission = work.submissions.get(studentId);
  const storedGrade = submission ? work.grades.get(studentId) : undefined;
  const missingGrade = summarizeMissingGrade(work.missingGrades.get(studentId));

  if (!enrolled && !submission && !missingGrade) return null;

  const grade: GradebookGrade | null = storedGrade
    ? {
        score: storedGrade.score as number,
        feedback: text(storedGrade.feedback) ?? "",
        gradedAt: text(storedGrade.gradedAt) ?? "",
        updatedAt: text(storedGrade.updatedAt),
        submittedAt: text(storedGrade.submittedAt) ?? "",
      }
    : null;
  const cell = {
    status: getGradingStatus(submission, storedGrade, missingGrade),
    submittedAt: text(submission?.submittedAt),
    grade,
    missingGrade,
  };

  return { ...cell, score: standingScore(cell) };
}

/** Returns the name a professor knows a student by, or null for an unknown student. */
export function studentLabel(student: Pick<GradebookStudent, "name" | "email">): string | null {
  return student.name ?? student.email;
}

/** Orders named students alphabetically ahead of unknown ones, then by uid. */
function compareStudents(first: GradebookStudent, second: GradebookStudent): number {
  if (first.enrolled !== second.enrolled) return first.enrolled ? -1 : 1;

  const firstName = studentLabel(first);
  const secondName = studentLabel(second);

  if (firstName !== null && secondName !== null) {
    const byName = firstName.localeCompare(secondName, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
  } else if (firstName !== null) {
    return -1;
  } else if (secondName !== null) {
    return 1;
  }

  return first.id.localeCompare(second.id);
}

/** Orders assignments by closing time, those without one last, then by creation and name. */
function compareAssignments(
  first: { assignment: GradebookAssignment; createdAt: string },
  second: { assignment: GradebookAssignment; createdAt: string }
): number {
  const firstCloses = first.assignment.closesAt;
  const secondCloses = second.assignment.closesAt;

  if (firstCloses !== secondCloses) {
    if (firstCloses === null) return 1;
    if (secondCloses === null) return -1;

    return Date.parse(firstCloses) - Date.parse(secondCloses);
  }

  return (
    first.createdAt.localeCompare(second.createdAt) ||
    first.assignment.name.localeCompare(second.assignment.name) ||
    first.assignment.id.localeCompare(second.assignment.id)
  );
}

/**
 * Builds the gradebook from stored documents: sorts the assignments and
 * students, and works out every cell and each assignment's grading counts.
 */
export function buildGradebook(source: GradebookSource): Gradebook {
  const now = source.now ?? Date.now();
  const enrolled = new Set(source.enrolledIds);
  const ids = rosterIds(source.enrolledIds, source.work);

  const columns = source.assignments
    .map((stored, index) => {
      const closesAt = closesAtOrNull(stored.dueDate);
      const work = source.work[index];
      const cells = new Map(
        ids.map((studentId) => [studentId, buildCell(studentId, enrolled.has(studentId), work)])
      );
      const statuses: GradingStatus[] = [];

      for (const cell of cells.values()) {
        if (cell) statuses.push(cell.status);
      }

      const assignment: GradebookAssignment = {
        id: stored.id,
        name: text(stored.name) ?? "Untitled assignment",
        points: typeof stored.points === "number" ? stored.points : 0,
        dueDate: text(stored.dueDate),
        closesAt,
        closed: closesAt !== null && now > Date.parse(closesAt),
        grading: countGradingStatuses(statuses),
      };

      return { assignment, createdAt: text(stored.createdAt) ?? "", cells };
    })
    .sort(compareAssignments);

  const students = ids
    .map((studentId): GradebookStudent => {
      const profile = source.profiles.get(studentId);

      return {
        id: studentId,
        name: text(profile?.name),
        email: text(profile?.email),
        enrolled: enrolled.has(studentId),
        cells: columns.map((column) => column.cells.get(studentId) ?? null),
      };
    })
    .sort(compareStudents);

  return {
    class: source.class,
    canGradeSubmissions: source.canGradeSubmissions,
    assignments: columns.map((column) => column.assignment),
    students,
  };
}

// #endregion

// #region Display

/** A status label shown in a cell, colored like the status badges. */
export type CellBadge = {
  label: string;
  /** The status whose colors the badge takes. */
  tone: GradingStatus;
};

/** The button in the details panel that leads into grading. */
export type CellAction = {
  label: string;
  /** Whether the action is work waiting to be done, which gets the primary style. */
  urgent: boolean;
};

/** How one gradebook cell looks and what its details panel offers. */
export type CellDisplay = {
  /** The score shown in the cell, or null when the cell shows no score. */
  primary: string | null;
  badge: CellBadge | null;
  /**
   * Why work waits to be graded when it is more than a new submission, with
   * the score that stands until then, like "Resubmitted" and "earlier 82/100".
   */
  reason: { label: string; earlier: string } | null;
  /** Whether a Missing tag marks the score as a missing-work grade. */
  missingTag: boolean;
  /** Whether the cell's score has feedback, marked beside the score. */
  hasFeedback: boolean;
  /** Muted text shown when the cell has no score and no badge, like "Not submitted". */
  placeholder: string | null;
  /** The cell's content as a screen reader should hear it. */
  srText: string;
  action: CellAction | null;
};

/** Returns the feedback on the grade that stands for a cell, or "". */
export function standingFeedback(cell: GradebookCell): string {
  return (cell.grade ? cell.grade.feedback : cell.missingGrade?.feedback ?? "").trim();
}

/**
 * Returns how a cell looks and which grading action its details panel offers.
 * `canGradeSubmissions` is false for an admin, who can grade missing work but
 * not submissions.
 */
export function describeCell(
  cell: GradebookCell | null,
  assignment: Pick<GradebookAssignment, "points" | "closed">,
  canGradeSubmissions: boolean
): CellDisplay {
  const empty: CellDisplay = {
    primary: null,
    badge: null,
    reason: null,
    missingTag: false,
    hasFeedback: false,
    placeholder: null,
    srText: "",
    action: null,
  };

  if (!cell) {
    return { ...empty, placeholder: "–", srText: "Not in the class for this assignment" };
  }

  const score = cell.score === null ? null : String(cell.score);
  const outOf = `${score} out of ${assignment.points}`;
  const hasFeedback = standingFeedback(cell) !== "";
  const feedbackText = hasFeedback ? ", has feedback" : "";
  const openAssignment: CellAction = { label: "Open assignment", urgent: false };
  const needsGrading: CellBadge = { label: "Needs grading", tone: "needs-grading" };
  const earlier = `earlier ${score}/${assignment.points}`;

  /** Returns the submission action for the professor, or Open assignment for an admin. */
  const gradeAction = (label: string, urgent: boolean): CellAction =>
    canGradeSubmissions ? { label, urgent } : openAssignment;

  switch (cell.status) {
    case "graded":
      return {
        ...empty,
        primary: score,
        hasFeedback,
        srText: `${outOf}${feedbackText}`,
        action: gradeAction("Edit grade", false),
      };

    case "needs-grading":
      return {
        ...empty,
        badge: needsGrading,
        srText: "Needs grading",
        action: gradeAction("Grade submission", true),
      };

    case "resubmitted":
      return {
        ...empty,
        badge: needsGrading,
        reason: { label: "Resubmitted", earlier },
        srText: `Needs grading, resubmitted, earlier score ${outOf} stands until then`,
        action: gradeAction("Grade new version", true),
      };

    case "submitted-after-missing":
      return {
        ...empty,
        badge: needsGrading,
        reason: { label: "After Missing", earlier },
        srText: `Needs grading, turned in after a missing-work grade of ${outOf}`,
        action: gradeAction("Grade submission", true),
      };

    case "missing":
      return assignment.closed
        ? {
            ...empty,
            badge: { label: "Missing", tone: "missing" },
            srText: "Missing, no grade yet",
            action: { label: "Mark missing", urgent: true },
          }
        : {
            ...empty,
            placeholder: "Not submitted",
            srText: "Not submitted",
            action: openAssignment,
          };

    case "missing-graded":
      return {
        ...empty,
        primary: score,
        missingTag: true,
        hasFeedback,
        srText: `${outOf}, Missing${feedbackText}`,
        action: { label: "Edit feedback", urgent: false },
      };
  }
}

/** Returns the link from a cell into the assignment page, focused on the student's card. */
export function gradingHref(classId: string, assignmentId: string, studentId: string): string {
  const query = new URLSearchParams({ student: studentId, from: "grades" });

  return `/classes/${classId}/assignments/${assignmentId}?${query}`;
}

// #endregion

// #region Keyboard

/** A place in the grid: a row of students, or -1 for the header row, and a column of assignments. */
export type GridPosition = { row: number; col: number };

/** The keys that move focus around the grid. */
export type GridKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * Returns where a key moves focus from `from`, or null when it stays put.
 * Arrow keys skip cells that `isFocusable` rejects, Home and End go to the
 * row's ends, and with `toGridEnds` they go to the first or last student cell.
 * Rows run from -1, the header row, to `rows - 1`.
 */
export function moveInGrid(
  from: GridPosition,
  key: GridKey,
  { rows, cols, toGridEnds = false }: { rows: number; cols: number; toGridEnds?: boolean },
  isFocusable: (position: GridPosition) => boolean
): GridPosition | null {
  /** Returns the first focusable position among candidates, or null. */
  const firstOf = (candidates: GridPosition[]) =>
    candidates.find((candidate) => isFocusable(candidate)) ?? null;
  /** Returns the numbers from `start` up to `end`, or none when `end` is lower. */
  const upTo = (start: number, end: number) =>
    Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => start + offset);
  /** Returns the numbers from `start` down to `end`, or none when `end` is higher. */
  const downTo = (start: number, end: number) => upTo(end, start).reverse();

  if ((key === "Home" || key === "End") && toGridEnds) {
    const cells = upTo(0, rows - 1).flatMap((row) =>
      upTo(0, cols - 1).map((col) => ({ row, col }))
    );

    return firstOf(key === "Home" ? cells : cells.reverse());
  }

  switch (key) {
    case "ArrowRight":
      return firstOf(upTo(from.col + 1, cols - 1).map((col) => ({ row: from.row, col })));
    case "ArrowLeft":
      return firstOf(downTo(from.col - 1, 0).map((col) => ({ row: from.row, col })));
    case "ArrowDown":
      return firstOf(upTo(from.row + 1, rows - 1).map((row) => ({ row, col: from.col })));
    case "ArrowUp":
      return firstOf(downTo(from.row - 1, -1).map((row) => ({ row, col: from.col })));
    case "Home":
      return firstOf(upTo(0, cols - 1).map((col) => ({ row: from.row, col })));
    case "End":
      return firstOf(downTo(cols - 1, 0).map((col) => ({ row: from.row, col })));
  }
}

// #endregion

// #region Layout

/** The frozen student column's width in pixels. */
export const STUDENT_COLUMN_WIDTH = 168;

/** The narrowest an assignment column gets, in pixels. */
const MIN_COLUMN_WIDTH = 120;

/** How wide the grid's assignment columns are. */
export type GridLayout = {
  columnWidth: number;
  /** Whether the assignment columns are wider than the room, so the grid scrolls sideways. */
  overflows: boolean;
};

/**
 * Returns the assignment columns' width for `room` pixels beside the frozen
 * student column, unknown before the first measurement. When the assignments
 * overflow, the columns widen so a whole number of them fills the view, which
 * lets horizontal scrolling rest on column edges.
 */
export function gridLayout(room: number | null, assignmentCount: number): GridLayout {
  if (room === null || assignmentCount * MIN_COLUMN_WIDTH <= room) {
    return { columnWidth: MIN_COLUMN_WIDTH, overflows: false };
  }

  const visibleColumns = Math.max(1, Math.floor(room / MIN_COLUMN_WIDTH));

  return { columnWidth: Math.max(MIN_COLUMN_WIDTH, room / visibleColumns), overflows: true };
}

// #endregion
