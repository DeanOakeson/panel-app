/**
 * A student's work for an assignment, stored at
 * classes/{classId}/assignments/{assignmentId}/submissions/{studentUid}.
 */
export type Submission = {
  /** The student's uid. */
  id: string;
  text?: string;
  url?: string;
  /** ISO 8601 string, like an assignment's createdAt. */
  submittedAt?: string;
  studentName: string | null;
  studentEmail: string | null;
};

type SubmissionItemProps = {
  submission: Submission;
};

/** Returns whether `url` is an http or https link that is safe to render as an anchor. */
function isWebLink(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** One submission, collapsed to the student and submission time until opened. */
export default function SubmissionItem({ submission }: SubmissionItemProps) {
  const submittedAt = submission.submittedAt
    ? new Date(submission.submittedAt).toLocaleString()
    : "Unknown time";

  return (
    <li className="rounded-lg border border-gray-200 bg-white dark:border-zinc-800 dark:bg-gray-900">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
          <span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {submission.studentName ?? submission.studentEmail ?? "Unknown student"}
            </span>
            {submission.studentName && submission.studentEmail && (
              <span className="ml-2 text-sm text-gray-500 dark:text-zinc-400">
                {submission.studentEmail}
              </span>
            )}
          </span>
          <span className="text-sm text-gray-500 dark:text-zinc-400">
            Submitted {submittedAt}
          </span>
        </summary>

        <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-zinc-800">
          {submission.text && (
            <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-zinc-300">
              {submission.text}
            </p>
          )}

          {submission.url &&
            (isWebLink(submission.url) ? (
              <a
                href={submission.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                {submission.url}
              </a>
            ) : (
              <p className="break-all text-sm text-gray-700 dark:text-zinc-300">
                {submission.url}
              </p>
            ))}

          {!submission.text && !submission.url && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              This submission is empty.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
