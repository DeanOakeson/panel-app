import { gradingStatusLabel, type GradingStatus } from "@/lib/gradingStatus";

/** Each grading status's badge colors, for light and dark mode. */
export const BADGE_CLASSES: Record<GradingStatus, string> = {
    "needs-grading": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    resubmitted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    "submitted-after-missing":
        "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    graded: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    missing: "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300",
    "missing-graded": "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
};

/**
 * Shows a student's grading status as a colored label. `closed` labels a
 * student without a submission as Missing rather than Not submitted.
 */
export default function StatusBadge({
    status,
    closed,
}: {
    status: GradingStatus;
    closed: boolean;
}) {
    return (
        <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${BADGE_CLASSES[status]}`}
        >
            {gradingStatusLabel(status, closed)}
        </span>
    );
}
