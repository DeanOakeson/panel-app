"use client";

import { useState, type FormEvent } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import type { MissingGrade } from "../Types";

type MissingWorkFormProps = {
  classId: string;
  assignmentId: string;
  studentId: string;
  points: number;
  /** The grade being edited. Without it the form marks the work missing. */
  editing?: {
    feedback: string;
    /** The grade's updatedAt, or its gradedAt when never edited. */
    lastSavedAt: string;
  };
  /**
   * Receives the student's uid, the stored missing-work grade, and whether
   * another session had saved one first.
   */
  onSaved: (studentId: string, grade: MissingGrade, alreadyGraded: boolean) => void;
  onCancel: () => void;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

/**
 * Feedback form that records a missing-work grade of 0, or edits that grade's
 * feedback. It has no score input.
 */
export default function MissingWorkForm({
  classId,
  assignmentId,
  studentId,
  points,
  editing,
  onSaved,
  onCancel,
}: MissingWorkFormProps) {
  const [feedback, setFeedback] = useState(editing?.feedback ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
        `/api/classes/${classId}/assignments/${assignmentId}/missing-grades/${studentId}`,
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            feedback: feedback.trim(),
            ...(editing && { lastSavedAt: editing.lastSavedAt }),
          }),
        }
      );

      const data = await response.json();

      if (response.status === 409 && data.grade) {
        onSaved(studentId, data.grade, true);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to save the missing-work grade.");
      }

      onSaved(studentId, data.grade, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {!editing && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {`Records 0 / ${points} as a missing-work grade.`}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Feedback (optional)
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          maxLength={5000}
          rows={3}
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
          {busy ? "Saving..." : editing ? "Save feedback" : "Mark missing"}
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
