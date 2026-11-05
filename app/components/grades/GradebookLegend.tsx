import type { ReactNode } from "react";
import { BADGE_CLASSES } from "../assignments/StatusBadge";
import { CellBadge, FeedbackIcon, SmallMissingTag } from "./GradeCellContent";

type Entry = {
    key: string;
    example: ReactNode;
    /** What a screen reader hears for the example, which is hidden from it. */
    spoken: string;
    meaning: string;
};

const ENTRIES: Entry[] = [
    {
        key: "needs-grading",
        example: <CellBadge label="Needs grading" className={BADGE_CLASSES["needs-grading"]} />,
        spoken: "Needs grading:",
        meaning: "Waiting for you to grade",
    },
    {
        key: "feedback",
        example: <FeedbackIcon />,
        spoken: "Speech bubble:",
        meaning: "Has feedback",
    },
    {
        key: "missing-graded",
        example: (
            <span className="flex flex-col items-center gap-0.5">
                <span className="whitespace-nowrap tabular-nums">
                    <span className="text-base font-semibold text-gray-900 dark:text-white">0</span>
                    <span className="text-sm text-gray-600 dark:text-zinc-300">/10</span>
                </span>
                <SmallMissingTag />
            </span>
        ),
        spoken: "0 with a Missing tag:",
        meaning: "Zero given for missing work",
    },
    {
        key: "missing",
        example: <CellBadge label="Missing" className={BADGE_CLASSES.missing} />,
        spoken: "Missing:",
        meaning: "Past due, nothing turned in",
    },
    {
        key: "not-submitted",
        example: <span className="whitespace-nowrap text-[13px] text-gray-600 dark:text-zinc-300">Not submitted</span>,
        spoken: "Not submitted:",
        meaning: "Not due yet",
    },
];

const DROPPED_ENTRY: Entry = {
    key: "dropped",
    example: <span className="px-1 text-base text-gray-500 dark:text-zinc-400">–</span>,
    spoken: "Dash:",
    meaning: "Not enrolled in the class",
};

/**
 * Explains each kind of gradebook cell in a small grid, with each sample
 * framed as it looks in a cell. `showDropped` adds the entry for students who
 * left the class, shown only when the grid has one.
 */
export default function GradebookLegend({ id, showDropped }: { id: string; showDropped: boolean }) {
    const entries = showDropped ? [...ENTRIES, DROPPED_ENTRY] : ENTRIES;

    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-gray-900"
        >
            <h2 id={`${id}-heading`} className="sr-only">
                Key
            </h2>

            <ul className="grid grid-cols-[repeat(2,auto)] justify-start gap-x-6 gap-y-1.5 text-[13px] text-gray-700 lg:grid-cols-[repeat(3,auto)] dark:text-zinc-300">
                {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className="flex min-h-9 min-w-18 shrink-0 items-center justify-center rounded-sm border border-gray-200 bg-white px-2 py-0.5 dark:border-zinc-700 dark:bg-gray-900"
                        >
                            {entry.example}
                        </span>

                        <span>
                            <span className="sr-only">{entry.spoken} </span>
                            {entry.meaning}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
