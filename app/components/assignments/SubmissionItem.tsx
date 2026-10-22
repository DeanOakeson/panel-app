import GradeForm from "./GradeForm";

/**
 * A professor's grade for one submission, stored at
 * classes/{classId}/assignments/{assignmentId}/grades/{studentUid}.
 */
export type Grade = {
  score: number;
  feedback: string;
  /** The grading professor's uid. */
  gradedBy: string;
  /** ISO 8601 string. */
  gradedAt: string;
};

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
  grade: Grade | null;
};

type SubmissionItemProps = {
  classId: string;
  assignmentId: string;
  /** The assignment's points possible. */
  points: number;
  submission: Submission;
  onGraded: () => void | Promise<void>;
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

/**
 * One submission, collapsed to the student, submission time, and grade until
 * opened. Opening it shows the work and its grade, or a form to grade it.
 */
export default function SubmissionItem({
  classId,
  assignmentId,
  points,
  submission,
  onGraded,
}: SubmissionItemProps) {
  const submittedAt = submission.submittedAt
    ? new Date(submission.submittedAt).toLocaleString()
    : "Unknown time";
  const { grade } = submission;

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
          <span className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-500 dark:text-zinc-400">
              Submitted {submittedAt}
            </span>
            {grade ? (
              <span className="font-semibold text-green-700 dark:text-green-400">
                {grade.score} / {points}
              </span>
            ) : (
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                Not graded
              </span>
            )}
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

        <div className="flex flex-col gap-2 border-t border-gray-200 p-4 dark:border-zinc-800">
          {grade ? (
            <>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Grade: {grade.score} / {points}
              </p>
              {grade.feedback && (
                <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-zinc-300">
                  {grade.feedback}
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Graded {new Date(grade.gradedAt).toLocaleString()}
              </p>
            </>
          ) : (
            <GradeForm
              classId={classId}
              assignmentId={assignmentId}
              studentId={submission.id}
              points={points}
              onSaved={onGraded}
            />
          )}
        </div>
      </details>
    </li>
  );
}
