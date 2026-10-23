"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getFirebaseAuth } from "@/lib/firebaseClient";

export type Assignment = {
  id: string;
  name: string;
  description?: string;
  points: number;
  dueDate: string | null;
};

type AssignmentItemProps = {
  classId: string;
  assignment: Assignment;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

export default function AssignmentItem({
  classId,
  assignment: a,
  canEdit,
  onChanged,
}: AssignmentItemProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? "");
  const [points, setPoints] = useState(String(a.points));
  const [dueDate, setDueDate] = useState(a.dueDate ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(method: "PATCH" | "DELETE", body?: unknown) {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("Please sign in again.");

    const token = await user.getIdToken();
    const response = await fetch(
      `/api/classes/${classId}/assignments/${a.id}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }
  }

  function startEdit() {
    setName(a.name);
    setDescription(a.description ?? "");
    setPoints(String(a.points));
    setDueDate(a.dueDate ?? "");
    setError("");
    setMode("edit");
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pointValue = Number(points);

    if (!name.trim()) {
      setError("Assignment name is required.");
      return;
    }
    if (!Number.isFinite(pointValue) || pointValue <= 0) {
      setError("Points must be a number greater than 0.");
      return;
    }

    // Send only the fields that changed, so two people editing different
    // fields of the same assignment don't overwrite each other's work.
    const changes: Record<string, string | number> = {};
    if (name.trim() !== a.name) changes.name = name.trim();
    if (description.trim() !== (a.description ?? ""))
      changes.description = description.trim();
    if (pointValue !== a.points) changes.points = pointValue;
    if (dueDate !== (a.dueDate ?? "")) changes.dueDate = dueDate;

    if (Object.keys(changes).length === 0) {
      setMode("view");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await send("PATCH", changes);
      setMode("view");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await send("DELETE");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMode("view");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "edit") {
    return (
      <li className="rounded-lg border border-blue-300 bg-white p-4 dark:border-blue-800 dark:bg-gray-900">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Assignment name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={150}
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Description (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={4}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
              Points possible
              <input
                type="number"
                min="1"
                step="1"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
              Due date (optional)
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={busy}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-gray-900 dark:text-white">
          {a.name}
        </span>
        <span className="text-sm text-gray-500 dark:text-zinc-400">
          {a.points} pts · {a.dueDate ? `Due ${a.dueDate}` : "No due date"}
        </span>
      </div>

      {a.description && (
        <p className="whitespace-pre-line text-sm text-gray-600 dark:text-zinc-300">
          {a.description}
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canEdit && mode === "view" && (
        <div className="flex gap-3 text-sm">
          <Link
            href={`/classes/${classId}/assignments/${a.id}/submissions`}
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Submissions
          </Link>
          <button
            type="button"
            onClick={startEdit}
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("confirm-delete")}
            className="text-red-600 hover:text-red-500"
          >
            Delete
          </button>
        </div>
      )}

      {canEdit && mode === "confirm-delete" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-700 dark:text-gray-300">
            Delete &quot;{a.name}&quot;? This can&apos;t be undone.
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
          >
            {busy ? "Deleting..." : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            disabled={busy}
            className="text-gray-600 hover:text-gray-800 dark:text-gray-400"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
