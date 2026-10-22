"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import CreateAssignment from "../../../components/assignments/CreateAssignment";
import AssignmentItem, {
  type Assignment,
} from "../../../components/assignments/AssignmentItem";

export default function AssignmentsPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isProfessor, setIsProfessor] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const loadAssignments = useCallback(
    async (user: User) => {
      setError("");

      try {
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [assignmentsRes, profileRes] = await Promise.all([
          fetch(`/api/classes/${classId}/assignments`, { headers, cache: "no-store" }),
          fetch("/api/users", { headers, cache: "no-store" }),
        ]);

        const data = await assignmentsRes.json();

        if (!assignmentsRes.ok) {
          throw new Error(data.error || "Failed to load assignments.");
        }

        setAssignments(data.assignments ?? []);

        if (profileRes.ok) {
          const profile = await profileRes.json();
          // The server still checks class ownership when creating, editing, or deleting.
          setIsProfessor(profile.role === "professor");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [classId]
  );

  useEffect(() => {
      const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      void loadAssignments(user);
    });

    return unsubscribe;
  }, [loadAssignments, router]);

  async function handleCreated() {
    setShowForm(false);
    const user = getFirebaseAuth().currentUser;
    if (user) {
      await loadAssignments(user);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/classes"
        className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        ← Back to classes
      </Link>

      <header className="mb-6 mt-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Assignments
        </h1>

        {isProfessor && !loading && !error && (
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            {showForm ? "Cancel" : "+ Create assignment"}
          </button>
        )}
      </header>

      {showForm && (
        <CreateAssignment classId={classId} onCreated={handleCreated} />
      )}

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">Loading assignments...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : assignments.length === 0 ? (
        <p className="text-gray-500 dark:text-zinc-400">No assignments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {assignments.map((a) => (
            <AssignmentItem
              key={a.id}
              classId={classId}
              assignment={a}
              canEdit={isProfessor}
              onChanged={handleCreated}
            />

          ))}
        </ul>
      )}
    </div>
  );
}
