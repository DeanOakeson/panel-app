
"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import CreateAssignment from "../../../components/assignments/CreateAssignment";

export default function AssignmentsPage() {
  const { classId } = useParams<{ classId: string }>();

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <Link
        href="/classes"
        className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        ← Back to classes
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
        Create assignment
      </h1>

      <p className="mb-6 mt-2 text-sm text-gray-500 dark:text-zinc-400">
        Create a new assignment for this class.
      </p>

      <CreateAssignment
        classId={classId}
        onCreated={() => {
          window.location.href = "/classes";
        }}
      />
    </main>
  );
}
