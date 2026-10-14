
import Link from "next/link";
import type { ClassItem } from "../Types";

type ProfessorClassesProps = {
  classes: ClassItem[];
};

export default function ProfessorClasses({
  classes,
}: ProfessorClassesProps) {
  if (classes.length === 0) {
    return (
      <p className="text-gray-500 dark:text-zinc-400">
        You have no courses assigned yet.
      </p>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((classItem) => (
        <article
          key={classItem.id}
          className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-gray-900"
        >
          <div>
            <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-300">
              {classItem.courseCode || "COURSE"}
            </p>

            <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              {classItem.name || "Untitled Class"}
            </h2>

            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
              {classItem.year && classItem.term
                ? `${classItem.term} ${classItem.year}`
                : ""}
              {classItem.section
                ? ` · Section ${classItem.section}`
                : ""}
            </p>
          </div>

          <nav className="flex flex-col gap-3 text-sm">
            <Link
              href={`/classes/${classItem.id}`}
              className="font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View class →
            </Link>

            <Link
              href={`/classes/${classItem.id}/assignments`}
              className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Assignments
            </Link>
          </nav>

          <div className="mt-auto pt-2">
            <Link
              href={`/classes/${classItem.id}/assignments`}
              className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Create assignment
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
