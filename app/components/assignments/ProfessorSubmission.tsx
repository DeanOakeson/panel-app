import type { Submission } from "../Types";

type Props = {
    submissions: Submission[];
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

export default function ProfessorSubmissions({
    submissions,
    loading,
    error,
}: Props) {
    return (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Student submissions ({submissions.length})
            </h2>

            {loading ? (
                <p className="mt-3 text-sm text-gray-500">
                    Loading submissions...
                </p>
            ) : error ? (
                <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : submissions.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
                    No students have submitted this assignment yet.
                </p>
            ) : (
                <div className="mt-4 space-y-4">
                    {submissions.map((submission) => (
                        <article
                            key={submission.studentId}
                            className="rounded-lg border border-gray-200 p-4 dark:border-zinc-700"
                        >
                            <p className="text-sm text-gray-500 dark:text-zinc-400">
                                Student ID
                            </p>

                            <p className="mt-1 break-all font-medium text-gray-900 dark:text-white">
                                {submission.studentId ?? "Unknown"}
                            </p>

                            <div className="mt-3">
                                <p className="break-all font-medium text-gray-900 dark:text-white">
                                    {submission.fileName}
                                </p>

                                <p className="text-sm text-gray-500 dark:text-zinc-400">
                                    {formatFileSize(submission.fileSize)}
                                </p>

                                <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                                    Submitted: {formatDate(submission.submittedAt)}
                                </p>

                                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                                    Status: {submission.status}
                                </p>
                            </div>

                            <div className="mt-3">
                                <p className="text-sm text-gray-500 dark:text-zinc-400">
                                    Grade
                                </p>

                                <p className="font-medium text-gray-900 dark:text-white">
                                    {submission.grade ?? "Not graded"}
                                </p>
                            </div>

                            {submission.feedback && (
                                <div className="mt-3">
                                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                                        Feedback
                                    </p>

                                    <p className="whitespace-pre-line text-gray-900 dark:text-white">
                                        {submission.feedback}
                                    </p>
                                </div>
                            )}

                            {submission.fileUrl && (
                                <a
                                    href={submission.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-zinc-800"
                                >
                                    View / Download file
                                </a>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}