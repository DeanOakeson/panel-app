"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type ProfessorRequest = {
  uid: string;
  name: string;
  email: string;
  role: string;
  professorStatus: string;
};

export default function AdminProfessorsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<ProfessorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const user = getFirebaseAuth().currentUser;

      if (!user) {
        setError("Please sign in as an administrator.");
        return;
      }

      const token = await user.getIdToken();

      const response = await fetch("/api/admin/professors", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load professor requests.");
      }

      setRequests(result.requests ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      void loadRequests();
    });

    return unsubscribe;
  }, [loadRequests, router]);

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await signOut(getFirebaseAuth());
      router.replace("/");
    } catch {
      setError("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  }

  async function updateRequest(
    uid: string,
    action: "approve" | "reject"
  ) {
    setProcessingUid(uid);
    setError("");
    setMessage("");

    try {
      const user = getFirebaseAuth().currentUser;

      if (!user) {
        throw new Error("Please sign in again.");
      }

      const token = await user.getIdToken();

      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid, action }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to ${action} request.`);
      }

      setRequests((current) =>
        current.filter((request) => request.uid !== uid)
      );

      setMessage(
        action === "approve"
          ? "Professor approved successfully."
          : "Professor request rejected."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setProcessingUid(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10 dark:bg-gray-900">
      <main className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-black dark:text-white">
              Professor Approvals
            </h1>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Review and manage professor registration requests.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => void loadRequests()}
              disabled={loading}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-black hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
            >
              Refresh
            </button>

            <button
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded border border-red-200 bg-white p-4 text-sm text-red-600 dark:border-red-900 dark:bg-gray-800 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {message && (
          <div className="mb-5 rounded border border-green-200 bg-white p-4 text-sm text-green-700 dark:border-green-900 dark:bg-gray-800 dark:text-green-400">
            {message}
          </div>
        )}

        <section className="overflow-hidden rounded bg-white shadow-md dark:bg-gray-800">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <h2 className="font-semibold text-black dark:text-white">
              Pending Requests
            </h2>
          </div>

          {loading ? (
            <p className="p-8 text-center text-gray-600 dark:text-gray-400">
              Loading requests...
            </p>
          ) : requests.length === 0 ? (
            <p className="p-8 text-center text-gray-600 dark:text-gray-400">
              No pending professor requests.
            </p>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {requests.map((request) => (
                <div
                  key={request.uid}
                  className="flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <h3 className="font-medium text-black dark:text-white">
                      {request.name || "Unnamed user"}
                    </h3>
                    <p className="mt-1 break-all text-sm text-gray-700 dark:text-gray-300">
                      {request.email}
                    </p>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Status: {request.professorStatus}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() =>
                        void updateRequest(request.uid, "approve")
                      }
                      disabled={processingUid !== null}
                      className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {processingUid === request.uid
                        ? "Processing..."
                        : "Approve"}
                    </button>

                    <button
                      onClick={() =>
                        void updateRequest(request.uid, "reject")
                      }
                      disabled={processingUid !== null}
                      className="rounded border border-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}