"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Professor = { uid: string; name: string; email: string } | null;

type Student = { uid: string; name: string; email: string };

type ClassDetails = {
  id: string;
  name: string;
  courseCode: string;
  year: string;
  term: string;
  section: string;
  professor_id?: string;
};

type StudentOption = { uid: string; name: string; email: string };

export default function AdminClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [klass, setKlass] = useState<ClassDetails | null>(null);
  const [professor, setProfessor] = useState<Professor>(null);
  const [roster, setRoster] = useState<Student[]>([]);

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [busyUid, setBusyUid] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const getDetails = useCallback(
    async (token: string) => {
      const res = await fetch(`/api/admin/classes/${classId}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((data.error as string) || "Failed to load.");
      setKlass(data.class as ClassDetails);
      setProfessor(data.professor as Professor);
      setRoster((data.roster as Student[]) ?? []);
    },
    [classId]
  );

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError("");
      try {
        await getDetails(token);
        const studentsRes = await fetch("/api/admin/users?role=student", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const studentsData = await studentsRes.json().catch(() => ({}));
        if (studentsRes.ok) {
          setStudents((studentsData.users as StudentOption[]) ?? []);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load this course."
        );
      } finally {
        setLoading(false);
      }
    },
    [getDetails]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      void user.getIdToken().then((token) => void load(token));
    });
    return unsubscribe;
  }, [load, router]);

  async function handleEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setEnrolling(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/classes/${classId}/enrollments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ studentId: selectedStudent }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess("Student enrolled.");
      setSelectedStudent("");
      await getDetails(token);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleUnenroll(uid: string) {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setBusyUid(uid);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(
        `/api/admin/classes/${classId}/enrollments/${uid}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess("Student removed from the roster.");
      await getDetails(token);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setBusyUid("");
    }
  }

  async function handleDelete() {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setDeleting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/classes/${classId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setDeleting(false);
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      router.replace("/admin");
    } catch {
      setDeleting(false);
      setActionError("Something went wrong. Please try again.");
    }
  }

  const inputClass =
    "rounded border px-3 py-2 bg-transparent text-black dark:text-white dark:border-gray-600";

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <p className="text-sm text-zinc-500">Loading course...</p>
      </main>
    );
  }

  if (loadError || !klass) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <Link
          href="/admin"
          className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          ← Back to admin panel
        </Link>
        <p className="mt-4 text-sm text-red-600">
          {loadError || "Course not found."}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Link
        href="/admin"
        className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        ← Back to admin panel
      </Link>
      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Admin
      </p>
      <h1 className="text-2xl font-bold">
        {klass.courseCode} {klass.name}
      </h1>
      <p className="mb-6 mt-1 text-sm text-zinc-500">
        {klass.term} {klass.year}, section {klass.section}
        {professor ? ` · ${professor.name}` : " · No professor assigned"}
      </p>

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}
      {actionSuccess && (
        <p className="mb-4 text-sm text-green-600">{actionSuccess}</p>
      )}

      {/* Professor */}
      <section className="mb-6 rounded border p-5 bg-white dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Professor
        </h2>
        {professor ? (
          <div className="text-sm">
            <p className="font-medium text-gray-900 dark:text-white">
              {professor.name}
            </p>
            <p className="text-zinc-500">{professor.email}</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            This course has no professor assigned yet.
          </p>
        )}
      </section>

      {/* Roster */}
      <section className="mb-6 rounded border p-5 bg-white dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Enrolled students ({roster.length})
        </h2>

        {roster.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No students are enrolled in this course yet.
          </p>
        ) : (
          <ul className="divide-y">
            {roster.map((student) => (
              <li
                key={student.uid}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900 dark:text-white">
                    {student.name}
                  </p>
                  <p className="truncate text-zinc-500">{student.email}</p>
                </div>
                <button
                  onClick={() => void handleUnenroll(student.uid)}
                  disabled={busyUid === student.uid}
                  className="shrink-0 rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  {busyUid === student.uid ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={handleEnroll}
          className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-zinc-500">Add a student</span>
            <select
              value={selectedStudent}
              onChange={(e) => setSelectedStudent(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a student...</option>
              {students
                .filter((s) => !roster.some((r) => r.uid === s.uid))
                .map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name} ({s.email})
                  </option>
                ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={enrolling || !selectedStudent}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enrolling ? "Enrolling..." : "Enroll"}
          </button>
        </form>
      </section>

      {/* Delete course */}
      <section className="rounded border border-red-200 p-5 bg-white dark:border-red-900 dark:bg-gray-800">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">
          Danger zone
        </h2>
        {!confirmingDelete ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              Deleting this course removes it for everyone, including the
              roster, assignments, and submissions.
            </p>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="shrink-0 rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
            >
              Delete course
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-900 dark:text-white">
              Delete <span className="font-semibold">{klass.courseCode} {klass.name}</span>?
              This can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Confirm delete"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
