
import Link from "next/link";
import type { ClassItem } from "../Types";


type StudentClassesProps = {
  classes: ClassItem[];
};

export default function StudentClasses({
  classes,
}: StudentClassesProps) {
  if (classes.length === 0) {
    return (
      <p className="text-gray-500 dark:text-zinc-400">
        {"You haven't joined any classes yet."}
      </p>
    );
  }
  return (
    <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((classItem) => (
        <Link
          key={classItem.id}
          href={`/classes/${classItem.id}`}
          className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-gray-900"
        >
          <div>
            <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-300">
              {classItem.courseCode || "COURSE"}
            </p>

            <h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              {classItem.name || "Untitled Class"}
            </h2>
          </div>

          <span className="mt-auto text-sm font-semibold text-blue-600 dark:text-blue-400">
            View class →
          </span>
        </Link>
      ))}
    </section>
  );
}
