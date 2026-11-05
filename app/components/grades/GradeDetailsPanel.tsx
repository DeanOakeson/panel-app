"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { formatClosesAt, formatTimestamp } from "@/lib/assignmentDeadline";
import {
    describeCell,
    gradingHref,
    standingFeedback,
    type GradebookAssignment,
    type GradebookCell,
    type GradebookStudent,
} from "@/lib/gradebook";
import MissingTag from "../assignments/MissingTag";
import StatusBadge from "../assignments/StatusBadge";
import { displayStudentName } from "./GradebookTable";

/** The cell a details panel shows, with its student and assignment. */
export type CellDetails = {
    student: GradebookStudent;
    assignment: GradebookAssignment;
    cell: GradebookCell;
};

type Props = {
    classId: string;
    /** The cell to show. Null closes the panel. */
    details: CellDetails | null;
    canGradeSubmissions: boolean;
    /** Called once the panel has closed, by Escape, the close button or a click outside it. */
    onClose: () => void;
};

const TITLE_ID = "grade-details-title";

/** Returns a cell's score line and the note beneath it. */
function describeScore(
    cell: GradebookCell,
    assignment: GradebookAssignment
): { score: number | null; missing: boolean; note: string } {
    switch (cell.status) {
        case "graded":
            return { score: cell.score, missing: false, note: "" };
        case "needs-grading":
            return { score: null, missing: false, note: "Submitted and waiting to be graded." };
        case "resubmitted":
            return {
                score: cell.score,
                missing: false,
                note: `For the version submitted ${formatTimestamp(cell.grade?.submittedAt ?? "")}. A newer version is waiting to be graded, and this score counts until then.`,
            };
        case "submitted-after-missing":
            return {
                score: cell.score,
                missing: true,
                note: "A missing-work grade. The student turned work in afterwards, and it is waiting to be graded.",
            };
        case "missing":
            if (assignment.closed) {
                return {
                    score: null,
                    missing: false,
                    note: "Nothing was turned in before the due date, and no missing-work grade is saved.",
                };
            }

            return {
                score: null,
                missing: false,
                note: assignment.closesAt
                    ? `Nothing turned in yet. Submissions are open until ${formatClosesAt(assignment.closesAt)}.`
                    : "Nothing turned in yet. This assignment has no due date.",
            };
        case "missing-graded":
            return {
                score: cell.score,
                missing: true,
                note: "A missing-work grade, saved because nothing was turned in.",
            };
    }
}

/** Returns the due line, the closing time when there is one. */
function describeDue(assignment: GradebookAssignment): string {
    if (assignment.closesAt) return formatClosesAt(assignment.closesAt);

    return assignment.dueDate ?? "No due date";
}

/** Shows one labelled line of the dates list, or nothing without a value. */
function DateRow({ label, value }: { label: string; value: string | null | undefined }) {
    if (!value) return null;

    return (
        <>
            <dt className="text-gray-500 dark:text-zinc-400">{label}</dt>
            <dd className="text-gray-900 dark:text-white">{value}</dd>
        </>
    );
}

/**
 * Shows one gradebook cell in a drawer on the right: its status, score,
 * full feedback and dates, with a link into grading. A native modal dialog
 * keeps focus inside and returns it when closed.
 */
export default function GradeDetailsPanel({ classId, details, canGradeSubmissions, onClose }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const isOpen = details !== null;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (isOpen && !dialog.open) dialog.showModal();
        if (!isOpen && dialog.open) dialog.close();
    }, [isOpen]);

    /** Closes the panel on a click on the backdrop, which lands on the dialog itself. */
    function handleClick(event: MouseEvent<HTMLDialogElement>) {
        if (event.target === event.currentTarget) {
            event.currentTarget.close();
        }
    }

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={TITLE_ID}
            onClose={onClose}
            onClick={handleClick}
            className="fixed inset-y-0 left-auto right-0 m-0 h-full max-h-full w-full max-w-md border-0 border-l border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-gray-900 dark:text-white"
        >
            {details && (
                <PanelBody
                    classId={classId}
                    details={details}
                    canGradeSubmissions={canGradeSubmissions}
                    onCloseClick={() => dialogRef.current?.close()}
                />
            )}
        </dialog>
    );
}

/** Shows the panel's heading, the cell's details and its grading action. */
function PanelBody({
    classId,
    details,
    canGradeSubmissions,
    onCloseClick,
}: {
    classId: string;
    details: CellDetails;
    canGradeSubmissions: boolean;
    onCloseClick: () => void;
}) {
    const { student, assignment, cell } = details;
    const display = describeCell(cell, assignment, canGradeSubmissions);
    const score = describeScore(cell, assignment);
    const feedback = standingFeedback(cell);
    const standing = cell.grade ?? cell.missingGrade;
    const feedbackHeading =
        cell.status === "resubmitted" ? "Feedback on the earlier version" : "Feedback";
    const gradesSubmission =
        cell.status !== "missing" && cell.status !== "missing-graded";

    return (
        <div className="flex h-full flex-col">
            <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-zinc-700">
                <div className="min-w-0">
                    <h2 id={TITLE_ID} className="break-words text-lg font-semibold">
                        {displayStudentName(student)}
                    </h2>

                    {student.name && student.email && (
                        <p className="break-all text-sm text-gray-500 dark:text-zinc-400">
                            {student.email}
                        </p>
                    )}

                    <p className="mt-1 break-words text-sm font-medium text-gray-700 dark:text-zinc-300">
                        {assignment.name}
                    </p>

                    {!student.enrolled && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                            No longer enrolled in this course.
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onCloseClick}
                    aria-label="Close details"
                    className="-mr-2 shrink-0 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                        <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
                    </svg>
                </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
                <div>
                    <StatusBadge status={cell.status} closed={assignment.closed} />
                </div>

                <section aria-labelledby="grade-details-score">
                    <h3
                        id="grade-details-score"
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                    >
                        Score
                    </h3>

                    {score.score !== null ? (
                        <p className="mt-1 flex items-center gap-2">
                            <span className="text-3xl font-semibold tabular-nums">{score.score}</span>
                            <span className="text-base text-gray-500 dark:text-zinc-400">
                                / {assignment.points}
                            </span>
                            {score.missing && <MissingTag />}
                        </p>
                    ) : (
                        <p className="mt-1 text-base font-medium text-gray-700 dark:text-zinc-300">
                            No score yet
                            <span className="font-normal text-gray-500 dark:text-zinc-400">
                                {` (out of ${assignment.points})`}
                            </span>
                        </p>
                    )}

                    {score.note && (
                        <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">{score.note}</p>
                    )}
                </section>

                {standing && (
                    <section aria-labelledby="grade-details-feedback">
                        <h3
                            id="grade-details-feedback"
                            className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                        >
                            {feedbackHeading}
                        </h3>

                        {feedback ? (
                            <p className="mt-1 whitespace-pre-line break-words text-gray-900 dark:text-white">
                                {feedback}
                            </p>
                        ) : (
                            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">No feedback</p>
                        )}
                    </section>
                )}

                <section aria-labelledby="grade-details-dates">
                    <h3
                        id="grade-details-dates"
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400"
                    >
                        Dates
                    </h3>

                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <DateRow label="Due" value={describeDue(assignment)} />
                        <DateRow
                            label="Submitted"
                            value={cell.submittedAt ? formatTimestamp(cell.submittedAt) : null}
                        />
                        <DateRow
                            label="Graded"
                            value={standing?.gradedAt ? formatTimestamp(standing.gradedAt) : null}
                        />
                        <DateRow
                            label="Updated"
                            value={standing?.updatedAt ? formatTimestamp(standing.updatedAt) : null}
                        />
                    </dl>
                </section>
            </div>

            {display.action && (
                <footer className="border-t border-gray-200 px-5 py-4 dark:border-zinc-700">
                    <Link
                        href={gradingHref(classId, assignment.id, student.id)}
                        className={`inline-block rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                            display.action.urgent
                                ? "bg-blue-600 text-white hover:bg-blue-500"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800"
                        }`}
                    >
                        {display.action.label}
                    </Link>

                    {!canGradeSubmissions && gradesSubmission && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
                            Only the course&apos;s professor can grade submissions.
                        </p>
                    )}
                </footer>
            )}
        </div>
    );
}
