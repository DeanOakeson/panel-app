"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

/** Mirrors the ClassSummary shape returned by GET /api/admin/summary. */
type CourseRow = {
  id: string;
  name: string;
  professor: { uid: string; name: string; email: string } | null;
  studentCount: number;
};

type Summary = {
  students: number;
  professors: number;
  courses: number;
  classes: CourseRow[];
};

type AdminTile = {
  label: string;
  count: number;
  action: string;
  href: string;
};

/**
 * The admin landing page: how big the school is, and every course with its
 * professor and enrolled-student count.
 *
 * Everything comes from GET /api/admin/summary — there are no placeholder
 * constants left to drift from reality. That route shares lib/adminClasses.ts
 * with GET /api/admin/classes, so a course here always reports what
 * /admin/classes reports for the same document. Data is fetched with the
 * signed-in admin's ID token, exactly like /admin/classes; the admin gate and
 * the shared header (Admin panel link, Log out) live in app/admin/layout.tsx.
 */
export default function AdminHome() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async (user: User) => {
    setLoading(true);
    setError("");

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/summary", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load dashboard data.");

      setSummary({
        students: data.students ?? 0,
        professors: data.professors ?? 0,
        courses: data.courses ?? 0,
        classes: data.classes ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void loadSummary(user);
    });
    return unsubscribe;
  }, [loadSummary]);

  function retry() {
    const user = getFirebaseAuth().currentUser;
    if (user) void loadSummary(user);
  }

  /**
   * The two user tiles link into the user list with the role filter already
   * applied: /admin/users reads `?role=` and preselects the matching tab, so
   * these are real links now rather than "coming soon" placeholders.
   */
  const tiles: AdminTile[] = summary
    ? [
        {
          label: "Students",
          count: summary.students,
          action: "View all students",
          href: "/admin/users?role=student",
        },
        {
          label: "Professors",
          count: summary.professors,
          action: "View all professors",
          href: "/admin/users?role=professor",
        },
        {
          label: "Courses",
          count: summary.courses,
          action: "View all courses",
          href: "/admin/classes",
        },
      ]
    : [];

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 inline-block rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-blue-300">
            ADMIN
          </p>
          <h1 className="text-3xl font-bold">Admin panel</h1>
          <p className="text-sm text-zinc-400">
            Manage users, courses, and enrollment for the school.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/classes"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            All courses
          </Link>
          <Link href="/admin/professors"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Professor requests
          </Link>
          <Link href="/admin/users"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            All users
          </Link>
          <Link href="/admin/create-user"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Create user
          </Link>
          <Link href="/admin/create-course"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Create course
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300"
        >
          {error}{" "}
          <button
            type="button"
            onClick={retry}
            className="font-semibold text-red-200 underline hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {loading && !summary ? (
          <p className="text-zinc-400">Loading dashboard data...</p>
        ) : (
          tiles.map((t) => (
            <div key={t.label} className="flex flex-col gap-2 rounded-xl border border-zinc-800 p-5">
              <span className="text-sm text-zinc-400">{t.label}</span>
              <span className="text-3xl font-bold">{t.count}</span>
              <Link href={t.href} className="text-sm font-semibold text-blue-400 hover:underline">
                {t.action}
              </Link>
            </div>
          ))
        )}
      </div>

      <h2 className="mb-3 text-xl font-semibold">Courses</h2>
      {loading && !summary ? (
        <p className="text-zinc-400">Loading courses...</p>
      ) : !summary || summary.classes.length === 0 ? (
        <p className="text-zinc-400">No courses yet. Create one to get started.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Course</th>
                <th className="px-4 py-3 font-semibold">Professor</th>
                <th className="px-4 py-3 font-semibold">Students</th>
              </tr>
            </thead>
            <tbody>
              {summary.classes.map((c) => (
                <tr key={c.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.professor?.name || <span className="text-zinc-500">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">{c.studentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
