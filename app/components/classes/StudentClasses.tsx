
import Link from "next/link";
import type { ClassItem } from "../Types";

// Sample courses until enrollment data is available.
const sampleCourses: ClassItem[] = [
  { id: "sample-1", courseCode: "CS 101", name: "Introduction to Programming" },
  { id: "sample-2", courseCode: "CS 201", name: "Data Structures" },
  { id: "sample-3", courseCode: "MATH 210", name: "Discrete Mathematics" },
];

// Sample assignments until assignment data is integrated.
const sampleAssignments = [
  { id: 1, course: "CS 101", title: "Programming Exercise 3", due: "Oct 22, 2026" },
  { id: 2, course: "CS 201", title: "Binary Search Trees", due: "Oct 24, 2026" },
  { id: 3, course: "MATH 210", title: "Logic Homework", due: "Oct 26, 2026" },
];

type StudentClassesProps = {
  classes: ClassItem[];
};

export default function StudentClasses({ classes }: StudentClassesProps) {
  const showingSamples = classes.length === 0;
  const displayedCourses = showingSamples ? sampleCourses : classes;

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">
          My Courses
        </h2>

        {showingSamples && (
          <p className="mb-4 text-sm text-gray-500 dark:text-zinc-400">
            Sample courses for demonstration. You are not enrolled in these courses.
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedCourses.map((course) => (
            <article
              key={course.id}
              className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-gray-900"
            >
              <div>
                <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-300">
                  {course.courseCode || "COURSE"}
                </p>
                <h3 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                  {course.name || "Untitled Class"}
                </h3>
              </div>

              {showingSamples ? (
                <span className="mt-auto text-sm text-gray-500 dark:text-zinc-400">
                  Course link available after enrollment
                </span>
              ) : (
                <Link
                  href={`/classes/${course.id}`}
                  className="mt-auto text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  View class →
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
          Upcoming Assignments
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-zinc-400">
          Sample assignment deadlines. Live assignment integration is pending.
        </p>

        <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-zinc-800 dark:bg-gray-900">
          {sampleAssignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-5 last:border-b-0 dark:border-zinc-800"
            >
              <div>
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-300">
                  {assignment.course}
                </p>
                <h3 className="mt-1 font-semibold text-gray-900 dark:text-white">
                  {assignment.title}
                </h3>
              </div>
              <span className="text-sm text-gray-500 dark:text-zinc-400">
                Due {assignment.due}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
