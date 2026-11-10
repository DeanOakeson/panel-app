import type { CellDisplay } from "@/lib/gradebook";
import { BADGE_CLASSES } from "../assignments/StatusBadge";

/** Marks a score whose grade has written feedback. The view box crops to the glyph, so it fills 16 pixels. */
export function FeedbackIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="2 2 12 12"
            className="h-4 w-4 shrink-0 text-gray-600 dark:text-zinc-300"
            fill="currentColor"
        >
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7.2l-3 2.6A.75.75 0 0 1 3 13v-2h.5A1.5 1.5 0 0 1 2 9.5v-6Zm3 2a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H5Zm0 2.5a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5H5Z" />
        </svg>
    );
}

/** Labels a score in a cell as a missing-work grade, a smaller twin of MissingTag. */
export function SmallMissingTag() {
    return (
        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[13px] font-semibold leading-none text-gray-800 dark:bg-zinc-700 dark:text-zinc-100">
            Missing
        </span>
    );
}

/** Shows a status badge, such as Needs grading, as a gradebook cell does. */
export function CellBadge({ label, className }: { label: string; className: string }) {
    return (
        <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] leading-[18px] font-semibold ${className}`}
        >
            {label}
        </span>
    );
}

/**
 * Shows what a gradebook cell holds: a status badge with the reason work
 * waits, a score out of `points` with a Missing tag under it, or muted placeholder
 * text. A feedback mark follows the score on its line. The visible text is
 * hidden from screen readers, which read the cell's label.
 */
export default function GradeCellContent({
    display,
    points,
}: {
    display: CellDisplay;
    points: number;
}) {
    return (
        <>
            <span aria-hidden="true" className="flex flex-col items-center gap-0.5">
                {display.badge && (
                    <CellBadge label={display.badge.label} className={BADGE_CLASSES[display.badge.tone]} />
                )}

                {display.reason && (
                    <span className="flex flex-col items-center text-sm leading-[18px] text-gray-700 dark:text-zinc-300">
                        <span className="whitespace-nowrap">{display.reason.label}</span>
                        <span className="whitespace-nowrap tabular-nums">{display.reason.earlier}</span>
                    </span>
                )}

                {display.primary !== null && (
                    <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="tabular-nums">
                            <span className="text-base font-semibold text-gray-900 dark:text-white">
                                {display.primary}
                            </span>
                            <span className="text-sm text-gray-600 dark:text-zinc-300">/{points}</span>
                        </span>

                        {display.hasFeedback && <FeedbackIcon />}
                    </span>
                )}

                {display.missingTag && <SmallMissingTag />}

                {display.placeholder && (
                    <span className="whitespace-nowrap text-[13px] text-gray-600 dark:text-zinc-300">
                        {display.placeholder}
                    </span>
                )}
            </span>
        </>
    );
}
