"use client";

import { useState, type FormEvent } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import type { Grade } from "../Types";

type GradeFormProps = {
  classId: string;
  assignmentId: string;
  /** The student's uid, which is also their submission's id. */
  studentId: string;
  points: number;
  /** Receives the student's uid and the grade the server saved. */
  onSaved: (studentId: string, grade: Grade) => void;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

/** Score and feedback form for an ungraded submission. */
export default function GradeForm({
  classId,
  assignmentId,
  studentId,
  points,
  onSaved,
}: GradeFormProps) {
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const scoreValue = Number(score);

    if (
      score.trim() === "" ||
      !Number.isFinite(scoreValue) ||
      scoreValue < 0 ||
      scoreValue > points
    ) {
      setError(`Score must be a number from 0 to ${points}.`);
      return;
    }

    const user = getFirebaseAuth().currentUser;

    if (!user) {
      setError("Please sign in again.");
      return;
    }

    setBusy(true);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/classes/${classId}/assignments/${assignmentId}/submissions/${studentId}/grade`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ score: scoreValue, feedback: feedback.trim() }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save grade.");
      }

      onSaved(studentId, data.grade);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Score
        <span className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max={points}
            step="any"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className={`${inputClass} w-28`}
            required
          />
          <span className="text-gray-500 dark:text-zinc-400">/ {points}</span>
        </span>
      </label>

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

      <div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save grade"}
        </button>
      </div>
    </form>
  );
}
