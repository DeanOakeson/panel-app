import type { Assignment, MissingGradeSummary, Submission } from "../Types";
import MissingTag from "./MissingTag";

type Props = {
  assignment: Assignment;
  submission: Submission | null;
  submissions: Submission[];
  missingGrade: MissingGradeSummary | null;
  loading: boolean;
  error: string;
  isLate?: boolean;
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

function MissingWorkGrade({
  assignment,
  missingGrade,
}: {
  assignment: Assignment;
  missingGrade: MissingGradeSummary;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="border-t border-gray-200 pt-4 dark:border-zinc-800">
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Missing-work grade
        </p>

        <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
          <span>{`${missingGrade.score} / ${assignment.points}`}</span>
          <MissingTag />
        </p>

        <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
          Graded {formatDate(missingGrade.gradedAt)}
        </p>

        {missingGrade.updatedAt && (
          <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
            Updated {formatDate(missingGrade.updatedAt)}
          </p>
        )}
      </div>

      {missingGrade.feedback && (
        <div>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Professor feedback
          </p>

          <p className="mt-1 whitespace-pre-line text-gray-900 dark:text-white">
            {missingGrade.feedback}
          </p>
        </div>
      )}
    </div>
  );
}

export default function StudentSubmission({
  assignment,
  submission,
  submissions,
  missingGrade,
  loading,
  error,

}: Props) {
  const latestSubmission = submissions[0] ?? submission;

  const submissionFiles =
    submissions.length > 0
      ? submissions.slice(0, 3)
      : submission
        ? [submission]
        : [];

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
        Your submissions
      </h2>

      {loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading submissions...</p>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : latestSubmission ? (
        <div className="mt-4 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-gray-500 dark:text-zinc-400">
              Latest submission status
            </span>

            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium capitalize text-green-800">
              {latestSubmission.status}
            </span>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
              Submitted files ({submissionFiles.length}/3)
            </p>

            <div className="space-y-3">
              {submissionFiles.map((file, index) => (
                <div
                  key={`${file.fileName}-${file.submittedAt}-${index}`}
                  className="rounded-lg border border-gray-200 p-4 dark:border-zinc-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all font-medium text-gray-900 dark:text-white">
                        {file.fileName}
                      </p>

                      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                        {formatFileSize(file.fileSize)}
                      </p>

                      <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                        Submitted {formatDate(file.submittedAt)}
                      </p>

                      {index === 0 && (
                        <span className="mt-2 inline-block rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                          Latest
                        </span>
                      )}
                      {file.isLate && (
                        <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          Late
                        </span>
                      )}
                    </div>

                    {file.fileUrl && (
                      <a
                        href={file.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-blue-400 dark:hover:bg-zinc-800"
                      >
                        View file
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4 dark:border-zinc-800">
            <p className="text-sm text-gray-500 dark:text-zinc-400">Grade</p>

            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
              {latestSubmission.grade !== null
                ? `${latestSubmission.grade} / ${assignment.points}`
                : "Not graded yet"}
            </p>

            {latestSubmission.gradedAt && (
              <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                Graded {formatDate(latestSubmission.gradedAt)}
              </p>
            )}

            {latestSubmission.gradeUpdatedAt && (
              <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                Updated {formatDate(latestSubmission.gradeUpdatedAt)}
              </p>
            )}

            {latestSubmission.resubmittedAfterGrading && (
              <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                Graded before your latest submission
              </p>
            )}

            {latestSubmission.submittedAfterMissingGrade && missingGrade && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <span>
                  {`Submitted after a missing-work grade of ${missingGrade.score} / ${assignment.points}`}
                </span>
                <MissingTag />
              </p>
            )}
          </div>

          {latestSubmission.feedback && (
            <div>
              <p className="text-sm text-gray-500 dark:text-zinc-400">
                Professor feedback
              </p>

              <p className="mt-1 whitespace-pre-line text-gray-900 dark:text-white">
                {latestSubmission.feedback}
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
            You have not submitted this assignment yet.
          </p>

          {missingGrade && (
            <MissingWorkGrade
              assignment={assignment}
              missingGrade={missingGrade}
            />
          )}
        </>
      )}
    </section>
  );
}
