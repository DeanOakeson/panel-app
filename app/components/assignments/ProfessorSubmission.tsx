"use client";

import { useState } from "react";
import GradeForm from "./GradeForm";
import type { Assignment, Grade, Submission } from "../Types";

type Props = {
    classId: string;
    assignment: Assignment;
    submissions: Submission[];
    loading: boolean;
    error: string;
    /** Receives the grade the server saved for a student's submission. */
    onGraded: (studentId: string, grade: Grade) => void;
};

function formatDate(dateString: string) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}

function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Lists a class's submissions for an assignment, with a grade form on each
 * ungraded one and an editor for each graded one.
 */
export default function ProfessorSubmissions({
    classId,
    assignment,
    submissions,
    loading,
    error,
    onGraded,
}: Props) {
    const [alreadyGradedIds, setAlreadyGradedIds] = useState<ReadonlySet<string>>(
        new Set()
    );
    const [editingIds, setEditingIds] = useState<ReadonlySet<string>>(new Set());

    /** Opens or closes the grade editor on a student's row. */
    function setEditing(studentId: string, open: boolean) {
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

    /**
     * Passes a stored grade up, closes the row's editor, and remembers whether
     * the row was saved elsewhere first.
     */
    function handleSaved(studentId: string, grade: Grade, alreadyGraded: boolean) {
        setAlreadyGradedIds((current) => {
            const next = new Set(current);

            if (alreadyGraded) {
                next.add(studentId);
            } else {
                next.delete(studentId);
            }

            return next;
        });
        setEditing(studentId, false);

        onGraded(studentId, grade);
    }

    return (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Student submissions ({submissions.length})
            </h2>

            {loading ? (
                <p className="mt-3 text-sm text-gray-500">
                    Loading submissions...
                </p>
            ) : error ? (
                <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : submissions.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
                    No students have submitted this assignment yet.
                </p>
            ) : (
                <div className="mt-4 space-y-4">
                    {submissions.map((submission) => (
                        <article
                            key={submission.studentId}
                            className="rounded-lg border border-gray-200 p-4 dark:border-zinc-700"
                        >
                            <p className="break-all font-semibold text-gray-900 dark:text-white">
                                {submission.studentName ??
                                    submission.studentEmail ??
                                    "Unknown student"}
                            </p>

                            {submission.studentName && submission.studentEmail && (
                                <p className="break-all text-sm text-gray-500 dark:text-zinc-400">
                                    {submission.studentEmail}
                                </p>
                            )}

                            {!submission.studentName && !submission.studentEmail && (
                                <p className="break-all text-sm text-gray-500 dark:text-zinc-400">
                                    Student ID: {submission.studentId}
                                </p>
                            )}

                            <div className="mt-3">
                                <p className="break-all font-medium text-gray-900 dark:text-white">
                                    {submission.fileName}
                                </p>

                                <p className="text-sm text-gray-500 dark:text-zinc-400">
                                    {formatFileSize(submission.fileSize)}
                                </p>

                                <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                                    Submitted: {formatDate(submission.submittedAt)}
                                </p>

                                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                                    Status: {submission.status}
                                </p>
                            </div>

                            <div className="mt-3">
                                <p className="text-sm text-gray-500 dark:text-zinc-400">
                                    Grade
                                </p>

                                <p className="font-medium text-gray-900 dark:text-white">
                                    {submission.grade !== null
                                        ? `${submission.grade} / ${assignment.points}`
                                        : "Not graded"}
                                </p>

                                {submission.gradedAt && (
                                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                                        Graded {formatDate(submission.gradedAt)}
                                    </p>
                                )}

                                {submission.gradeUpdatedAt && (
                                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                                        Updated {formatDate(submission.gradeUpdatedAt)}
                                    </p>
                                )}

                                {submission.studentId &&
                                    alreadyGradedIds.has(submission.studentId) && (
                                        <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                                            Saved elsewhere first. Showing the saved grade.
                                        </p>
                                    )}

                                {submission.resubmittedAfterGrading && (
                                    <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                                        Resubmitted after grading
                                    </p>
                                )}
                            </div>

                            {submission.feedback && (
                                <div className="mt-3">
                                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                                        Feedback
                                    </p>

                                    <p className="whitespace-pre-line text-gray-900 dark:text-white">
                                        {submission.feedback}
                                    </p>
                                </div>
                            )}

                            {submission.fileUrl && (
                                <a
                                    href={submission.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-zinc-800"
                                >
                                    View / Download file
                                </a>
                            )}

                            {submission.grade === null && submission.studentId && (
                                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-zinc-700">
                                    <GradeForm
                                        classId={classId}
                                        assignmentId={assignment.id}
                                        studentId={submission.studentId}
                                        submittedAt={submission.submittedAt}
                                        points={assignment.points}
                                        onSaved={handleSaved}
                                    />
                                </div>
                            )}

                            {submission.grade !== null &&
                                submission.gradedAt &&
                                submission.studentId &&
                                (editingIds.has(submission.studentId) ? (
                                    <div className="mt-4 border-t border-gray-200 pt-4 dark:border-zinc-700">
                                        <GradeForm
                                            classId={classId}
                                            assignmentId={assignment.id}
                                            studentId={submission.studentId}
                                            submittedAt={submission.submittedAt}
                                            points={assignment.points}
                                            editing={{
                                                score: submission.grade,
                                                feedback: submission.feedback,
                                                lastSavedAt:
                                                    submission.gradeUpdatedAt ??
                                                    submission.gradedAt,
                                            }}
                                            onSaved={handleSaved}
                                            onCancel={() =>
                                                setEditing(submission.studentId!, false)
                                            }
                                        />
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setEditing(submission.studentId!, true)}
                                        className={`mt-4 ${submission.fileUrl ? "ml-2" : ""} inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800`}
                                    >
                                        Edit grade
                                    </button>
                                ))}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}