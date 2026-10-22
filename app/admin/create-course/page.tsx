"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Professor = { uid: string; name: string; email: string };

const TERMS = ["Spring", "Summer", "Fall", "Winter"];

export default function CreateCoursePage() {
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [loadingProfessors, setLoadingProfessors] = useState(true);

  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState("Fall");
  const [section, setSection] = useState("001");
  const [professorId, setProfessorId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load the professors the admin can assign.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/admin/users?role=professor", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load professors.");
        setProfessors(data.users ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load professors.");
      } finally {
        setLoadingProfessors(false);
      }
    });
    return unsubscribe;
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const parsedYear = Number(year);

    if (!name.trim() || !courseCode.trim() || !section.trim()) {
      setError("Course name, course code, and section are required.");
      return;
    }
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setError("Enter a valid year between 2000 and 2100.");
      return;
    }
    if (!professorId) {
      setError("Choose a professor for this course.");
      return;
    }

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setError("You must be signed in.");
      return;
    }

    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/classes", {
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
          professorId,
        }),
      });

      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }

      const professor = professors.find((p) => p.uid === professorId);
      setSuccess(
        `Created ${courseCode.trim()} ${name.trim()} (${term} ${parsedYear}, section ${section.trim()}), ` +
          `taught by ${professor?.name || professor?.email || "the selected professor"}.`
      );
      setName("");
      setCourseCode("");
      setSection("001");
      setProfessorId("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "rounded border px-3 py-2 bg-transparent text-black dark:text-white dark:border-gray-600";

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400">
        ← Back to admin panel
      </Link>
      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Admin
      </p>
      <h1 className="text-2xl font-bold">Create course</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-500">
        Create a course and assign the professor who teaches it.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded border p-5 bg-white dark:bg-gray-800"
      >
        <label className="flex flex-col gap-1">
          Course name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
            required
            placeholder="Software Engineering Leadership"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          Course code
          <input
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            maxLength={30}
            required
            placeholder="CS 6300"
            className={inputClass}
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            Term
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className={`${inputClass} dark:bg-gray-800`}
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Year
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
              className={`${inputClass} w-28`}
            />
          </label>

          <label className="flex flex-col gap-1">
            Section
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              maxLength={20}
              required
              className={`${inputClass} w-28`}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          Professor
          <select
            value={professorId}
            onChange={(e) => setProfessorId(e.target.value)}
            disabled={loadingProfessors}
            required
            className={`${inputClass} dark:bg-gray-800`}
          >
            <option value="">
              {loadingProfessors
                ? "Loading professors..."
                : professors.length === 0
                  ? "No professors yet. Create one first."
                  : "Choose a professor"}
            </option>
            {professors.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.name ? `${p.name} (${p.email})` : p.email}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}

        <button
          type="submit"
          disabled={submitting || loadingProfessors}
          className="mt-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create course"}
        </button>
      </form>
    </main>
  );
}
