
"use client";

import { useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type CreateAssignmentProps = {
  classId: string;
  onCreated: () => void | Promise<void>;
};

export default function CreateAssignment({
  classId,
  onCreated,
}: CreateAssignmentProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lateUntil, setLateUntil] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const pointValue = Number(points);

    if (!name.trim()) {
      setError("Assignment name is required.");
      return;
    }

    if (!Number.isFinite(pointValue) || pointValue <= 0) {
      setError("Points must be a number greater than 0.");
      return;
    }

    if (lateUntil && !dueDate) {
      setError("Set a due date before setting a late submission deadline.");
      return;
    }

    if (lateUntil && lateUntil <= dueDate) {
      setError("The late submission deadline must be after the due date.");
      return;
    }

    const user = getFirebaseAuth().currentUser;

    if (!user) {
      setError("Please sign in again.");
      return;
    }

    setLoading(true);

    try {
      const token = await user.getIdToken();

      const response = await fetch(
        `/api/classes/${classId}/assignments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            points: pointValue,
            dueDate: dueDate || null,
            lateUntil: lateUntil || null,
            isLocked,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create assignment.");
      }

      setName("");
      setDescription("");
      setPoints("");
      setDueDate("");
      setLateUntil("");
      setIsLocked(false);

      await onCreated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-gray-900"
    >
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
        Create assignment
      </h2>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Assignment name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={150}
          placeholder="e.g. Project 1"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Description (optional)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Instructions, requirements, or links for students"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Points possible
        <input
          type="number"
          min="1"
          step="1"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="100"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Due date (optional)
        <input
          type="date"
          value={dueDate}
          onChange={(e) => {
            setDueDate(e.target.value);

            if (lateUntil && e.target.value && lateUntil <= e.target.value) {
              setLateUntil("");
            }
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Late submission deadline (optional)
        <input
          type="date"
          value={lateUntil}
          min={dueDate ? dueDate : undefined}
          disabled={!dueDate}
          onChange={(e) => setLateUntil(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        <span className="text-xs text-gray-500 dark:text-zinc-400">
          Students can submit until 11:59 PM Mountain Time on this date.
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={isLocked}
          onChange={(e) => setIsLocked(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        Lock submissions immediately
      </label>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Creating..." : "Create assignment"}
      </button>
    </form>
  );
}
