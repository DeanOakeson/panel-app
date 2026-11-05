import type { ReactNode } from "react";
import { BADGE_CLASSES } from "../assignments/StatusBadge";
import { FeedbackIcon, SmallMissingTag } from "./GradeCellContent";

type Entry = {
    key: string;
    example: ReactNode;
    /** What a screen reader hears for the example, which is hidden from it. */
    spoken: string;
    meaning: string;
};

/** Shows a status badge as the cells do. */
function Badge({ label, tone }: { label: string; tone: keyof typeof BADGE_CLASSES }) {
    return (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[tone]}`}>
            {label}
        </span>
    );
}

const ENTRIES: Entry[] = [
    {
        key: "needs-grading",
        example: <Badge label="Needs grading" tone="needs-grading" />,
        spoken: "Needs grading:",
        meaning: "To grade",
    },
    {
        key: "feedback",
        example: <FeedbackIcon />,
        spoken: "Speech bubble:",
        meaning: "Feedback",
    },
    {
        key: "missing-graded",
        example: (
            <span className="flex items-center gap-1">
                <span className="tabular-nums">
                    <span className="font-semibold text-gray-900 dark:text-white">0</span>
                    <span className="text-gray-600 dark:text-zinc-300">/10</span>
                </span>
                <SmallMissingTag />
            </span>
        ),
        spoken: "0 with a Missing tag:",
        meaning: "Missing-work grade",
    },
    {
        key: "missing",
        example: <Badge label="Missing" tone="missing" />,
        spoken: "Missing:",
        meaning: "Past due",
    },
    {
        key: "not-submitted",
        example: <span className="whitespace-nowrap text-gray-600 dark:text-zinc-300">Not submitted</span>,
        spoken: "Not submitted:",
        meaning: "Still open",
    },
];

const DROPPED_ENTRY: Entry = {
    key: "dropped",
    example: <span aria-hidden="true" className="px-1 text-base text-gray-500 dark:text-zinc-400">–</span>,
    spoken: "Dash:",
    meaning: "Not enrolled",
};

/**
 * Explains each kind of gradebook cell in a compact, wrapping line.
 * `showDropped` adds the entry for students who left the class, shown only
 * when the grid has one.
 */
export default function GradebookLegend({ id, showDropped }: { id: string; showDropped: boolean }) {
    const entries = showDropped ? [...ENTRIES, DROPPED_ENTRY] : ENTRIES;

    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="relative rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-gray-900"
        >
            <h2 id={`${id}-heading`} className="sr-only">
                Key
            </h2>

            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-800 dark:text-zinc-200">

                {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-1.5">
                        <span className="flex shrink-0 items-center">{entry.example}</span>
                        <span className="whitespace-nowrap">
                            <span className="sr-only">{entry.spoken} </span>
                            {entry.meaning}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
