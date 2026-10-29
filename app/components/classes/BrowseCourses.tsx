"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type AvailableClass = {
  id: string;
  name: string;
  courseCode: string;
  term: string;
  year: number | null;
  section: string;
  professorName: string | null;
  enrolled: boolean;
  /**
   * True only for a request that is already in flight (END-54 leftovers).
   * Choosing Enroll writes the roster doc directly (PANEL-26), so new rows
   * never pass through this state.
   */
  requested: boolean;
};

type BrowseCoursesProps = {
  /** Called after an enroll succeeds so the page can refresh "My classes". */
  onEnrolled: () => void | Promise<void>;
};

export default function BrowseCourses({ onEnrolled }: BrowseCoursesProps) {
  const [classes, setClasses] = useState<AvailableClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async (user: User) => {
    setLoading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/classes/available", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load courses.");
      setClasses(data.classes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load courses.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void load(user);
    });
    return unsubscribe;
  }, [load]);

  function retry() {
    const user = getFirebaseAuth().currentUser;
    if (user) void load(user);
  }

  /**
   * Enrolls the signed-in student directly (PANEL-26): POST
   * /api/classes/{classId}/enroll writes the roster doc themselves and clears
   * any pending request for the course in the same step, so the row answers
   * `{enrolled:true}` (201) and My classes refreshes right away. An admin
   * approval can no longer be beat to the write, and the server's
   * `{enrolled:true, alreadyEnrolled:true}` for a repeat click keeps the row
   * settled instead of erroring.
   */
  async function enroll(classId: string) {
    if (enrollingId) return;

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setEnrollError({ id: classId, message: "Please sign in again." });
      return;
    }

    setEnrollingId(classId);
    setEnrollError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/classes/${classId}/enroll`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to enroll in the course.");

      setClasses((current) =>
        current.map((c) =>
          c.id === classId ? { ...c, enrolled: true, requested: false } : c
        )
      );
      await onEnrolled();
    } catch (err) {
      setEnrollError({
        id: classId,
        message: err instanceof Error ? err.message : "Failed to enroll in the course.",
      });
    } finally {
      setEnrollingId(null);
    }
  }

  /**
   * Clears the signed-in student's own pending request. DELETE
   * /api/classes/{classId}/enroll answers `{withdrawn:true}` (the row drops
   * back to the Enroll button), 404 when nothing is pending, and 409 when the
   * student is actually enrolled — leaving a course is the unenroll path, so
   * the server refuses it and the message is shown as-is. Withdraw is only
   * ever rendered for a pending request, never for an enrollment (the
   * `c.enrolled` branch wins above).
   */
  async function withdraw(classId: string) {
    if (withdrawingId) return;

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setEnrollError({ id: classId, message: "Please sign in again." });
      return;
    }

    setWithdrawingId(classId);
    setEnrollError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/classes/${classId}/enroll`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to withdraw the request.");

      setClasses((current) =>
        current.map((c) => (c.id === classId ? { ...c, requested: false } : c))
      );
    } catch (err) {
      setEnrollError({
        id: classId,
        message: err instanceof Error ? err.message : "Failed to withdraw the request.",
      });
    } finally {
      setWithdrawingId(null);
    }
  }

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((c) =>
      [c.courseCode, c.name, c.professorName ?? "", c.term]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [classes, search]);

  return (
    <section className="mt-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Browse courses
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
            Choosing Enroll adds the course to My classes right away. An
            administrator can still decide a request that was already waiting.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
          <span className="sr-only">Search courses</span>
          <input
            id="course-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, name, or professor"
            className="w-72 max-w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:text-white"
          />
        </label>
      </header>

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">Loading courses...</p>
      ) : error ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-red-600">
          {error}
          <button
            type="button"
            onClick={retry}
            className="font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Try again
          </button>
        </p>
      ) : classes.length === 0 ? (
        <p className="text-gray-500 dark:text-zinc-400">
          No courses have been created yet.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-gray-500 dark:text-zinc-400">
          No courses match &quot;{search.trim()}&quot;.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-gray-900">
          {visible.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-300">
                  {c.courseCode || "COURSE"}
                  {c.section ? ` · Section ${c.section}` : ""}
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {c.name || "Untitled course"}
                </p>
                <p className="text-sm text-gray-500 dark:text-zinc-400">
                  {[c.term && c.year ? `${c.term} ${c.year}` : c.term, c.professorName ?? "No professor assigned"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {enrollError?.id === c.id && (
                  <p className="mt-1 text-sm text-red-600">{enrollError.message}</p>
                )}
              </div>

              {c.enrolled ? (
                /* Only for an actual roster entry — a pending request must not
                   read as enrolled (END-54). */
                <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  Enrolled
                </span>
              ) : c.requested ? (
                /* A pending request only: the c.enrolled branch above owns
                   real roster entries, so Withdraw is never offered for an
                   enrollment -- leaving a course is the unenroll path. */
                <span className="flex items-center gap-2">
                  <span
                    className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title="An administrator still needs to approve this request."
                  >
                    Requested
                  </span>
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    Waiting for approval
                  </span>
                  <button
                    type="button"
                    onClick={() => void withdraw(c.id)}
                    disabled={withdrawingId !== null}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800"
                  >
                    {withdrawingId === c.id ? "Withdrawing..." : "Withdraw"}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void enroll(c.id)}
                  disabled={enrollingId !== null}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  {enrollingId === c.id ? "Enrolling..." : "Enroll"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
