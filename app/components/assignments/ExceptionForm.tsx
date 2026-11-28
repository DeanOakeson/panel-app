"use client";

import { useId, useState, type FormEvent } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { MAX_EXCEPTION_REASON_LENGTH } from "@/lib/submissionException";
import type { SubmissionExceptionSummary } from "../Types";

type ExceptionFormProps = {
  classId: string;
  assignmentId: string;
  studentId: string;
  /** The exception being edited. Without it the form grants a new one. */
  editing?: SubmissionExceptionSummary | null;
  /**
   * Receives the student's uid, the stored exception, and whether it replaced
   * one the student already had.
   */
  onSaved: (
    studentId: string,
    exception: SubmissionExceptionSummary,
    replaced: boolean
  ) => void;
  onCancel: () => void;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

/**
 * Form that grants one student their own due date, optional late window and
 * resubmission setting on an assignment, or replaces the exception they have.
 */
export default function ExceptionForm({
  classId,
  assignmentId,
  studentId,
  editing,
  onSaved,
  onCancel,
}: ExceptionFormProps) {
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? "");
  const [lateUntil, setLateUntil] = useState(editing?.lateUntil ?? "");
  const [allowResubmit, setAllowResubmit] = useState(
    editing?.allowResubmit ?? false
  );
  const [reason, setReason] = useState(editing?.reason ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const resubmitHintId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const user = getFirebaseAuth().currentUser;

    if (!user) {
      setError("Please sign in again.");
      return;
    }

    setBusy(true);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/classes/${classId}/assignments/${assignmentId}/exceptions/${studentId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            dueDate,
            lateUntil: lateUntil || null,
            allowResubmit,
            reason: reason.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save the exception.");
      }

      onSaved(studentId, data.exception, response.status === 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
          Due date
          <input
            type="date"
            required
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
          Late until (optional)
          <input
            type="date"
            value={lateUntil}
            min={dueDate || undefined}
            onChange={(event) => setLateUntil(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={allowResubmit}
            onChange={(event) => setAllowResubmit(event.target.checked)}
            aria-describedby={resubmitHintId}
            className="h-4 w-4 rounded border-gray-300 dark:border-zinc-700"
          />
          Allow resubmission
        </label>

        <p
          id={resubmitHintId}
          className="mt-1 text-xs text-gray-500 dark:text-zinc-400"
        >
          Lets the student replace a submission they have already made.
          Without it, only a student who has not submitted can submit.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Reason (optional)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={MAX_EXCEPTION_REASON_LENGTH}
          rows={2}
          className={inputClass}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save exception"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
