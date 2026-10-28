"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

/** Mirrors one row of GET /api/admin/requests (see lib/enrollmentRequests.ts). */
type EnrollmentRequest = {
  classId: string;
  courseCode: string;
  name: string;
  term: string;
  year: number | null;
  section: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  requestedAt: string;
};

/** Course column text: "CS 6300 · Software Engineering · Fall 2026 · Section 001". */
function courseLabel(request: EnrollmentRequest): string {
  return [
    request.courseCode || "COURSE",
    request.name || "Untitled course",
    [request.term, request.year].filter(Boolean).join(" "),
    request.section ? `Section ${request.section}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Course enrollment requests: who asked to join which course, with Approve and
 * Reject on each row (END-54).
 *
 * Before this page the admin enrollment view could only answer "who is
 * enrolled" — a student's request left no trace, because the student's click
 * wrote straight onto the roster. Requests now sit in this queue until an admin
 * decides, exactly like /admin/professors does for professor applications:
 * Approve enrolls the student and clears the request in one server-side
 * transaction; Reject clears the request without enrolling anyone.
 *
 * Every row carries its course, not just its student — a request row with no
 * course on it is the failure mode this ticket exists to prevent.
 *
 * Data comes from GET /api/admin/requests and decisions go to
 * PATCH /api/admin/requests/{classId}/{studentId}, both admin-gated by
 * lib/adminGuard.ts. The admin gate and the shared header (Admin panel link,
 * Log out) live in app/admin/layout.tsx, same as every other /admin page.
 */
export default function AdminEnrollmentRequestsPage() {
  const [requests, setRequests] = useState<EnrollmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const user = getFirebaseAuth().currentUser;
      if (!user) {
        setError("Please sign in as an administrator.");
        setLoading(false);
        return;
      }

      const token = await user.getIdToken();
      const res = await fetch("/api/admin/requests", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load enrollment requests.");

      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load enrollment requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void loadRequests();
    });
    return unsubscribe;
  }, [loadRequests]);

  /**
   * Approve or reject one request. The queue is refetched rather than patched
   * locally, so the row count and the roster on /admin/classes agree the moment
   * a decision lands.
   */
  async function decide(
    request: EnrollmentRequest,
    action: "approve" | "reject"
  ) {
    const key = `${request.classId}:${request.studentUid}`;
    if (busyKey) return;

    setBusyKey(key);
    setError("");
    setMessage("");

    try {
      const user = getFirebaseAuth().currentUser;
      if (!user) throw new Error("Please sign in again.");

      const token = await user.getIdToken();
      const res = await fetch(
        `/api/admin/requests/${encodeURIComponent(request.classId)}/${encodeURIComponent(
          request.studentUid
        )}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} the request.`);
      }

      setMessage(
        action === "approve"
          ? `Approved: ${request.studentName || "that student"} is enrolled in ${
              request.courseCode || request.name
            }.`
          : `Rejected the request for ${request.courseCode || request.name} — the student was not enrolled.`
      );

      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} the request.`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 inline-block rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-blue-300">
            ADMIN
          </p>
          <h1 className="text-3xl font-bold">Course enrollment requests</h1>
          <p className="text-sm text-zinc-400">
            Students ask to join a course; approving here is what puts them on
            the roster. Rejecting leaves the roster untouched.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin"
            className="rounded border border-zinc-300 px-4 py-2 font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Admin panel
          </Link>
          <button
            type="button"
            onClick={() => void loadRequests()}
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
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

      {message && (
        <div className="mb-6 rounded border border-green-900 bg-green-950/40 p-4 text-sm text-green-300">
          {message}
        </div>
      )}

      {loading && requests.length === 0 ? (
        <p className="text-zinc-400">Loading requests...</p>
      ) : requests.length === 0 ? (
        <p className="text-zinc-400">No pending enrollment requests.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Requested course</th>
                <th className="px-4 py-3 font-semibold">Requested</th>
                <th className="px-4 py-3 font-semibold">Decide</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const key = `${request.classId}:${request.studentUid}`;

                return (
                  <tr key={key} className="border-t border-zinc-800 align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">
                        {request.studentName || "Unnamed user"}
                      </p>
                      <p className="break-all text-zinc-400">{request.studentEmail}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{courseLabel(request)}</p>
                      <Link
                        href={`/admin/classes/${request.classId}`}
                        className="text-blue-400 hover:underline"
                      >
                        Open course
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {request.requestedAt
                        ? new Date(request.requestedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void decide(request, "approve")}
                          disabled={busyKey !== null}
                          className="rounded bg-green-700 px-3 py-1.5 font-semibold text-white hover:bg-green-600 disabled:opacity-50"
                        >
                          {busyKey === key ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decide(request, "reject")}
                          disabled={busyKey !== null}
                          className="rounded border border-zinc-300 px-3 py-1.5 font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
