import Link from "next/link";

type Course = {
  id: string;
  code: string;
  title: string;
  studentCount: number;
  toGrade: number;
};

// Placeholder data until roles and Firestore courses are in place
const courses: Course[] = [
  { id: "cs6300", code: "CS 6300", title: "Software Engineering Leadership", studentCount: 0, toGrade: 0 },
  { id: "placeholder-1", code: "CS 0000", title: "Placeholder course", studentCount: 0, toGrade: 0 },
];

export default function ProfessorHome() {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <h1 className="text-3xl font-bold">Your courses</h1>
      <p className="mb-8 text-sm text-zinc-400">
        Courses assigned to you by the administrator.
      </p>

      {courses.length === 0 ? (
        <p className="text-zinc-400">You have no courses assigned yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <article key={c.id} className="flex flex-col gap-4 rounded-xl border border-zinc-800 p-5">
              <div>
                <p className="text-xs font-semibold tracking-wide text-blue-300">{c.code}</p>
                <h2 className="text-lg font-bold">{c.title}</h2>
                <p className="text-sm text-zinc-400">{c.studentCount} students enrolled</p>
              </div>
              <nav className="flex flex-col gap-2 text-sm">
                <Link href="/professor/assignments" className="text-blue-400 hover:text-blue-300">
                  Assignments
                </Link>
                <span className="text-zinc-500">Submissions to grade ({c.toGrade}) · coming soon</span>
                <span className="text-zinc-500">Gradebook · coming soon</span>
              </nav>
              <Link
                href="/professor/assignments"
                className="self-start rounded bg-blue-600 px-4 py-2 font-semibold text-white"
              >
                Create assignment
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
