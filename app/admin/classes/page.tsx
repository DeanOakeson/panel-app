"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

/** Mirrors the ClassSummary shape returned by GET /api/admin/classes. */
type CourseRow = {
  id: string;
  name: string;
  courseCode: string;
  year: number | null;
  term: string;
  section: string;
  professor: { uid: string; name: string; email: string } | null;
  studentCount: number;
};

/**
 * Read-only catalogue of every course: who teaches it and how many students are
 * enrolled. One action per row — open the course detail page, which holds the
 * roster and (END-19/END-20) the edit and delete controls.
 *
 * All data comes from /api/admin/classes; the page never reads Firestore. The
 * admin gate itself lives in app/admin/layout.tsx.
 */
export default function AdminCoursesPage() {
  const [classes, setClasses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClasses = useCallback(async (user: User) => {
    setLoading(true);
    setError("");

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/classes", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load courses.");

      setClasses(data.classes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load courses.");
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void loadClasses(user);
    });
    return unsubscribe;
  }, [loadClasses]);

  function retry() {
    const user = getFirebaseAuth().currentUser;
    if (user) void loadClasses(user);
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 inline-block rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-blue-300">
            ADMIN
          </p>
          <h1 className="text-3xl font-bold">All courses</h1>
          <p className="text-sm text-zinc-400">
            Every course in the school with its professor and enrolled student
            count. Open a course to see who is enrolled.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={retry}
            disabled={loading}
            className="rounded border border-zinc-700 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
          <Link
            href="/admin/create-course"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
          >
            Create course
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Course</th>
              <th className="px-4 py-3 font-semibold">Professor</th>
              <th className="px-4 py-3 font-semibold">Students</th>
              <th className="px-4 py-3 font-semibold">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  Loading courses...
                </td>
              </tr>
            ) : classes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  No courses yet.{" "}
                  <Link
                    href="/admin/create-course"
                    className="font-semibold text-blue-400 hover:underline"
                  >
                    Create one
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              classes.map((course) => (
                <tr key={course.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-zinc-100">
                      {course.courseCode || "—"}
                    </span>{" "}
                    <span className="text-zinc-300">{course.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {[course.term, course.year, course.section].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {course.professor ? (
                      course.professor.name || course.professor.email
                    ) : (
                      <span className="text-zinc-500">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{course.studentCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/classes/${course.id}`}
                      className="font-semibold text-blue-400 hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
