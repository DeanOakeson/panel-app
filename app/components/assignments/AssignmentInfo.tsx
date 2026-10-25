import type { Assignment } from "../Types";

type Props = {
    assignment: Assignment;
};

export default function AssignmentInfo({ assignment }: Props) {
    return (
        <article className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {assignment.name}
            </h1>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500 dark:text-zinc-400">
                <span>{assignment.points} points</span>

                <span>
                    {assignment.dueDate
                        ? `Due ${assignment.dueDate}`
                        : "No due date"}
                </span>
            </div>

            <div className="mt-6 border-t border-gray-200 pt-5 dark:border-zinc-800">
                <h2 className="mb-2 font-semibold text-gray-900 dark:text-white">
                    Instructions
                </h2>

                <p className="whitespace-pre-line text-gray-700 dark:text-zinc-300">
                    {assignment.description || "No instructions provided."}
                </p>
            </div>
        </article>
    );
}