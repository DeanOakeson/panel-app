
"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClassItem } from "../Types";
import CreateAssignment from "../assignments/CreateAssignment";

type ProfessorClassesProps = {
  classes: ClassItem[];
};

export default function ProfessorClasses({
  classes,
}: ProfessorClassesProps) {
  const [showFormFor, setShowFormFor] = useState<string | null>(null);

  const selectedClass = classes.find(
    (classItem) => classItem.id === showFormFor
  );

  if (classes.length === 0) {
    return (
      <p className="text-gray-500 dark:text-zinc-400">
        You have no courses assigned yet.
      </p>
    );
  }

  return (
    <>
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
              <button
                type="button"
                onClick={() => setShowFormFor(classItem.id)}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Create assignment
              </button>
            </div>
          </article>
        ))}
      </section>

      {selectedClass && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowFormFor(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-assignment-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-gray-900"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-zinc-800">
              <div>
                <h2
                  id="create-assignment-title"
                  className="text-lg font-bold text-gray-900 dark:text-white"
                >
                  Create assignment
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                  {selectedClass.name || "Untitled Class"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowFormFor(null)}
                aria-label="Close"
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-5">
              <CreateAssignment
                classId={selectedClass.id}
                onCreated={() => setShowFormFor(null)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
