"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Professor = { uid: string; name: string; email: string } | null;

type Student = { uid: string; name: string; email: string };

type ClassDetails = {
  id: string;
  name: string;
  courseCode: string;
  year: string;
  term: string;
  section: string;
  professor_id?: string;
};

type StudentOption = { uid: string; name: string; email: string };

export default function AdminClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [klass, setKlass] = useState<ClassDetails | null>(null);
  const [professor, setProfessor] = useState<Professor>(null);
  const [roster, setRoster] = useState<Student[]>([]);

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [professors, setProfessors] = useState<StudentOption[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [busyUid, setBusyUid] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Course metadata edit form. Mirrors the assignment edit pattern: the form
  // only mounts in edit mode, sends only the fields that changed, and stays
  // open with the error shown when the server rejects the payload.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    courseCode: "",
    year: "",
    term: "",
    section: "",
    professorId: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const startEdit = useCallback(() => {
    if (!klass) return;
    setForm({
      name: klass.name ?? "",
      courseCode: klass.courseCode ?? "",
      year: String(klass.year ?? ""),
      term: klass.term ?? "",
      section: klass.section ?? "",
      professorId: klass.professor_id ?? "",
    });
    setEditError("");
    setEditing(true);
  }, [klass]);

  function setField(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSaveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!klass) return;

    const yearValue = Number(form.year);
    if (!form.name.trim()) {
      setEditError("Course name is required.");
      return;
    }
    if (!form.courseCode.trim()) {
      setEditError("Course code is required.");
      return;
    }
    if (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
      setEditError("Year must be a number between 2000 and 2100.");
      return;
    }
    if (!form.section.trim()) {
      setEditError("Section is required.");
      return;
    }

    // Send only the fields that changed so concurrent edits don't clobber
    // each other, and so unchanged data keeps its stored type.
    const changes: Record<string, string | number> = {};
    if (form.name.trim() !== klass.name) changes.name = form.name.trim();
    if (form.courseCode.trim() !== klass.courseCode)
      changes.courseCode = form.courseCode.trim();
    if (yearValue !== Number(klass.year)) changes.year = yearValue;
    if (form.term !== klass.term) changes.term = form.term;
    if (form.section.trim() !== klass.section)
      changes.section = form.section.trim();
    if (form.professorId !== (klass.professor_id ?? ""))
      changes.professorId = form.professorId;

    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }

    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setSaving(true);
    setEditError("");
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/classes/${classId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        // Keep the form open with the admin's input intact, showing the
        // server's reason.
        setEditError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setEditing(false);
      setActionSuccess("Course updated.");
      await getDetails(token);
    } catch {
      setEditError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const getDetails = useCallback(
    async (token: string) => {
      const res = await fetch(`/api/admin/classes/${classId}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((data.error as string) || "Failed to load.");
      setKlass(data.class as ClassDetails);
      setProfessor(data.professor as Professor);
      setRoster((data.roster as Student[]) ?? []);
    },
    [classId]
  );

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError("");
      try {
        await getDetails(token);
        const studentsRes = await fetch("/api/admin/users?role=student", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const studentsData = await studentsRes.json().catch(() => ({}));
        if (studentsRes.ok) {
          setStudents((studentsData.users as StudentOption[]) ?? []);
        }
        // The edit form needs the same list for its professor dropdown.
        const professorsRes = await fetch("/api/admin/users?role=professor", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const professorsData = await professorsRes.json().catch(() => ({}));
        if (professorsRes.ok) {
          setProfessors((professorsData.users as StudentOption[]) ?? []);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load this course."
        );
      } finally {
        setLoading(false);
      }
    },
    [getDetails]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      void user.getIdToken().then((token) => void load(token));
    });
    return unsubscribe;
  }, [load, router]);

  async function handleEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setEnrolling(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/classes/${classId}/enrollments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ studentId: selectedStudent }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess("Student enrolled.");
      setSelectedStudent("");
      await getDetails(token);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleUnenroll(uid: string) {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setBusyUid(uid);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(
        `/api/admin/classes/${classId}/enrollments/${uid}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess("Student removed from the roster.");
      await getDetails(token);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setBusyUid("");
    }
  }

  async function handleDelete() {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    if (!token) return;
    setDeleting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/classes/${classId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setDeleting(false);
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      router.replace("/admin");
    } catch {
      setDeleting(false);
      setActionError("Something went wrong. Please try again.");
    }
  }

  const inputClass =
    "rounded border px-3 py-2 bg-transparent text-black dark:text-white dark:border-gray-600";

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <p className="text-sm text-zinc-500">Loading course...</p>
      </main>
    );
  }

  if (loadError || !klass) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <Link
          href="/admin"
          className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          ← Back to admin panel
        </Link>
        <p className="mt-4 text-sm text-red-600">
          {loadError || "Course not found."}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Link
        href="/admin"
        className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        ← Back to admin panel
      </Link>
      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Admin
      </p>
      <h1 className="text-2xl font-bold">
        {klass.courseCode} {klass.name}
      </h1>
      <p className="mb-6 mt-1 text-sm text-zinc-500">
        {klass.term} {klass.year}, section {klass.section}
        {professor ? ` · ${professor.name}` : " · No professor assigned"}
      </p>

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}
      {actionSuccess && (
        <p className="mb-4 text-sm text-green-600">{actionSuccess}</p>
      )}

      {/* Course details + edit form */}
      <section className="mb-6 rounded border p-5 bg-white dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Course details
          </h2>
          {!editing && (
            <button
              onClick={startEdit}
              className="rounded border border-blue-300 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950"
            >
              Edit course
            </button>
          )}
        </div>

        {!editing ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Name</dt>
              <dd className="text-gray-900 dark:text-white">{klass.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Course code</dt>
              <dd className="text-gray-900 dark:text-white">{klass.courseCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Term</dt>
              <dd className="text-gray-900 dark:text-white">
                {klass.term} {klass.year}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Section</dt>
              <dd className="text-gray-900 dark:text-white">{klass.section}</dd>
            </div>
          </dl>
        ) : (
          <form onSubmit={handleSaveEdit} className="flex flex-col gap-3">
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Course name
                <input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  maxLength={150}
                  className={inputClass}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Course code
                <input
                  value={form.courseCode}
                  onChange={(e) => setField("courseCode", e.target.value)}
                  maxLength={30}
                  className={inputClass}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Term
                <select
                  value={form.term}
                  onChange={(e) => setField("term", e.target.value)}
                  className={inputClass}
                >
                  {["Spring", "Summer", "Fall", "Winter"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Year
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={form.year}
                  onChange={(e) => setField("year", e.target.value)}
                  className={inputClass}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Section
                <input
                  value={form.section}
                  onChange={(e) => setField("section", e.target.value)}
                  maxLength={20}
                  className={inputClass}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
                Professor
                <select
                  value={form.professorId}
                  onChange={(e) => setField("professorId", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a professor...</option>
                  {professors.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.name} ({p.email})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Professor */}
      <section className="mb-6 rounded border p-5 bg-white dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Professor
        </h2>
        {professor ? (
          <div className="text-sm">
            <p className="font-medium text-gray-900 dark:text-white">
              {professor.name}
            </p>
            <p className="text-zinc-500">{professor.email}</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            This course has no professor assigned yet.
          </p>
        )}
      </section>

      {/* Roster */}
      <section className="mb-6 rounded border p-5 bg-white dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Enrolled students ({roster.length})
        </h2>

        {roster.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No students are enrolled in this course yet.
          </p>
        ) : (
          <ul className="divide-y">
            {roster.map((student) => (
              <li
                key={student.uid}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900 dark:text-white">
                    {student.name}
                  </p>
                  <p className="truncate text-zinc-500">{student.email}</p>
                </div>
                <button
                  onClick={() => void handleUnenroll(student.uid)}
                  disabled={busyUid === student.uid}
                  className="shrink-0 rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  {busyUid === student.uid ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={handleEnroll}
          className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-zinc-500">Add a student</span>
            <select
              value={selectedStudent}
              onChange={(e) => setSelectedStudent(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a student...</option>
              {students
                .filter((s) => !roster.some((r) => r.uid === s.uid))
                .map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name} ({s.email})
                  </option>
                ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={enrolling || !selectedStudent}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enrolling ? "Enrolling..." : "Enroll"}
          </button>
        </form>
      </section>

      {/* Delete course */}
      <section className="rounded border border-red-200 p-5 bg-white dark:border-red-900 dark:bg-gray-800">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">
          Danger zone
        </h2>
        {!confirmingDelete ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              Deleting this course removes it for everyone, including the
              roster, assignments, and submissions.
            </p>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="shrink-0 rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
            >
              Delete course
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-900 dark:text-white">
              Delete <span className="font-semibold">{klass.courseCode} {klass.name}</span>?
              This can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Confirm delete"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
