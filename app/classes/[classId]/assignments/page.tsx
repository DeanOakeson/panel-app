
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

type UserProfile = {
  role?: string;
};

export default function AssignmentsPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [showForm, setShowForm] = useState(false);

  const isProfessor = role === "professor";
  const isStudent = role === "student";
  const isAdmin = role === "admin";

  const loadAssignments = useCallback(
    async (user: User) => {
      setLoading(true);
      setError("");

      try {
        const token = await user.getIdToken();
        const headers = {
          Authorization: `Bearer ${token}`,
        };

        const [assignmentsRes, profileRes] = await Promise.all([
          fetch(`/api/classes/${classId}/assignments`, {
            headers,
            cache: "no-store",
          }),
          fetch("/api/users", {
            headers,
            cache: "no-store",
          }),
        ]);

        if (!profileRes.ok) {
          throw new Error("Failed to load your user profile.");
        }

        const profile: UserProfile = await profileRes.json();
        setRole(profile.role ?? "");

        if (!assignmentsRes.ok) {
          const data = await assignmentsRes.json();
          throw new Error(data.error || "Failed to load assignments.");
        }

        const data = await assignmentsRes.json();
        setAssignments(data.assignments ?? []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong."
        );
      } finally {
        setLoading(false);
      }
    },
    [classId]
  );

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      void loadAssignments(user);
    });

    return unsubscribe;
  }, [loadAssignments, router]);

  async function reloadAssignments() {
    const user = getFirebaseAuth().currentUser;

    if (user) {
      await loadAssignments(user);
    }
  }

  async function handleCreated() {
    setShowForm(false);
    await reloadAssignments();
  }

  // Editing or deleting only refreshes the list, so an open create form
  // (and any draft in it) stays put.
  async function handleChanged() {
    await reloadAssignments();
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Assignments
          </h1>

          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
            View assignments for this class.
          </p>
        </div>

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

      {showForm && isProfessor && (
        <div className="mb-6">
          <CreateAssignment
            classId={classId}
            onCreated={handleCreated}
          />
        </div>
      )}

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">
          Loading assignments...
        </p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>

          <button
            type="button"
            onClick={() => {
              const user = getFirebaseAuth().currentUser;

              if (user) {
                void loadAssignments(user);
              }
            }}
            className="mt-2 text-sm font-semibold text-red-700 underline dark:text-red-300"
          >
            Try again
          </button>
        </div>
      ) : !isProfessor && !isStudent && !isAdmin ? (
        <p className="text-gray-500 dark:text-zinc-400">
          Your account does not have permission to view assignments.
        </p>
      ) : assignments.length === 0 ? (
        <div className="rounded-lg border border-gray-200 p-6 text-center dark:border-zinc-800">
          <p className="font-medium text-gray-700 dark:text-gray-200">
            No assignments yet.
          </p>

          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
            Assignments for this class will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {assignments.map((assignment) => (
            <AssignmentItem
              key={assignment.id}
              classId={classId}
              assignment={assignment}
              canEdit={isProfessor}
              href={`/classes/${classId}/assignments/${assignment.id}`}
              onChanged={handleChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
