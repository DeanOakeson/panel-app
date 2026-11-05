"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { formatClosesAt, hasClosed, whenPassed } from "@/lib/assignmentDeadline";
import { announceGradeSaved } from "@/lib/gradeEvents";
import { getGradingStatus, isMissingRow } from "@/lib/gradingStatus";

import AssignmentInfo from "../../../../components/assignments/AssignmentInfo";
import StudentSubmission from "../../../../components/assignments/StudentSubmission";
import ProfessorSubmissions from "../../../../components/assignments/ProfessorSubmission";
import SubmissionUploadForm from "../../../../components/assignments/SubmissionUploadForm";

import type {
    Assignment,
    Grade,
    MissingGrade,
    MissingGradeSummary,
    RosterStudent,
    Submission,
} from "../../../../components/Types";

export default function AssignmentDetailPage() {
    const { classId, assignmentId } = useParams<{
        classId: string;
        assignmentId: string;
    }>();

    const router = useRouter();
    const searchParams = useSearchParams();
    const focusStudentId = searchParams.get("student");
    const fromGrades = searchParams.get("from") === "grades";

    const [assignment, setAssignment] = useState<Assignment | null>(null);
    const [submission, setSubmission] = useState<Submission | null>(null);
    const [missingGrade, setMissingGrade] = useState<MissingGradeSummary | null>(null);
    const [students, setStudents] = useState<RosterStudent[]>([]);
    const [isProfessor, setIsProfessor] = useState(false);
    const [viewsRoster, setViewsRoster] = useState(false);

    const [loading, setLoading] = useState(true);
    const [submissionLoading, setSubmissionLoading] = useState(false);

    const [error, setError] = useState("");
    const [submissionError, setSubmissionError] = useState("");

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState("");
    const [submissionsClosed, setSubmissionsClosed] = useState(false);

    const loadSubmission = useCallback(
        async (user: User) => {
            setSubmissionLoading(true);
            setSubmissionError("");

            try {
                const token = await user.getIdToken();

                const response = await fetch(
                    `/api/classes/${classId}/assignments/${assignmentId}/submit`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        cache: "no-store",
                    }
                );

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.error || "Failed to load submissions."
                    );
                }

                // An admin who opens the page sees the roster too, and can
                // grade missing work but not submissions
                if (data.role === "professor" || data.role === "admin") {
                    setIsProfessor(data.role === "professor");
                    setViewsRoster(true);
                    setStudents(data.students ?? []);
                    setSubmission(null);
                    setMissingGrade(null);
                } else {
                    setIsProfessor(false);
                    setViewsRoster(false);
                    setSubmission(data.submission ?? null);
                    setMissingGrade(data.missingGrade ?? null);
                    setStudents([]);
                }
            } catch (err) {
                setSubmissionError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load submissions."
                );
            } finally {
                setSubmissionLoading(false);
            }
        },
        [classId, assignmentId]
    );

    async function handleSubmit() {
        if (!selectedFile) {
            setSubmitMessage("Please select a file.");
            return;
        }

        const user = getFirebaseAuth().currentUser;

        if (!user) {
            router.replace("/login");
            return;
        }

        setSubmitting(true);
        setSubmitMessage("");
        setSubmissionError("");

        try {
            const token = await user.getIdToken();
            const formData = new FormData();

            formData.append("file", selectedFile);

            const response = await fetch(
                `/api/classes/${classId}/assignments/${assignmentId}/submit`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    body: formData,
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Submission failed.");
            }

            setSelectedFile(null);
            setSubmitMessage("Assignment submitted successfully!");

            const fileInput = document.getElementById(
                "assignment-file"
            ) as HTMLInputElement | null;

            if (fileInput) {
                fileInput.value = "";
            }

            await loadSubmission(user);
        } catch (err) {
            setSubmitMessage(
                err instanceof Error
                    ? err.message
                    : "Something went wrong."
            );
        } finally {
            setSubmitting(false);
        }
    }

    // Updates only the graded student in place, so other students' grade
    // forms stay mounted with their unsaved drafts and the list keeps its order
    function handleGraded(studentId: string, grade: Grade) {
        announceGradeSaved(classId);
        setStudents((current) =>
            current.map((student) =>
                student.studentId === studentId && !isMissingRow(student)
                    ? {
                          ...student,
                          grade: grade.score,
                          feedback: grade.feedback,
                          gradedAt: grade.gradedAt,
                          gradeUpdatedAt: grade.updatedAt ?? null,
                          resubmittedAfterGrading:
                              grade.submittedAt !== student.submittedAt,
                          gradingStatus: getGradingStatus(
                              student,
                              grade,
                              student.missingGrade
                          ),
                      }
                    : student
            )
        );
    }

    // Updates only the student whose missing work was graded, in place
    function handleMissingGraded(studentId: string, grade: MissingGrade) {
        announceGradeSaved(classId);
        setStudents((current) =>
            current.map((student) =>
                student.studentId === studentId && isMissingRow(student)
                    ? {
                          ...student,
                          missingGrade: {
                              score: grade.score,
                              feedback: grade.feedback,
                              gradedAt: grade.gradedAt,
                              updatedAt: grade.updatedAt ?? null,
                          },
                          gradingStatus: "missing-graded",
                      }
                    : student
            )
        );
    }

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(
            getFirebaseAuth(),
            async (user) => {
                if (!user) {
                    router.replace("/login");
                    return;
                }

                try {
                    setLoading(true);
                    setError("");

                    const token = await user.getIdToken();

                    const response = await fetch(
                        `/api/classes/${classId}/assignments/${assignmentId}`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                            cache: "no-store",
                        }
                    );

                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(
                            data.error || "Failed to load assignment."
                        );
                    }

                    setAssignment(data.assignment);
                    setSubmissionsClosed(hasClosed(data.assignment.closesAt));

                    await loadSubmission(user);
                } catch (err) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Something went wrong."
                    );
                } finally {
                    setLoading(false);
                }
            }
        );

        return unsubscribe;
    }, [classId, assignmentId, router, loadSubmission]);

    const closesAt = assignment?.closesAt;

    // Closes the form on a page left open past the cutoff
    useEffect(() => {
        if (!closesAt) {
            return;
        }

        return whenPassed(closesAt, () => setSubmissionsClosed(true));
    }, [closesAt]);

    return (
        <div className="mx-auto w-full max-w-3xl">
            <Link
                href={`/classes/${classId}/${fromGrades ? "grades" : "assignments"}`}
                className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
                {fromGrades ? "← Back to grades" : "← Back to assignments"}
            </Link>

            {loading ? (
                <p className="mt-6 text-gray-600 dark:text-gray-300">
                    Loading assignment...
                </p>
            ) : error ? (
                <p className="mt-6 text-red-600">{error}</p>
            ) : assignment ? (
                <>
                    <AssignmentInfo assignment={assignment} showDueTime={viewsRoster} />

                    {viewsRoster ? (
                        <ProfessorSubmissions
                            classId={classId}
                            assignment={assignment}
                            students={students}
                            loading={submissionLoading}
                            error={submissionError}
                            closed={submissionsClosed}
                            canGradeSubmissions={isProfessor}
                            onGraded={handleGraded}
                            onMissingGraded={handleMissingGraded}
                            focusStudentId={focusStudentId}
                        />
                    ) : (
                        <>
                            <StudentSubmission
                                assignment={assignment}
                                submission={submission}
                                missingGrade={missingGrade}
                                loading={submissionLoading}
                                error={submissionError}
                            />

                            {submissionsClosed && closesAt ? (
                                <p className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 dark:border-zinc-800 dark:bg-gray-900 dark:text-zinc-300">
                                    Submissions closed {formatClosesAt(closesAt)}
                                </p>
                            ) : (
                                <SubmissionUploadForm
                                    submission={!!submission}
                                    selectedFile={selectedFile}
                                    submitting={submitting}
                                    message={submitMessage}
                                    onFileChange={setSelectedFile}
                                    onSubmit={handleSubmit}
                                />
                            )}
                        </>
                    )}
                </>
            ) : null}
        </div>
    );
}