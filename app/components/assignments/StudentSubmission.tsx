import type { Assignment, Submission } from "../Types";

type Props = {
    assignment: Assignment;
    submission: Submission | null;
    loading: boolean;
    error: string;
};

function formatDate(dateString: string) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}

function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function StudentSubmission({
    assignment,
    submission,
    loading,
    error,
}: Props) {
    return (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Your submission
            </h2>

            {loading ? (
                <p className="mt-3 text-sm text-gray-500">
                    Loading submission...
                </p>
            ) : error ? (
                <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : submission ? (
                <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-500 dark:text-zinc-400">
                            Status
                        </span>

                        <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium capitalize text-green-800">
                            {submission.status}
                        </span>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Submitted on
                        </p>

                        <p className="mt-1 text-gray-900 dark:text-white">
                            {formatDate(submission.submittedAt)}
                        </p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Submitted file
                        </p>

                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="break-all font-medium text-gray-900 dark:text-white">
                                    {submission.fileName}
                                </p>

                                <p className="text-sm text-gray-500 dark:text-zinc-400">
                                    {formatFileSize(submission.fileSize)}
                                </p>
                            </div>

                            {submission.fileUrl && (
                                <a
                                    href={submission.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-zinc-800"
                                >
                                    View file
                                </a>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4 dark:border-zinc-800">
                        <p className="text-sm text-gray-500 dark:text-zinc-400">
                            Grade
                        </p>

                        <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                            {submission.grade !== null
                                ? `${submission.grade} / ${assignment.points}`
                                : "Not graded yet"}
                        </p>

                        {submission.resubmittedAfterGrading && (
                            <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                                Graded before your latest submission
                            </p>
                        )}
                    </div>

                    {submission.feedback && (
                        <div>
                            <p className="text-sm text-gray-500 dark:text-zinc-400">
                                Professor feedback
                            </p>

                            <p className="mt-1 whitespace-pre-line text-gray-900 dark:text-white">
                                {submission.feedback}
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
                    You have not submitted this assignment yet.
                </p>
            )}
        </section>
    );
}