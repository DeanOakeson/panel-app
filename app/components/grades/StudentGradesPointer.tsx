import Link from "next/link";

/** Tells a student where their grades are, with a link to the course's assignments. */
export default function StudentGradesPointer({ classId }: { classId: string }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <p className="font-medium text-gray-900 dark:text-white">
                Your grades and feedback are on each assignment&apos;s page.
            </p>

            <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">
                Open an assignment to see your score and your professor&apos;s comments.
            </p>

            <Link
                href={`/classes/${classId}/assignments`}
                className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
                Go to assignments
            </Link>
        </div>
    );
}
