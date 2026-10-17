
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
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");
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
            points: pointValue,
            dueDate,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create assignment.");
      }

      setName("");
      setPoints("");
      setDueDate("");

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
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
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
