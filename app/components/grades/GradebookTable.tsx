"use client";

import Link from "next/link";
import {
    describeCell,
    studentLabel,
    type Gradebook,
    type GradebookAssignment,
    type GradebookStudent,
} from "@/lib/gradebook";
import GradeCellContent from "./GradeCellContent";

/** Identifies one cell of the gradebook. */
export type CellKey = { studentId: string; assignmentId: string };

type Props = {
    gradebook: Gradebook;
    /** The cell whose details are open, outlined in the grid. */
    selected: CellKey | null;
    onSelect: (key: CellKey) => void;
};

/** Returns the attribute value that finds a cell's button again, such as after its panel closes. */
export function cellDataKey({ studentId, assignmentId }: CellKey): string {
    return `${studentId}:${assignmentId}`;
}

/** Returns the name shown for a student, falling back for an unknown one. */
export function displayStudentName(student: GradebookStudent): string {
    return studentLabel(student) ?? "Unknown student";
}

/** Returns a short due line for a column header, like "Due Oct 30". */
function shortDue(assignment: GradebookAssignment): string {
    if (assignment.closesAt) {
        const day = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Denver",
            month: "short",
            day: "numeric",
        }).format(new Date(assignment.closesAt));

        return `Due ${day}`;
    }

    return assignment.dueDate ? `Due ${assignment.dueDate}` : "No due date";
}

/** Shows how much of an assignment is left to grade, under its column header. */
function GradingSummary({ assignment }: { assignment: GradebookAssignment }) {
    const { toGrade, submitted } = assignment.grading;

    if (toGrade > 0) {
        return (
            <span className="font-semibold text-amber-700 dark:text-amber-400">
                {toGrade} to grade
            </span>
        );
    }

    if (submitted === 0) {
        return <span className="text-gray-500 dark:text-zinc-400">Nothing submitted</span>;
    }

    return <span className="font-semibold text-green-700 dark:text-green-400">All graded</span>;
}

/** Shows a student's name, their email and a Not enrolled tag for someone who left. */
function StudentHeader({ student }: { student: GradebookStudent }) {
    const label = studentLabel(student);

    return (
        <div className="min-w-0">
            <p className="truncate font-medium text-gray-900 dark:text-white" title={label ?? undefined}>
                {label ?? "Unknown student"}
            </p>

            {student.name && student.email && (
                <p
                    className="truncate text-xs font-normal text-gray-500 dark:text-zinc-400"
                    title={student.email}
                >
                    {student.email}
                </p>
            )}

            {!label && (
                <p className="truncate text-xs font-normal text-gray-500 dark:text-zinc-400">
                    ID: {student.id}
                </p>
            )}

            {!student.enrolled && (
                <span className="mt-1 inline-block rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-zinc-600 dark:text-zinc-300">
                    Not enrolled
                </span>
            )}
        </div>
    );
}

const stickyCellBase = "border-b border-gray-200 dark:border-zinc-700";
const bodyBackground =
    "bg-white group-hover:bg-gray-50 dark:bg-gray-900 dark:group-hover:bg-gray-800";

/**
 * Shows every student against every assignment. Each cell is a button that
 * opens its details, and the header row and student column stay in view
 * while the grid scrolls.
 */
export default function GradebookTable({ gradebook, selected, onSelect }: Props) {
    const { assignments, students, canGradeSubmissions } = gradebook;
    const courseName = gradebook.class.courseCode ?? gradebook.class.name;

    return (
        <div className="min-h-0 max-w-full shrink self-start overflow-auto rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-gray-900">
            <table className="border-separate border-spacing-0 text-sm">
                <caption className="sr-only">
                    {`Grades for ${courseName}. Each row is a student and each column an assignment. Select a cell to see its details.`}
                </caption>

                <thead>
                    <tr>
                        <th
                            scope="col"
                            className={`sticky left-0 top-0 z-30 w-52 min-w-52 border-r bg-gray-50 px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-zinc-300 ${stickyCellBase}`}
                        >
                            Student
                        </th>

                        {assignments.map((assignment) => (
                            <th
                                key={assignment.id}
                                scope="col"
                                className={`sticky top-0 z-20 w-36 min-w-36 max-w-36 bg-gray-50 px-2 py-2 text-left align-top font-normal dark:bg-gray-800 ${stickyCellBase}`}
                            >
                                <Link
                                    href={`/classes/${gradebook.class.id}/assignments/${assignment.id}`}
                                    title={assignment.name}
                                    className="line-clamp-2 break-words text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
                                >
                                    {assignment.name}
                                </Link>

                                <p className="mt-1 text-xs text-gray-600 dark:text-zinc-300">
                                    Out of {assignment.points}
                                </p>

                                <p className="text-xs text-gray-600 dark:text-zinc-300">
                                    {shortDue(assignment)}
                                    {assignment.closed && (
                                        <span className="text-gray-500 dark:text-zinc-400"> · Closed</span>
                                    )}
                                </p>

                                <p className="mt-1 text-xs">
                                    <GradingSummary assignment={assignment} />
                                </p>
                            </th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {students.map((student) => {
                        const name = displayStudentName(student);

                        return (
                            <tr key={student.id} className="group">
                                <th
                                    scope="row"
                                    className={`sticky left-0 z-10 w-52 min-w-52 max-w-52 border-r px-3 py-2 text-left align-middle font-normal ${stickyCellBase} ${bodyBackground}`}
                                >
                                    <StudentHeader student={student} />
                                </th>

                                {assignments.map((assignment, index) => {
                                    const cell = student.cells[index];
                                    const display = describeCell(
                                        cell,
                                        assignment,
                                        canGradeSubmissions
                                    );
                                    const key = { studentId: student.id, assignmentId: assignment.id };
                                    const isSelected =
                                        selected?.studentId === student.id &&
                                        selected.assignmentId === assignment.id;

                                    return (
                                        <td
                                            key={assignment.id}
                                            className={`p-1 align-middle ${stickyCellBase} ${bodyBackground}`}
                                        >
                                            {cell ? (
                                                <button
                                                    type="button"
                                                    aria-haspopup="dialog"
                                                    aria-label={`${display.srText}. ${name}, ${assignment.name}`}
                                                    data-cell={cellDataKey(key)}
                                                    onClick={() => onSelect(key)}
                                                    className={`flex min-h-14 w-full items-center justify-center rounded-md px-2 py-1.5 hover:bg-blue-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-blue-950 dark:focus-visible:outline-blue-400 ${
                                                        isSelected
                                                            ? "bg-blue-50 ring-2 ring-inset ring-blue-500 dark:bg-blue-950 dark:ring-blue-400"
                                                            : ""
                                                    }`}
                                                >
                                                    <GradeCellContent display={display} points={assignment.points} />
                                                </button>
                                            ) : (
                                                <span className="flex min-h-14 items-center justify-center text-gray-400 dark:text-zinc-500">
                                                    <span aria-hidden="true">–</span>
                                                    <span className="sr-only">{display.srText}</span>
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
