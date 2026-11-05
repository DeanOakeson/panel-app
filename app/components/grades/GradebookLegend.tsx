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
            <span className="flex items-center gap-1.5">
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

/** Column spans that let the hint fill the last row of a four-column key, by how many entries sit in that row. */
const HINT_SPAN = ["@5xl:col-span-4", "@5xl:col-span-3", "@5xl:col-span-2", "@5xl:col-span-1"];

/**
 * Explains each kind of gradebook cell in a small grid, with each sample
 * framed as it looks in a cell, and the grid's `hint` after them. The grid
 * has 2, 3 or 4 columns by the key's own width. At 4 columns the hint shares
 * the last row; below that it sits on a line of its own under a rule.
 * `showDropped` adds the entry for students who left the class, shown only
 * when the grid has one.
 */
export default function GradebookLegend({
    id,
    showDropped,
    hint,
}: {
    id: string;
    showDropped: boolean;
    hint: string;
}) {
    const entries = showDropped ? [...ENTRIES, DROPPED_ENTRY] : ENTRIES;

    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="@container rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-gray-900"
        >
            <h2 id={`${id}-heading`} className="sr-only">
                Key
            </h2>

            <ul className="grid grid-cols-[repeat(2,auto)] justify-start gap-x-6 gap-y-1 text-[13px] text-gray-700 @3xl:grid-cols-[repeat(3,auto)] @5xl:grid-cols-[repeat(4,auto)] dark:text-zinc-300">
                {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className="flex h-7 min-w-9 shrink-0 items-center justify-center rounded-sm border border-gray-200 bg-white px-1.5 dark:border-zinc-700 dark:bg-gray-900"
                        >
                            {entry.example}
                        </span>

                        <span>
                            <span className="sr-only">{entry.spoken} </span>
                            {entry.meaning}
                        </span>
                    </li>
                ))}

                <li
                    aria-hidden="true"
                    className={`col-span-full mt-0.5 border-t border-gray-200 pt-1.5 text-sm text-gray-600 [contain:inline-size] @5xl:mt-0 @5xl:border-t-0 @5xl:pt-0 dark:border-zinc-700 dark:text-zinc-300 ${HINT_SPAN[entries.length % 4]}`}
                >
                    {hint}
                </li>
            </ul>
        </section>
    );
}
