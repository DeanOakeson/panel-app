"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import type { Assignment } from "@/app/components/assignments/AssignmentItem";
import SubmissionItem, {
  type Submission,
} from "@/app/components/assignments/SubmissionItem";

export default function SubmissionsPage() {
  const { classId, assignmentId } = useParams<{
    classId: string;
    assignmentId: string;
  }>();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSubmissions = useCallback(
    async (user: User) => {
      setError("");

      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/classes/${classId}/assignments/${assignmentId}/submissions`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load submissions.");
        }

        setAssignment(data.assignment);
        setSubmissions(data.submissions ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [classId, assignmentId]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      void loadSubmissions(user);
    });

    return unsubscribe;
  }, [loadSubmissions, router]);

  async function handleGraded() {
    const user = getFirebaseAuth().currentUser;
    if (user) {
      await loadSubmissions(user);
    }
  }

  const gradedCount = submissions.filter((submission) => submission.grade).length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href={`/classes/${classId}/assignments`}
        className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        ← Back to assignments
      </Link>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {assignment ? `Submissions: ${assignment.name}` : "Submissions"}
        </h1>

        {assignment && (
          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            {assignment.points} pts ·{" "}
            {assignment.dueDate ? `Due ${assignment.dueDate}` : "No due date"} ·{" "}
            {submissions.length}{" "}
            {submissions.length === 1 ? "submission" : "submissions"} ·{" "}
            {gradedCount} graded
          </p>
        )}
      </header>

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">Loading submissions...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : submissions.length === 0 ? (
        <p className="text-gray-500 dark:text-zinc-400">No submissions yet.</p>
      ) : (
        assignment && (
          <ul className="flex flex-col gap-3">
            {submissions.map((submission) => (
              <SubmissionItem
                key={submission.id}
                classId={classId}
                assignmentId={assignmentId}
                points={assignment.points}
                submission={submission}
                onGraded={handleGraded}
              />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
