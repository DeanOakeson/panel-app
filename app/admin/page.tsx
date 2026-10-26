import Link from "next/link";

type CourseRow = {
  id: string;
  name: string;
  professor: string | null;
  studentCount: number;
};

// Placeholder data until user and course records come from Firestore
const counts = { students: 0, professors: 0, courses: 0 };

const courses: CourseRow[] = [
  { id: "cs6300", name: "CS 6300 Software Engineering Leadership", professor: null, studentCount: 0 },
];

const tiles = [
  { label: "Students", count: counts.students, action: "View all students" },
  { label: "Professors", count: counts.professors, action: "View all professors" },
  { label: "Courses", count: counts.courses, action: "View all courses" },
];

export default function AdminHome() {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 inline-block rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-blue-300">
            ADMIN
          </p>
          <h1 className="text-3xl font-bold">Admin panel</h1>
          <p className="text-sm text-zinc-400">
            Manage users, courses, and enrollment for the school.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/students"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Student Directory
          </Link>
	  <Link href="/admin/professors"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Professor requests
          </Link>
          <Link href="/admin/create-user"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Create user
          </Link>
          <Link href="/admin/create-course"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
            Create course
          </Link>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-2 rounded-xl border border-zinc-800 p-5">
            <span className="text-sm text-zinc-400">{t.label}</span>
            <span className="text-3xl font-bold">{t.count}</span>
            <span className="text-sm text-zinc-500">{t.action} · coming soon</span>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-xl font-semibold">Courses</h2>
      {courses.length === 0 ? (
        <p className="text-zinc-400">No courses yet. Create one to get started.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Course</th>
                <th className="px-4 py-3 font-semibold">Professor</th>
                <th className="px-4 py-3 font-semibold">Students</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3">{c.professor ?? <span className="text-zinc-500">Unassigned</span>}</td>
                  <td className="px-4 py-3">{c.studentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
