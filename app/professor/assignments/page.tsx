"use client";

import { useState, type FormEvent } from "react";

type Assignment = {
  id: string;
  name: string;
  points: number;
  dueDate: string;
};

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [name, setName] = useState("");
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
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

    setAssignments([
      ...assignments,
      { id: crypto.randomUUID(), name: name.trim(), points: pointValue, dueDate },
    ]);
    setName("");
    setPoints("");
    setDueDate("");
    setError("");
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Assignments</h1>
      <p className="mb-6 text-sm text-zinc-500">Course: CS 6300 (placeholder)</p>

      <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-4 rounded border p-4">
        <label className="flex flex-col gap-1">
          Assignment name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          Points possible
          <input
            type="number"
            min="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          Due date (optional)
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">
          Create assignment
        </button>
      </form>

      <h2 className="mb-2 text-xl font-semibold">Current assignments</h2>
      {assignments.length === 0 ? (
        <p className="text-zinc-500">No assignments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => (
            <li key={a.id} className="rounded border p-3">
              <span className="font-medium">{a.name}</span> · {a.points} pts ·{" "}
              {a.dueDate || "No due date"}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
