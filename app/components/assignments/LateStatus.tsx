"use client";

import { useState, type FormEvent } from "react";
import { formatTimestamp } from "@/lib/assignmentDeadline";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { latenessLabel, type LateExcused, type Lateness } from "@/lib/lateness";

type Props = {
  classId: string;
  assignmentId: string;
  studentId: string;
  /** The submittedAt of the version on the card. */
  submittedAt: string;
  /** The version's lateness from the professor's list. Falls back to `isLate` when absent. */
  lateness?: Lateness;
  isLate?: boolean;
  /** Whether the viewer can excuse lateness: the class's professor. */
  canExcuse: boolean;
};

const MAX_REASON_LENGTH = 500;

const penaltyBadge = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
const noPenaltyBadge = "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * Shows a submission's lateness on the professor's card (PANEL-115): a badge
 * like "Late", "Late (excused)" or "Late (updated instructions)", and for the
 * professor, a way to excuse the lateness with a reason or remove the excuse.
 * Excusing lifts the late penalty; it never changes what was recorded as late.
 */
export default function LateStatus({
  classId,
  assignmentId,
  studentId,
  submittedAt,
  lateness: initial,
  isLate,
  canExcuse,
}: Props) {
  const [lateness, setLateness] = useState<Lateness | null>(
    initial ??
      (isLate
        ? { late: true, excused: null, newerInstructions: false, firstOnTime: null, penalty: true }
        : null)
  );
  const [mode, setMode] = useState<"view" | "excuse">("view");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!lateness?.late) return null;

  const route = `/api/classes/${classId}/assignments/${assignmentId}/submissions/${studentId}/late-excuse`;

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("Please sign in again.");

    const response = await fetch(route, {
      method,
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");

    return data as { lateExcused: LateExcused | null };
  }

  async function handleExcuse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lateness) return;

    if (!reason.trim()) {
      setError("Give a reason for excusing the lateness.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { lateExcused } = await send("PUT", { reason: reason.trim(), submittedAt });
      setLateness({ ...lateness, excused: lateExcused, penalty: false });
      setMode("view");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!lateness) return;
    setBusy(true);
    setError("");

    try {
      await send("DELETE");
      setLateness({ ...lateness, excused: null, penalty: !lateness.newerInstructions });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            lateness.penalty ? penaltyBadge : noPenaltyBadge
          }`}
        >
          {latenessLabel(lateness)}
        </span>

        {canExcuse && mode === "view" && !lateness.excused && (
          <button
            type="button"
            onClick={() => setMode("excuse")}
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Excuse lateness
          </button>
        )}

        {canExcuse && lateness.excused && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-red-600 hover:text-red-500 disabled:opacity-60"
          >
            {busy ? "Removing..." : "Remove excuse"}
          </button>
        )}
      </div>

      {lateness.excused && (
        <p className="text-gray-600 dark:text-zinc-300">
          Lateness excused {formatTimestamp(lateness.excused.at)}: {lateness.excused.reason}
        </p>
      )}

      {lateness.newerInstructions && !lateness.excused && (
        <p className="text-gray-600 dark:text-zinc-300">
          This version answered updated instructions, so no late penalty applies.
        </p>
      )}

      {mode === "excuse" && (
        <form onSubmit={handleExcuse} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-gray-700 dark:text-gray-300">
            Reason for excusing
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={MAX_REASON_LENGTH}
              rows={2}
              placeholder="e.g. Doctor's note"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </label>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Lifts the late penalty for this version. It stays recorded as late.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save excuse"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("view");
                setError("");
              }}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
