"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

import AssignmentInfo from "../../../../components/assignments/AssignmentInfo";
import StudentSubmission from "../../../../components/assignments/StudentSubmission";
import ProfessorSubmissions from "../../../../components/assignments/ProfessorSubmission";
import SubmissionUploadForm from "../../../../components/assignments/SubmissionUploadForm";

import type { Assignment, Submission } from "../../../../components/Types";

export default function AssignmentDetailPage() {
    const { classId, assignmentId } = useParams<{
        classId: string;
        assignmentId: string;
    }>();

    const router = useRouter();

    const [assignment, setAssignment] = useState<Assignment | null>(null);
    const [submission, setSubmission] = useState<Submission | null>(null);
    const [studentSubmissions, setStudentSubmissions] = useState<Submission[]>([]);
    const [isProfessor, setIsProfessor] = useState(false);

    const [loading, setLoading] = useState(true);
    const [submissionLoading, setSubmissionLoading] = useState(false);

    const [error, setError] = useState("");
    const [submissionError, setSubmissionError] = useState("");

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState("");

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

                if (data.role === "professor") {
                    setIsProfessor(true);
                    setStudentSubmissions(data.submissions ?? []);
                    setSubmission(null);
                } else {
                    setIsProfessor(false);
                    setSubmission(data.submission ?? null);
                    setStudentSubmissions([]);
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

    return (
        <div className="mx-auto w-full max-w-3xl">
            <Link
                href={`/classes/${classId}/assignments`}
                className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
                ← Back to assignments
            </Link>

            {loading ? (
                <p className="mt-6 text-gray-600 dark:text-gray-300">
                    Loading assignment...
                </p>
            ) : error ? (
                <p className="mt-6 text-red-600">{error}</p>
            ) : assignment ? (
                <>
                    <AssignmentInfo assignment={assignment} />

                    {isProfessor ? (
                        <ProfessorSubmissions
                            submissions={studentSubmissions}
                            loading={submissionLoading}
                            error={submissionError}
                        />
                    ) : (
                        <>
                            <StudentSubmission
                                assignment={assignment}
                                submission={submission}
                                loading={submissionLoading}
                                error={submissionError}
                            />

                            <SubmissionUploadForm
                                submission={!!submission}
                                selectedFile={selectedFile}
                                submitting={submitting}
                                message={submitMessage}
                                onFileChange={setSelectedFile}
                                onSubmit={handleSubmit}
                            />
                        </>
                    )}
                </>
            ) : null}
        </div>
    );
}