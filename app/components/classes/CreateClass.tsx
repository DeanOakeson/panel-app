
"use client";

import { useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type CreateClassProps = {
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
};

export default function CreateClass({
  onCreated,
  onCancel,
}: CreateClassProps) {
  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState("Fall");
  const [section, setSection] = useState("001");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const user = getFirebaseAuth().currentUser;

    if (!user) {
      setError("Please sign in again.");
      return;
    }

    const parsedYear = Number(year);

    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < 2000 ||
      parsedYear > 2100
    ) {
      setError("Enter a valid year between 2000 and 2100.");
      return;
    }

    try {
      setSaving(true);

      const token = await user.getIdToken();

      const response = await fetch("/api/classes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          courseCode: courseCode.trim(),
          year: parsedYear,
          term,
          section: section.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create class.");
      }

      await onCreated();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:text-white";

  const labelClass =
    "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 max-w-xl space-y-4 rounded-xl border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900"
    >
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
        Create a class
      </h2>

      <div>
        <label htmlFor="courseCode" className={labelClass}>
          Course code
        </label>
        <input
          id="courseCode"
          value={courseCode}
          onChange={(e) => setCourseCode(e.target.value)}
          placeholder="CS 6300"
          maxLength={30}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="courseName" className={labelClass}>
          Course name
        </label>
        <input
          id="courseName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Software Engineering Leadership"
          maxLength={150}
          required
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="year" className={labelClass}>
            Year
          </label>
          <input
            id="year"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="term" className={labelClass}>
            Term
          </label>
          <select
            id="term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            required
            className={`${inputClass} text-black`}>
                
            <option value="Spring" className="text-black">Spring</option>
            <option value="Summer" className="text-black">Summer</option>
            <option value="Fall" className="text-black">Fall</option>
            <option value="Winter" className="text-black">Winter</option>
          </select>
        </div>

        <div>
          <label htmlFor="section" className={labelClass}>
            Section
          </label>
          <input
            id="section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="001"
            maxLength={20}
            required
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create class"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-zinc-700 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
