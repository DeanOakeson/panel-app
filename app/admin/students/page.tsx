"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Course = {
  id: string;
  name?: string;
  courseCode?: string;
  term?: string;
  year?: number;
  section?: string;
};

type Student = {
  uid: string;
  name: string;
  email: string;
  courses: Course[];
};

export default function AdminStudentsPage() {
  const router = useRouter();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const user = getFirebaseAuth().currentUser;

      if (!user) {
        setError("Please sign in as an administrator.");
        return;
      }

      const token = await user.getIdToken();

      const response = await fetch("/api/admin/students", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load students.");
      }

      setStudents(result.students ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      void loadStudents();
    });

    return unsubscribe;
  }, [loadStudents, router]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return students;

    return students.filter((student) => {
      const studentDetails =
        `${student.name} ${student.email} ${student.uid}`.toLowerCase();

      const courseDetails = student.courses
        .map(
          (course) =>
            `${course.name ?? ""} ${course.courseCode ?? ""} ${
              course.term ?? ""
            } ${course.year ?? ""} ${course.section ?? ""}`
        )
        .join(" ")
        .toLowerCase();

      return (
        studentDetails.includes(query) ||
        courseDetails.includes(query)
      );
    });
  }, [students, search]);

  async function handleLogout() {
    setLoggingOut(true);
    setError("");

    try {
      await signOut(getFirebaseAuth());
      router.replace("/");
    } catch {
      setError("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-8 text-gray-900 dark:bg-gray-950 dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Link
              href="/admin"
              className="mb-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              &larr; Back to Admin Dashboard
            </Link>

            <h1 className="text-3xl font-bold">Student Directory</h1>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View students and the courses they are enrolled in.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadStudents()}
              disabled={loading}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
	      {loggingOut ? "Logging out..." : "Log out"}
        </button>
      </div>
    </header>

    {error && (
      <div
        role="alert"
        className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        <p className="font-semibold">Unable to load the student directory</p>
        <p className="mt-1">{error}</p>
        <button
          type="button"
          onClick={() => void loadStudents()}
          className="mt-3 font-semibold underline"
        >
          Try again
        </button>
      </div>
    )}

    <section className="mb-6 grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Total students
        </p>
        <p className="mt-2 text-3xl font-bold">
          {loading ? "—" : students.length}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Students with enrollments
        </p>
        <p className="mt-2 text-3xl font-bold">
          {loading
            ? "—"
            : students.filter((student) => student.courses.length > 0)
                .length}
        </p>
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-4 border-b border-gray-200 p-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">All Students</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {loading
              ? "Loading student records..."
              : `Showing ${filteredStudents.length} of ${students.length} students`}
          </p>
        </div>

        <label className="block w-full sm:max-w-sm">
          <span className="sr-only">Search students and courses</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or course..."
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:ring-blue-900"
          />
        </label>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-600 dark:text-gray-400">
          Loading students...
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="p-12 text-center">
          <p className="font-medium">
            {students.length === 0
              ? "No student accounts found."
              : "No students match your search."}
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {students.length === 0
              ? "Student accounts will appear here once they have been created."
              : "Try a different name, email address, or course."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <tr>
                <th scope="col" className="px-5 py-4 font-semibold">
                  Student
                </th>
                <th scope="col" className="px-5 py-4 font-semibold">
                  Email
                </th>
                <th scope="col" className="px-5 py-4 font-semibold">
                  Enrolled Courses
                </th>
                <th scope="col" className="px-5 py-4 font-semibold">
                  Course Details
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filteredStudents.map((student) => (
                <tr
                  key={student.uid}
                  className="align-top hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold">
                      {student.name || "Unnamed student"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      ID: {student.uid}
                    </p>
                  </td>

                  <td className="px-5 py-4">
                    {student.email ? (
                      <a
                        href={`mailto:${student.email}`}
                        className="break-all text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {student.email}
                      </a>
                    ) : (
                      <span className="text-gray-500">No email listed</span>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                      {student.courses.length}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    {student.courses.length === 0 ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        Not enrolled in any courses
                      </span>
                    ) : (
                      <ul className="space-y-3">
                        {student.courses.map((course) => (
                          <li key={course.id}>
                            <p className="font-medium">
                              {course.name || "Untitled course"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {[
                                course.courseCode,
                                course.term,
                                course.year,
                                course.section
                                  ? `Section ${course.section}`
                                  : "",
                              ]
                                .filter(
                                  (value) =>
                                    value !== undefined &&
                                    value !== null &&
                                    value !== ""
                                )
                                .join(" · ") || `Course ID: ${course.id}`}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </div>
</main>
);
}
