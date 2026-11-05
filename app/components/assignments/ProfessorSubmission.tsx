"use client";

import { useEffect, useRef, useState } from "react";
import { formatTimestamp } from "@/lib/assignmentDeadline";
import {
    countGradingStatuses,
    describeToGradeDetail,
    getGradingStatus,
    gradingStatusLabel,
    isMissingRow,
    isMissingStatus,
    needsGrade,
    type GradingCounts,
    type GradingStatus,
} from "@/lib/gradingStatus";
import GradeForm from "./GradeForm";
import GradeHistory from "./GradeHistory";
import type {
    Assignment,
    Grade,
    MissingGrade,
    MissingStudent,
    RosterStudent,
    SubmittedStudent,
} from "../Types";

type Props = {
    classId: string;
    assignment: Assignment;
    /** Every student on the assignment, in the order the server sorted them. */
    students: RosterStudent[];
    loading: boolean;
    error: string;
    /** Whether submissions have closed, which labels students without one as missing. */
    closed: boolean;
    /** Whether the viewer can grade submissions, which only the class's professor can. */
    canGradeSubmissions: boolean;
    /** Receives the grade the server saved for a student's submission. */
    onGraded: (studentId: string, grade: Grade) => void;
    /** Receives the missing-work grade the server saved for a student without a submission. */
    onMissingGraded: (studentId: string, grade: MissingGrade) => void;
};

type Filter = "all" | "to-grade" | "graded" | "missing";

const FILTERS: { value: Filter; empty: string }[] = [
    { value: "all", empty: "" },
    { value: "to-grade", empty: "Nothing needs grading." },
    { value: "graded", empty: "No submissions are graded yet." },
    { value: "missing", empty: "Every student has submitted." },
];

const BADGE_CLASSES: Record<GradingStatus, string> = {
    "needs-grading": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    resubmitted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    "submitted-after-missing":
        "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    graded: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    missing: "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300",
    "missing-graded": "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
};

/** How long a card graded under Needs grading stays before it leaves the view. */
const LEAVE_DELAY = 1500;

/** How often a card waiting to leave checks again while the professor is typing. */
const LEAVE_RETRY = 500;

const secondaryButtonClass =
    "inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800";

const primaryButtonClass =
    "inline-block rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500";

function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Returns whether a student's status belongs under a filter. */
function matchesFilter(status: GradingStatus, filter: Filter) {
    switch (filter) {
        case "all":
            return true;
        case "to-grade":
            return needsGrade(status);
        case "graded":
            return status === "graded";
        case "missing":
            return isMissingStatus(status);
    }
}

/** Returns a filter button's label. */
function filterLabel(filter: Filter, closed: boolean) {
    switch (filter) {
        case "all":
            return "All";
        case "to-grade":
            return "Needs grading";
        default:
            return gradingStatusLabel(filter, closed);
    }
}

/** Returns how many students a filter shows. */
function filterCount(counts: GradingCounts, filter: Filter) {
    switch (filter) {
        case "all":
            return counts.students;
        case "to-grade":
            return counts.toGrade;
        case "graded":
            return counts.graded;
        case "missing":
            return counts.missing;
    }
}

/**
 * Returns the summary line, like
 * "5 of 6 submitted · 3 need grading (1 resubmitted) · 1 missing (1 graded)".
 */
function describeCounts(counts: GradingCounts, closed: boolean) {
    const parts = [`${counts.submitted} of ${counts.students} submitted`];

    if (counts.toGrade > 0) {
        const verb = counts.toGrade === 1 ? "needs" : "need";
        const detail = describeToGradeDetail(counts);

        parts.push(`${counts.toGrade} ${verb} grading${detail ? ` (${detail})` : ""}`);
    } else if (counts.submitted > 0) {
        parts.push("all graded");
    }

    if (counts.missing > 0 && (counts.submitted > 0 || counts.missingGraded > 0)) {
        const graded =
            counts.missingGraded > 0 ? ` (${counts.missingGraded} graded)` : "";

        parts.push(
            `${counts.missing} ${gradingStatusLabel("missing", closed).toLowerCase()}${graded}`
        );
    }

    return parts.join(" · ");
}

/** Returns the name a professor knows a student by. */
function displayName(student: RosterStudent) {
    return student.studentName ?? student.studentEmail ?? "Unknown student";
}

/** Shows a student's grading status as a colored label. */
function StatusBadge({ status, closed }: { status: GradingStatus; closed: boolean }) {
    return (
        <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${BADGE_CLASSES[status]}`}
        >
            {gradingStatusLabel(status, closed)}
        </span>
    );
}

/** Shows a student's name, with their email or ID beneath it, and their status. */
function StudentHeading({ student, closed }: { student: RosterStudent; closed: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="break-all font-semibold text-gray-900 dark:text-white">
                    {displayName(student)}
                </p>

                {student.studentName && student.studentEmail && (
                    <p className="break-all text-sm text-gray-500 dark:text-zinc-400">
                        {student.studentEmail}
                    </p>
                )}

                {!student.studentName && !student.studentEmail && (
                    <p className="break-all text-sm text-gray-500 dark:text-zinc-400">
                        Student ID: {student.studentId}
                    </p>
                )}
            </div>

            <StatusBadge status={student.gradingStatus} closed={closed} />
        </div>
    );
}

/**
 * Lists every student on an assignment with their grading status, a filter,
 * a grade form on each ungraded submission and an editor for each graded one.
 */
export default function ProfessorSubmissions({
    classId,
    assignment,
    students,
    loading,
    error,
    closed,
    canGradeSubmissions,
    onGraded,
    onMissingGraded,
}: Props) {
    const [alreadyGradedIds, setAlreadyGradedIds] = useState<ReadonlySet<string>>(
        new Set()
    );
    const [editingIds, setEditingIds] = useState<ReadonlySet<string>>(new Set());
    const [filter, setFilter] = useState<Filter>("all");
    // Students graded under the current filter stay visible after they stop
    // matching it: until the filter changes, or briefly under Needs grading
    const [keptIds, setKeptIds] = useState<ReadonlySet<string>>(new Set());
    const [announcement, setAnnouncement] = useState("");
    const sectionRef = useRef<HTMLElement>(null);
    const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    useEffect(() => {
        const timers = leaveTimers.current;

        return () => timers.forEach((timer) => clearTimeout(timer));
    }, []);

    const counts = countGradingStatuses(
        students.map((student) => student.gradingStatus)
    );
    const visibleStudents = students.filter(
        (student) =>
            matchesFilter(student.gradingStatus, filter) ||
            keptIds.has(student.studentId)
    );

    /**
     * Opens or closes the grade editor on a student's row. An open editor
     * keeps its card in view until the grade is saved again.
     */
    function setEditing(studentId: string, open: boolean) {
        if (open) {
            clearTimeout(leaveTimers.current.get(studentId));
            leaveTimers.current.delete(studentId);
        }

        setEditingIds((current) => {
            const next = new Set(current);

            if (open) {
                next.add(studentId);
            } else {
                next.delete(studentId);
            }

            return next;
        });
    }

    /** Shows the students under a filter. */
    function chooseFilter(next: Filter) {
        leaveTimers.current.forEach((timer) => clearTimeout(timer));
        leaveTimers.current.clear();
        setFilter(next);
        setKeptIds(new Set());
    }

    /** Returns whether the professor is typing in a field on this list. */
    function isTyping() {
        const active = document.activeElement;

        return (
            (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
            !!sectionRef.current?.contains(active)
        );
    }

    /**
     * Drops a graded card from the Needs grading view after a pause, waiting
     * while the professor types elsewhere so the cards around the field stay put.
     */
    function scheduleLeave(studentId: string, delay = LEAVE_DELAY) {
        clearTimeout(leaveTimers.current.get(studentId));
        leaveTimers.current.set(
            studentId,
            setTimeout(() => {
                if (isTyping()) {
                    scheduleLeave(studentId, LEAVE_RETRY);
                    return;
                }

                leaveTimers.current.delete(studentId);
                setKeptIds((current) => {
                    const next = new Set(current);
                    next.delete(studentId);
                    return next;
                });
            }, delay)
        );
    }

    /** Announces a saved grade and how much is left to grade. */
    function announceSaved(studentId: string, grade: Grade, alreadyGraded: boolean) {
        const saved = students.find((student) => student.studentId === studentId);
        const savedStillToGrade =
            !!saved &&
            !isMissingRow(saved) &&
            needsGrade(getGradingStatus(saved, grade, saved.missingGrade));
        const left =
            students.filter(
                (student) =>
                    student.studentId !== studentId && needsGrade(student.gradingStatus)
            ).length + (savedStillToGrade ? 1 : 0);

        const name = saved ? displayName(saved) : "this student";
        const result = alreadyGraded
            ? `${name} was already graded elsewhere. Showing the saved grade.`
            : `Grade saved for ${name}.`;
        const remaining = left === 0 ? "Nothing left to grade." : `${left} left to grade.`;

        setAnnouncement(`${result} ${remaining}`);
    }

    /** Remembers whether a row's grade was saved elsewhere first. */
    function rememberSavedElsewhere(studentId: string, alreadyGraded: boolean) {
        setAlreadyGradedIds((current) => {
            const next = new Set(current);

            if (alreadyGraded) {
                next.add(studentId);
            } else {
                next.delete(studentId);
            }

            return next;
        });
    }

    /**
     * Passes a stored grade up, closes the row's editor, and remembers whether
     * the row was saved elsewhere first.
     */
    function handleSaved(studentId: string, grade: Grade, alreadyGraded: boolean) {
        rememberSavedElsewhere(studentId, alreadyGraded);
        setKeptIds((current) => new Set(current).add(studentId));
        setEditing(studentId, false);
        announceSaved(studentId, grade, alreadyGraded);

        if (filter === "to-grade") {
            scheduleLeave(studentId);
        }

        onGraded(studentId, grade);
    }

    /**
     * Passes a stored missing-work grade up, closes the row's editor, and
     * announces it.
     */
    function handleMissingSaved(
        studentId: string,
        grade: MissingGrade,
        alreadyGraded: boolean
    ) {
        const saved = students.find((student) => student.studentId === studentId);
        const name = saved ? displayName(saved) : "this student";

        rememberSavedElsewhere(studentId, alreadyGraded);
        setEditing(studentId, false);
        setAnnouncement(
            alreadyGraded
                ? `${name}'s missing work was already graded elsewhere. Showing the saved grade.`
                : `Missing-work grade saved for ${name}.`
        );
        onMissingGraded(studentId, grade);
    }

    return (
        <section
            ref={sectionRef}
            className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900"
        >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Student submissions
            </h2>

            {loading ? (
                <p className="mt-3 text-sm text-gray-500">
                    Loading submissions...
                </p>
            ) : error ? (
                <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : students.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
                    No students are enrolled in this course yet.
                </p>
            ) : (
                <>
                    <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">
                        {describeCounts(counts, closed)}
                    </p>

                    <p role="status" aria-live="polite" className="sr-only">
                        {announcement}
                    </p>

                    <div
                        role="group"
                        aria-label="Show students"
                        className="mt-4 flex flex-wrap gap-2"
                    >
                        {FILTERS.map((option) => {
                            const selected = filter === option.value;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => chooseFilter(option.value)}
                                    className={`rounded-full border px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                                        selected
                                            ? "border-blue-600 bg-blue-600 text-white"
                                            : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    {`${filterLabel(option.value, closed)} (${filterCount(counts, option.value)})`}
                                </button>
                            );
                        })}
                    </div>

                    {visibleStudents.length === 0 ? (
                        <p className="mt-4 text-sm text-gray-500 dark:text-zinc-400">
                            {FILTERS.find((option) => option.value === filter)?.empty}
                        </p>
                    ) : (
                        <div className="mt-4 space-y-4">
                            {visibleStudents.map((student) =>
                                isMissingRow(student) ? (
                                    <MissingWorkCard
                                        key={student.studentId}
                                        classId={classId}
                                        assignment={assignment}
                                        student={student}
                                        closed={closed}
                                        editing={editingIds.has(student.studentId)}
                                        savedElsewhere={alreadyGradedIds.has(
                                            student.studentId
                                        )}
                                        onEditingChange={(open) =>
                                            setEditing(student.studentId, open)
                                        }
                                        onSaved={handleMissingSaved}
                                    />
                                ) : (
                                    <SubmissionCard
                                        key={student.studentId}
                                        classId={classId}
                                        assignment={assignment}
                                        student={student}
                                        closed={closed}
                                        canGrade={canGradeSubmissions}
                                        editing={editingIds.has(student.studentId)}
                                        savedElsewhere={alreadyGradedIds.has(
                                            student.studentId
                                        )}
                                        onEditingChange={(open) =>
                                            setEditing(student.studentId, open)
                                        }
                                        onSaved={handleSaved}
                                    />
                                )
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

type SubmissionCardProps = {
    classId: string;
    assignment: Assignment;
    student: SubmittedStudent;
    /** Whether submissions have closed. */
    closed: boolean;
    /** Whether the viewer can grade the submission. */
    canGrade: boolean;
    /** Whether the grade editor is open. */
    editing: boolean;
    /** Whether another session saved the grade before this one. */
    savedElsewhere: boolean;
    onEditingChange: (open: boolean) => void;
    onSaved: (studentId: string, grade: Grade, alreadyGraded: boolean) => void;
};

/** Shows one student's submission, its grade and the form to grade or edit it. */
function SubmissionCard({
    classId,
    assignment,
    student,
    closed,
    canGrade,
    editing,
    savedElsewhere,
    onEditingChange,
    onSaved,
}: SubmissionCardProps) {
    const graded = student.grade !== null && !!student.gradedAt;

    return (
        <article className="rounded-lg border border-gray-200 p-4 dark:border-zinc-700">
            <StudentHeading student={student} closed={closed} />

            <div className="mt-3">
                <p className="break-all font-medium text-gray-900 dark:text-white">
                    {student.fileName}
                </p>

                <p className="text-sm text-gray-500 dark:text-zinc-400">
                    {formatFileSize(student.fileSize)} · Submitted{" "}
                    {formatTimestamp(student.submittedAt)}
                </p>
            </div>

            <div className="mt-3">
                <p className="text-sm text-gray-500 dark:text-zinc-400">Grade</p>

                <p className="font-medium text-gray-900 dark:text-white">
                    {student.grade !== null
                        ? `${student.grade} / ${assignment.points}`
                        : "Not graded"}
                </p>

                {student.gradedAt && (
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                        Graded {formatTimestamp(student.gradedAt)}
                    </p>
                )}

                {student.gradeUpdatedAt && (
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                        Updated {formatTimestamp(student.gradeUpdatedAt)}
                    </p>
                )}

                {savedElsewhere && (
                    <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                        Saved elsewhere first. Showing the saved grade.
                    </p>
                )}

                {student.resubmittedAfterGrading && (
                    <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                        Resubmitted after grading
                    </p>
                )}

                {student.submittedAfterMissingGrade && student.missingGrade && (
                    <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                        {`Submitted after a missing-work grade of ${student.missingGrade.score} / ${assignment.points}`}
                    </p>
                )}
            </div>

            {student.feedback && (
                <div className="mt-3">
                    <p className="text-sm text-gray-500 dark:text-zinc-400">Feedback</p>

                    <p className="whitespace-pre-line text-gray-900 dark:text-white">
                        {student.feedback}
                    </p>
                </div>
            )}

            {(graded || student.missingGrade) && (
                <GradeHistory
                    classId={classId}
                    assignmentId={assignment.id}
                    studentId={student.studentId}
                    points={assignment.points}
                    version={[
                        student.gradeUpdatedAt ?? student.gradedAt,
                        student.missingGrade?.updatedAt ?? student.missingGrade?.gradedAt,
                    ].join("|")}
                />
            )}

            {(student.fileUrl || (canGrade && graded && !editing)) && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {student.fileUrl && (
                        <a
                            href={student.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-zinc-800"
                        >
                            View / Download file
                        </a>
                    )}

                    {canGrade && graded && !editing && (
                        <button
                            type="button"
                            onClick={() => onEditingChange(true)}
                            className={
                                student.resubmittedAfterGrading
                                    ? primaryButtonClass
                                    : secondaryButtonClass
                            }
                        >
                            {student.resubmittedAfterGrading
                                ? "Grade new version"
                                : "Edit grade"}
                        </button>
                    )}
                </div>
            )}

            {canGrade && student.grade === null && (
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-zinc-700">
                    <GradeForm
                        classId={classId}
                        assignmentId={assignment.id}
                        studentId={student.studentId}
                        submittedAt={student.submittedAt}
                        points={assignment.points}
                        onSaved={onSaved}
                    />
                </div>
            )}

            {canGrade && graded && editing && (
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-zinc-700">
                    <GradeForm
                        classId={classId}
                        assignmentId={assignment.id}
                        studentId={student.studentId}
                        submittedAt={student.submittedAt}
                        points={assignment.points}
                        editing={{
                            score: student.grade!,
                            feedback: student.feedback,
                            lastSavedAt: student.gradeUpdatedAt ?? student.gradedAt!,
                        }}
                        onSaved={onSaved}
                        onCancel={() => onEditingChange(false)}
                    />
                </div>
            )}
        </article>
    );
}

type MissingWorkCardProps = {
    classId: string;
    assignment: Assignment;
    student: MissingStudent;
    /** Whether submissions have closed. */
    closed: boolean;
    /** Whether the grade form is open. */
    editing: boolean;
    /** Whether another session saved the missing-work grade before this one. */
    savedElsewhere: boolean;
    onEditingChange: (open: boolean) => void;
    onSaved: (studentId: string, grade: MissingGrade, alreadyGraded: boolean) => void;
};

/**
 * Shows one student without a submission, their missing-work grade, and the
 * form to grade or edit it. A grade can only be added once submissions close.
 */
function MissingWorkCard({
    classId,
    assignment,
    student,
    closed,
    editing,
    savedElsewhere,
    onEditingChange,
    onSaved,
}: MissingWorkCardProps) {
    const missingGrade = student.missingGrade;

    return (
        <article className="rounded-lg border border-gray-200 p-4 dark:border-zinc-700">
            <StudentHeading student={student} closed={closed} />

            <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                No submission
            </p>

            {missingGrade && (
                <>
                    <div className="mt-3">
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Missing-work grade
                        </p>

                        <p className="font-medium text-gray-900 dark:text-white">
                            {`${missingGrade.score} / ${assignment.points}`}
                        </p>

                        <p className="text-xs text-gray-500 dark:text-zinc-400">
                            Graded {formatTimestamp(missingGrade.gradedAt)}
                        </p>

                        {missingGrade.updatedAt && (
                            <p className="text-xs text-gray-500 dark:text-zinc-400">
                                Updated {formatTimestamp(missingGrade.updatedAt)}
                            </p>
                        )}

                        {savedElsewhere && (
                            <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                                Saved elsewhere first. Showing the saved grade.
                            </p>
                        )}
                    </div>

                    {missingGrade.feedback && (
                        <div className="mt-3">
                            <p className="text-sm text-gray-500 dark:text-zinc-400">
                                Feedback
                            </p>

                            <p className="whitespace-pre-line text-gray-900 dark:text-white">
                                {missingGrade.feedback}
                            </p>
                        </div>
                    )}

                    <GradeHistory
                        classId={classId}
                        assignmentId={assignment.id}
                        studentId={student.studentId}
                        points={assignment.points}
                        version={missingGrade.updatedAt ?? missingGrade.gradedAt}
                    />
                </>
            )}

            {/* Missing work can be graded once submissions close, and edited after that */}
            {!editing && (missingGrade || closed) && (
                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => onEditingChange(true)}
                        className={secondaryButtonClass}
                    >
                        {missingGrade ? "Edit missing-work grade" : "Grade missing work"}
                    </button>
                </div>
            )}

            {editing && (
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-zinc-700">
                    <GradeForm
                        classId={classId}
                        assignmentId={assignment.id}
                        studentId={student.studentId}
                        submittedAt={null}
                        points={assignment.points}
                        editing={
                            missingGrade
                                ? {
                                      score: missingGrade.score,
                                      feedback: missingGrade.feedback,
                                      lastSavedAt:
                                          missingGrade.updatedAt ?? missingGrade.gradedAt,
                                  }
                                : undefined
                        }
                        onSaved={onSaved}
                        onCancel={() => onEditingChange(false)}
                    />
                </div>
            )}
        </article>
    );
}
